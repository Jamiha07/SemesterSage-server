const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const requireAuth = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

// Mirrors UserDAO.getAllUsers() -- admin roster.
router.get('/admin/all', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, username, email, avatar_id, program, semester, is_admin FROM users ORDER BY username ASC'
        );
        res.json(rows);
    } catch (err) {
        console.error('Get all users error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors AdminPanelController's confirmDeleteUser() -- admin deleting someone else's account,
// no password needed since it's the admin acting, not the account owner.
router.delete('/admin/:username', requireAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE username = ?', [req.params.username]);
        res.json({ success: true });
    } catch (err) {
        console.error('Admin delete user error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors ProfileController's handleDeleteAccount() -- self-service deletion, password-confirmed.
router.delete('/me', requireAuth, async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required to delete your account.' });

    try {
        const [[user]] = await pool.query('SELECT password_hash FROM users WHERE username = ?', [req.user.username]);
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Incorrect password.' });
        }

        await pool.query('DELETE FROM users WHERE username = ?', [req.user.username]);
        res.json({ success: true });
    } catch (err) {
        console.error('Self delete error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors UserDAO.updateSemester() -- self-service, Profile screen's semester editor.
router.patch('/me/semester', requireAuth, async (req, res) => {
    const { semester } = req.body;
    if (!semester) return res.status(400).json({ error: 'semester is required.' });

    try {
        await pool.query('UPDATE users SET semester = ? WHERE username = ?', [semester, req.user.username]);
        res.json({ success: true });
    } catch (err) {
        console.error('Update semester error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

module.exports = router;
