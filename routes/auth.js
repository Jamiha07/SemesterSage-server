const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

function generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// DEV PHASE ONLY: prints the code instead of emailing it, so testing with fake
// accounts across programs/semesters doesn't require a real inbox for each one.
// Swap this out for a real email provider (e.g. Nodemailer) before real launch.
function sendVerificationEmail(email, code) {
    console.log(`[DEV] Verification code for ${email}: ${code}`);
}

// Mirrors UserService.registerUser() -- hash the password, insert, and let the
// DB's own UNIQUE constraints on username/email surface duplicates. Account is
// created unverified with a 6-digit OTP; login is blocked until /verify succeeds.
router.post('/register', async (req, res) => {
    const { username, password, email, avatarId, program, semester } = req.body;

    if (!username || !password || !email || !avatarId || !program || !semester) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const otp = generateOtp();
        await pool.query(
            'INSERT INTO users (username, password_hash, email, avatar_id, reputation, program, semester, otp_code, is_verified) VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0)',
            [username, passwordHash, email, avatarId, program, semester, otp]
        );
        sendVerificationEmail(email, otp);
        res.json({ success: true, message: 'Account created. Check your email for a verification code.' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Username or Email already exists.' });
        }
        console.error('Register error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Checks the submitted code against what's stored, marks the account verified.
router.post('/verify', async (req, res) => {
    const { username, code } = req.body;

    if (!username || !code) {
        return res.status(400).json({ error: 'Missing username or code.' });
    }

    try {
        const [rows] = await pool.query('SELECT otp_code, is_verified FROM users WHERE username = ?', [username]);
        const user = rows[0];

        if (!user) return res.status(404).json({ error: 'No such account.' });
        if (user.is_verified) return res.json({ success: true, message: 'Already verified.' });
        if (user.otp_code !== code) return res.status(400).json({ error: 'Incorrect code.' });

        await pool.query('UPDATE users SET is_verified = 1, otp_code = NULL WHERE username = ?', [username]);
        res.json({ success: true });
    } catch (err) {
        console.error('Verify error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors UserService.loginUser() -- case-sensitive username match (BINARY),
// live-calculated reputation (summed fresh, same as the desktop app), BCrypt check.
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Missing username or password.' });
    }

    try {
        const [rows] = await pool.query(
            `SELECT u.*,
                (SELECT COALESCE(SUM(q.upvotes), 0) FROM questions q WHERE q.user_id = u.id) +
                (SELECT COALESCE(SUM(a.upvotes), 0) FROM answers a WHERE a.user_id = u.id) AS live_reputation
             FROM users u WHERE BINARY u.username = ?`,
            [username]
        );

        const user = rows[0];
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }
        if (!user.is_verified) {
            return res.status(403).json({ error: 'Please verify your email before logging in.', needsVerification: true });
        }

        const token = jwt.sign({ id: user.id, username: user.username, isAdmin: !!user.is_admin }, process.env.JWT_SECRET, { expiresIn: '30d' });

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatarId: user.avatar_id,
                program: user.program,
                semester: user.semester,
                isAdmin: !!user.is_admin,
                reputation: user.live_reputation
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

module.exports = router;
