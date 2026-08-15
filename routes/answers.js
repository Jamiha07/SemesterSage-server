const express = require('express');
const pool = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// Mirrors AnswerDAO.getAnswersForQuestion()
router.get('/question/:questionId', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.*, u.username FROM answers a JOIN users u ON a.user_id = u.id
             WHERE a.question_id = ? ORDER BY a.created_at ASC`,
            [req.params.questionId]
        );
        res.json(rows);
    } catch (err) {
        console.error('Get answers error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors AnswerDAO.saveAnswer()
router.post('/question/:questionId', requireAuth, async (req, res) => {
    const { body } = req.body;
    if (!body || !body.trim()) {
        return res.status(400).json({ error: 'Answer body is required.' });
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO answers (question_id, user_id, body, upvotes) VALUES (?, (SELECT id FROM users WHERE username = ?), ?, 0)',
            [req.params.questionId, req.user.username, body]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Post answer error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors AnswerDAO.updateAnswerVote() -- same transaction-protected toggle/switch/new-vote logic.
router.post('/:id/vote', requireAuth, async (req, res) => {
    const answerId = req.params.id;
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
            'SELECT vote_value FROM answer_votes WHERE user_id = ? AND answer_id = ?', [userId, answerId]
        );

        let scoreChange = 0;
        if (existingVote) {
            if (existingVote.vote_value === newVote) {
                await conn.query('DELETE FROM answer_votes WHERE user_id = ? AND answer_id = ?', [userId, answerId]);
                scoreChange = -existingVote.vote_value;
            } else {
                await conn.query('UPDATE answer_votes SET vote_value = ? WHERE user_id = ? AND answer_id = ?', [newVote, userId, answerId]);
                scoreChange = newVote - existingVote.vote_value;
            }
        } else {
            await conn.query('INSERT INTO answer_votes (user_id, answer_id, vote_value) VALUES (?, ?, ?)', [userId, answerId, newVote]);
            scoreChange = newVote;
        }

        await conn.query('UPDATE answers SET upvotes = upvotes + ? WHERE id = ?', [scoreChange, answerId]);
        await conn.commit();
        res.json({ success: true });
    } catch (err) {
        await conn.rollback();
        console.error('Answer vote error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    } finally {
        conn.release();
    }
});

// Same server-side ownership enforcement as questions -- the desktop app only hid this in the UI.
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const [[answer]] = await pool.query(
            `SELECT a.id, u.username AS author_username FROM answers a JOIN users u ON a.user_id = u.id WHERE a.id = ?`,
            [req.params.id]
        );
        if (!answer) return res.status(404).json({ error: 'Answer not found.' });

        const [[requester]] = await pool.query('SELECT is_admin FROM users WHERE username = ?', [req.user.username]);
        const isOwner = answer.author_username === req.user.username;
        const isAdmin = requester && requester.is_admin;

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'You can only delete your own answers.' });
        }

        await pool.query('DELETE FROM answers WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete answer error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

module.exports = router;
