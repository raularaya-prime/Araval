const crypto = require('node:crypto');
const db = require('./db');
const { hashPassword, verifyPassword } = require('./password');
const { ApiError } = require('./api');

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
  const row = db.prepare('SELECT id, username, password_hash, is_admin FROM usuarios WHERE id = ?').get(id);
  return row ? { ...row, is_admin: !!row.is_admin } : null;
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
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.is_admin FROM sesiones s
       JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token);
  return row ? { ...row, is_admin: !!row.is_admin } : null;
}

function deleteSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
}

function updatePassword(userId, newPasswordHash) {
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(newPasswordHash, userId);
}

function requireAdmin(currentUser) {
  if (!currentUser.is_admin) throw new ApiError(403, 'Requiere permisos de administrador');
}

function countAdmins() {
  return db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE is_admin = 1').get().n;
}

function listUsers(currentUser) {
  requireAdmin(currentUser);
  return db
    .prepare('SELECT id, username, is_admin, created_at FROM usuarios ORDER BY username')
    .all()
    .map((u) => ({ ...u, is_admin: !!u.is_admin }));
}

function createUser(currentUser, body) {
  requireAdmin(currentUser);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const isAdmin = body.is_admin ? 1 : 0;

  if (!username) throw new ApiError(400, 'El usuario es obligatorio');
  if (password.length < 8) throw new ApiError(400, 'La contraseña debe tener al menos 8 caracteres');
  if (findUserByUsername(username)) {
    throw new ApiError(409, `Ya existe un usuario con el nombre "${username}"`);
  }

  const result = db
    .prepare('INSERT INTO usuarios (username, password_hash, is_admin) VALUES (?, ?, ?)')
    .run(username, hashPassword(password), isAdmin);

  return { id: result.lastInsertRowid, username, is_admin: !!isAdmin };
}

function deleteUser(currentUser, targetId) {
  requireAdmin(currentUser);
  if (targetId === currentUser.id) throw new ApiError(400, 'No puedes eliminar tu propio usuario');
  const target = findUserById(targetId);
  if (!target) throw new ApiError(404, 'Usuario no encontrado');
  if (target.is_admin && countAdmins() <= 1) {
    throw new ApiError(400, 'No puedes eliminar al último administrador');
  }
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(targetId);
}

function setAdminFlag(currentUser, targetId, isAdmin) {
  requireAdmin(currentUser);
  if (targetId === currentUser.id) throw new ApiError(400, 'No puedes cambiar tu propio rol de administrador');
  const target = findUserById(targetId);
  if (!target) throw new ApiError(404, 'Usuario no encontrado');
  if (!isAdmin && target.is_admin && countAdmins() <= 1) {
    throw new ApiError(400, 'No puedes quitar al último administrador');
  }
  db.prepare('UPDATE usuarios SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, targetId);
}

function resetUserPassword(currentUser, targetId, body) {
  requireAdmin(currentUser);
  if (targetId === currentUser.id) {
    throw new ApiError(400, 'Para cambiar tu propia contraseña usa "Cambiar contraseña" en el encabezado');
  }
  const nueva = String(body.password_nueva || '');
  if (nueva.length < 8) throw new ApiError(400, 'La nueva contraseña debe tener al menos 8 caracteres');
  const target = findUserById(targetId);
  if (!target) throw new ApiError(404, 'Usuario no encontrado');
  updatePassword(targetId, hashPassword(nueva));
  db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(targetId);
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
  listUsers,
  createUser,
  deleteUser,
  setAdminFlag,
  resetUserPassword,
};
