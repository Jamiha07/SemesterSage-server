const requireAuth = require('./auth');

// Runs requireAuth first, then checks the isAdmin flag embedded in the token at login.
function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        if (!req.user.isAdmin) {
            return res.status(403).json({ error: 'Admin access required.' });
        }
        next();
    });
}

module.exports = requireAdmin;
