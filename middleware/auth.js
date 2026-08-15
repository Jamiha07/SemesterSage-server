const jwt = require('jsonwebtoken');

// Reads "Authorization: Bearer <token>", verifies it, and attaches { id, username }
// to req.user. Used by any route that needs to know who's making the request.
function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Not logged in.' });
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired session.' });
    }
}

module.exports = requireAuth;
