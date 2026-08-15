const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const { calculateJaccardSimilarity } = require('../utils/similarity');
const { callGroqWithFailover } = require('../utils/groq');
const { buildSystemPrompt } = require('../utils/sagePrompt');

const router = express.Router();

// Mirrors TaskDAO.getTasksByUsername() -- uncompleted first, then by date.
router.get('/', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM tasks WHERE username = ? ORDER BY is_completed ASC, target_date ASC, id DESC',
            [req.user.username]
        );
        res.json(rows);
    } catch (err) {
        console.error('Get tasks error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors TaskDAO.addTask()
router.post('/', requireAuth, async (req, res) => {
    const { taskText, courseTag, targetDate } = req.body;
    if (!taskText || !courseTag) {
        return res.status(400).json({ error: 'taskText and courseTag are required.' });
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO tasks (username, task_text, course_tag, is_completed, target_date) VALUES (?, ?, ?, false, ?)',
            [req.user.username, taskText, courseTag, targetDate || null]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Add task error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors TaskDAO.updateTaskStatus() -- only the task's own owner can toggle it.
router.patch('/:id', requireAuth, async (req, res) => {
    try {
        const [[task]] = await pool.query('SELECT username FROM tasks WHERE id = ?', [req.params.id]);
        if (!task) return res.status(404).json({ error: 'Task not found.' });
        if (task.username !== req.user.username) return res.status(403).json({ error: 'Not your task.' });

        await pool.query('UPDATE tasks SET is_completed = ? WHERE id = ?', [!!req.body.isCompleted, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Update task error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors TaskDAO.deleteTask() -- same ownership enforcement as questions/answers.
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const [[task]] = await pool.query('SELECT username FROM tasks WHERE id = ?', [req.params.id]);
        if (!task) return res.status(404).json({ error: 'Task not found.' });
        if (task.username !== req.user.username) return res.status(403).json({ error: 'Not your task.' });

        await pool.query('DELETE FROM tasks WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete task error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors DashboardController.askSageForStudyPlan() exactly -- same >0.15 similarity
// threshold, same top-5 cap, same prompt wording, same "use your own judgment" instruction.
router.post('/:id/study-plan', requireAuth, async (req, res) => {
    try {
        const [[task]] = await pool.query('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
        if (!task) return res.status(404).json({ error: 'Task not found.' });
        if (task.username !== req.user.username) return res.status(403).json({ error: 'Not your task.' });

        const [courseQuestions] = await pool.query('SELECT title FROM questions WHERE course = ?', [task.course_tag]);

        const scored = courseQuestions
            .map(q => ({ title: q.title, score: calculateJaccardSimilarity(task.task_text, q.title) }))
            .filter(q => q.score > 0.15)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

        let prompt = `I need to study "${task.task_text}" for ${task.course_tag}. `;
        if (scored.length > 0) {
            prompt += 'Here are some questions classmates have asked in this course that may relate to this specific topic:\n';
            for (const q of scored) prompt += `- ${q.title}\n`;
            prompt += 'Some of these may actually be off-topic, social, or logistical posts rather than genuinely ' +
                'related to this topic -- use your own judgment and only draw on the ones truly relevant. ' +
                'Using the relevant ones as context, give me a focused study plan.';
        } else {
            prompt += 'Give me a focused study plan.';
        }

        const groqResponse = await callGroqWithFailover({
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7,
            messages: [
                { role: 'system', content: buildSystemPrompt(task.course_tag) },
                { role: 'user', content: prompt }
            ]
        });

        const data = await groqResponse.json();
        if (!groqResponse.ok) {
            console.error('Groq API error:', data);
            return res.status(502).json({ error: 'Sage is busy right now.' });
        }

        res.json({ answer: data.choices[0].message.content });
    } catch (err) {
        console.error('Study plan error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

module.exports = router;
