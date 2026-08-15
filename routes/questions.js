const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const { calculateJaccardSimilarity } = require('../utils/similarity');

const router = express.Router();
const SIMILARITY_THRESHOLD = 0.4;

// Mirrors QuestionDAO.getAllQuestions() / searchQuestions() -- ?course=All&keyword=foo
router.get('/', async (req, res) => {
    const course = req.query.course || 'All';
    const keyword = (req.query.keyword || '').trim();

    try {
        let rows;
        if (keyword) {
            const pattern = `%${keyword}%`;
            if (course === 'All') {
                [rows] = await pool.query(
                    `SELECT q.*, u.username AS author_username FROM questions q JOIN users u ON q.user_id = u.id
                     WHERE q.title LIKE ? OR q.body LIKE ? ORDER BY q.upvotes DESC, q.created_at DESC`,
                    [pattern, pattern]
                );
            } else {
                [rows] = await pool.query(
                    `SELECT q.*, u.username AS author_username FROM questions q JOIN users u ON q.user_id = u.id
                     WHERE q.course = ? AND (q.title LIKE ? OR q.body LIKE ?) ORDER BY q.upvotes DESC, q.created_at DESC`,
                    [course, pattern, pattern]
                );
            }
        } else if (course === 'All') {
            [rows] = await pool.query(
                `SELECT q.*, u.username AS author_username FROM questions q JOIN users u ON q.user_id = u.id
                 ORDER BY q.upvotes DESC, q.created_at DESC`
            );
        } else {
            [rows] = await pool.query(
                `SELECT q.*, u.username AS author_username FROM questions q JOIN users u ON q.user_id = u.id
                 WHERE q.course = ? ORDER BY q.upvotes DESC, q.created_at DESC`,
                [course]
            );
        }
        res.json(rows);
    } catch (err) {
        console.error('Get questions error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors AskQuestionController's duplicate check (same course, >=0.4 Jaccard, best match wins)
// followed by QuestionDAO.saveQuestion(). Pass force:true to skip the check and post anyway.
router.post('/', requireAuth, async (req, res) => {
    const { title, body, course, force } = req.body;

    if (!title || !title.trim() || !body || !body.trim() || !course) {
        return res.status(400).json({ error: 'Missing title, body, or course.' });
    }

    try {
        if (!force) {
            const [existing] = await pool.query(
                `SELECT q.*, u.username AS author_username FROM questions q JOIN users u ON q.user_id = u.id WHERE q.course = ?`,
                [course]
            );

            let bestMatch = null;
            let bestScore = 0;
            for (const q of existing) {
                const score = calculateJaccardSimilarity(title, q.title);
                if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
                    bestScore = score;
                    bestMatch = q;
                }
            }
            if (bestMatch) {
                return res.json({ duplicate: true, similarQuestion: bestMatch });
            }
        }

        const [result] = await pool.query(
            'INSERT INTO questions (user_id, title, body, tag_id, status, course, upvotes) VALUES ((SELECT id FROM users WHERE username = ?), ?, ?, 1, \'OPEN\', ?, 0)',
            [req.user.username, title, body, course]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Post question error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors QuestionDAO.updateUpvotes() -- transaction-protected toggle/switch/new-vote logic.
router.post('/:id/vote', requireAuth, async (req, res) => {
    const questionId = req.params.id;
    const newVote = req.body.value;

    if (newVote !== 1 && newVote !== -1) {
        return res.status(400).json({ error: 'value must be 1 or -1.' });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [[userRow]] = await conn.query('SELECT id FROM users WHERE username = ?', [req.user.username]);
        if (!userRow) throw new Error('User not found');
        const userId = userRow.id;

        const [[existingVote]] = await conn.query(
            'SELECT vote_value FROM votes WHERE user_id = ? AND question_id = ?', [userId, questionId]
        );

        let scoreChange = 0;
        if (existingVote) {
            if (existingVote.vote_value === newVote) {
                await conn.query('DELETE FROM votes WHERE user_id = ? AND question_id = ?', [userId, questionId]);
                scoreChange = -existingVote.vote_value;
            } else {
                await conn.query('UPDATE votes SET vote_value = ? WHERE user_id = ? AND question_id = ?', [newVote, userId, questionId]);
                scoreChange = newVote - existingVote.vote_value;
            }
        } else {
            await conn.query('INSERT INTO votes (user_id, question_id, vote_value) VALUES (?, ?, ?)', [userId, questionId, newVote]);
            scoreChange = newVote;
        }

        await conn.query('UPDATE questions SET upvotes = GREATEST(0, upvotes + ?) WHERE id = ?', [scoreChange, questionId]);
        await conn.commit();
        res.json({ success: true });
    } catch (err) {
        await conn.rollback();
        console.error('Vote error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    } finally {
        conn.release();
    }
});

// Unlike the desktop app (which only hid the delete button in the UI for non-authors,
// but never actually checked ownership in QuestionDAO itself), a real network-facing API
// has to enforce this server-side -- otherwise any logged-in user could delete anyone's post.
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const [[question]] = await pool.query(
            `SELECT q.id, u.username AS author_username FROM questions q JOIN users u ON q.user_id = u.id WHERE q.id = ?`,
            [req.params.id]
        );
        if (!question) return res.status(404).json({ error: 'Question not found.' });

        const [[requester]] = await pool.query('SELECT is_admin FROM users WHERE username = ?', [req.user.username]);
        const isOwner = question.author_username === req.user.username;
        const isAdmin = requester && requester.is_admin;

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'You can only delete your own questions.' });
        }

        await pool.query('DELETE FROM questions WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete question error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

module.exports = router;
