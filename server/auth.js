const crypto = require('node:crypto');
const db = require('./db');
const { hashPassword, verifyPassword } = require('./password');

const SESSION_COOKIE = 'araval_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 7;

const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginAttempts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= LOGIN_MAX_ATTEMPTS;
}

function findUserByUsername(username) {
  return db.prepare('SELECT * FROM usuarios WHERE username = ?').get(username);
}

function findUserById(id) {
  return db.prepare('SELECT id, username, password_hash FROM usuarios WHERE id = ?').get(id);
}

function createSession(userId) {
  db.prepare("DELETE FROM sesiones WHERE expires_at < datetime('now')").run();
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sesiones (token, usuario_id, expires_at) VALUES (?, ?, datetime('now', ?))`
  ).run(token, userId, `+${SESSION_DAYS} days`);
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT u.id, u.username FROM sesiones s
         JOIN usuarios u ON u.id = s.usuario_id
         WHERE s.token = ? AND s.expires_at > datetime('now')`
      )
      .get(token) || null
  );
}

function deleteSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
}

function updatePassword(userId, newPasswordHash) {
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(newPasswordHash, userId);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function serializeCookie(name, value, { maxAgeSeconds, secure } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function isHttps(req) {
  return req.socket.encrypted === true || req.headers['x-forwarded-proto'] === 'https';
}

function getUserFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return getSessionUser(cookies[SESSION_COOKIE]);
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

function setSessionCookie(req, res, token) {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, token, {
      maxAgeSeconds: SESSION_DAYS * 24 * 60 * 60,
      secure: isHttps(req),
    })
  );
}

function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure: isHttps(req) }));
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  findUserByUsername,
  findUserById,
  createSession,
  getSessionUser,
  deleteSession,
  updatePassword,
  getUserFromRequest,
  getSessionToken,
  setSessionCookie,
  clearSessionCookie,
  checkRateLimit,
};
