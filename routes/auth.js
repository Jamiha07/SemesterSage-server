const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const pool = require('../db');

const router = express.Router();

// Explicit host/port (587 STARTTLS) instead of the 'service: gmail' shorthand, and
// short timeouts so a connectivity problem fails fast (a few seconds) instead of
// hanging the whole request for minutes -- makes this diagnosable and gives users
// a real error instead of a stuck "Creating account..." button.
const mailer = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000
});

function generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendVerificationEmail(email, code) {
    await mailer.sendMail({
        from: `SemesterSage <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Your SemesterSage verification code',
        text: `Your verification code is ${code}. Enter it in the app to finish creating your account.`,
        html: `<p>Your verification code is:</p><h2 style="letter-spacing:4px;">${code}</h2><p>Enter it in the app to finish creating your account.</p>`
    });
}

async function sendPasswordResetEmail(email, code) {
    await mailer.sendMail({
        from: `SemesterSage <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Reset your SemesterSage password',
        text: `Your password reset code is ${code}. It expires in 15 minutes. If you didn't request this, ignore this email.`,
        html: `<p>Your password reset code is:</p><h2 style="letter-spacing:4px;">${code}</h2><p>It expires in 15 minutes. If you didn't request this, ignore this email.</p>`
    });
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

        try {
            await sendVerificationEmail(email, otp);
        } catch (emailErr) {
            // The account write already succeeded, but the code never reached them --
            // don't leave a permanently stuck row occupying this username/email with
            // no way to retry. Roll it back so registering again just works cleanly.
            console.error('Verification email failed, rolling back account:', emailErr);
            await pool.query('DELETE FROM users WHERE username = ?', [username]);
            return res.status(502).json({ error: 'Could not send the verification email. Please try again in a moment.' });
        }

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

// Generates a reset code (separate from the registration OTP, with a real expiry
// this time -- a stale password-reset code sitting around forever is riskier than
// a stale registration code, which is at least gated behind login being blocked).
router.post('/forgot-password', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Missing username.' });

    try {
        const [rows] = await pool.query('SELECT email FROM users WHERE username = ?', [username]);
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'No such account.' });

        const code = generateOtp();
        await pool.query(
            'UPDATE users SET reset_code = ?, reset_code_expires = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE username = ?',
            [code, username]
        );
        await sendPasswordResetEmail(user.email, code);
        res.json({ success: true, message: 'Check your email for a reset code.' });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

router.post('/reset-password', async (req, res) => {
    const { username, code, newPassword } = req.body;
    if (!username || !code || !newPassword) {
        return res.status(400).json({ error: 'Missing username, code, or new password.' });
    }

    try {
        // Expiry check happens entirely in SQL (reset_code_expires compared to MySQL's own
        // NOW()) instead of fetching a DATETIME into JS and comparing with new Date() --
        // that path re-triggers the same driver timezone-reinterpretation bug fixed
        // earlier for task dates, just on a column dateStrings doesn't cover.
        const [rows] = await pool.query(
            'SELECT reset_code, (reset_code_expires > NOW()) AS still_valid FROM users WHERE username = ?', [username]
        );
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'No such account.' });
        if (!user.reset_code || user.reset_code !== code) {
            return res.status(400).json({ error: 'Incorrect code.' });
        }
        if (!user.still_valid) {
            return res.status(400).json({ error: 'This code has expired. Request a new one.' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await pool.query(
            'UPDATE users SET password_hash = ?, reset_code = NULL, reset_code_expires = NULL WHERE username = ?',
            [passwordHash, username]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

module.exports = router;
