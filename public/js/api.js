const API_BASE = 'https://semestersage-server.onrender.com';

function getToken() { return localStorage.getItem('token'); }
function getUser() { return JSON.parse(localStorage.getItem('user') || 'null'); }
function saveSession(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
}
function clearSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
}
function requireLogin() {
    if (!getToken()) window.location.href = 'login.html';
}

// Thin wrapper around fetch that adds the API base, JSON headers, and the auth
// token if we have one. Throws on non-2xx so callers can just try/catch.
async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        const err = new Error(data.error || 'Something went wrong.');
        err.status = res.status;
        err.data = data;
        throw err;
    }
    return data;
}
