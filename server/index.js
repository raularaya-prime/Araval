const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { URL } = require('node:url');

const api = require('./api');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
const PUBLIC_PATHS = new Set(['/login', '/login.js', '/styles.css']);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new api.ApiError(413, 'Cuerpo de la solicitud demasiado grande'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new api.ApiError(400, 'JSON invalido en el cuerpo de la solicitud'));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

async function handleLogin(req, res) {
  try {
    const ip = clientIp(req);
    if (!auth.checkRateLimit(ip)) {
      sendJson(res, 429, { error: 'Demasiados intentos. Intenta nuevamente en unos minutos.' });
      return;
    }
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) {
      sendJson(res, 400, { error: 'Usuario y contraseña son obligatorios' });
      return;
    }
    const user = auth.findUserByUsername(username);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      sendJson(res, 401, { error: 'Usuario o contraseña incorrectos' });
      return;
    }
    const token = auth.createSession(user.id);
    auth.setSessionCookie(req, res, token);
    sendJson(res, 200, { username: user.username });
  } catch (err) {
    if (err instanceof api.ApiError) {
      sendJson(res, err.status, { error: err.message });
    } else {
      console.error(err);
      sendJson(res, 500, { error: 'Error interno del servidor' });
    }
  }
}

function handleLogout(req, res) {
  auth.deleteSession(auth.getSessionToken(req));
  auth.clearSessionCookie(req, res);
  sendJson(res, 200, { ok: true });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, indexData) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not found');
          } else {
            res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
            res.end(indexData);
          }
        });
        return;
      }
      res.writeHead(500);
      res.end('Server error');
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const routes = [
  { method: 'GET', pattern: /^\/api\/me$/, handler: (params, query, body, user) => ({ username: user.username }) },
  {
    method: 'POST',
    pattern: /^\/api\/cambiar-password$/,
    handler: (params, query, body, user) => {
      const actual = String(body.password_actual || '');
      const nueva = String(body.password_nueva || '');
      if (!actual || !nueva) throw new api.ApiError(400, 'Debes indicar la contraseña actual y la nueva');
      if (nueva.length < 8) throw new api.ApiError(400, 'La nueva contraseña debe tener al menos 8 caracteres');
      const dbUser = auth.findUserById(user.id);
      if (!auth.verifyPassword(actual, dbUser.password_hash)) {
        throw new api.ApiError(401, 'La contraseña actual es incorrecta');
      }
      auth.updatePassword(user.id, auth.hashPassword(nueva));
      return { ok: true };
    },
  },
  { method: 'GET', pattern: /^\/api\/resumen$/, handler: (params, query) => api.resumen() },
  { method: 'GET', pattern: /^\/api\/categorias$/, handler: (params, query) => api.listCategorias() },
  { method: 'GET', pattern: /^\/api\/alertas$/, handler: (params, query) => api.listAlertas() },
  { method: 'GET', pattern: /^\/api\/materiales$/, handler: (params, query) => api.listMateriales(query) },
  {
    method: 'GET',
    pattern: /^\/api\/materiales\/(\d+)$/,
    handler: (params) => api.getMaterial(Number(params[0])),
  },
  {
    method: 'POST',
    pattern: /^\/api\/materiales$/,
    handler: (params, query, body) => api.createMaterial(body),
    status: 201,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/materiales\/(\d+)$/,
    handler: (params, query, body) => api.updateMaterial(Number(params[0]), body),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/materiales\/(\d+)$/,
    handler: (params) => {
      api.deleteMaterial(Number(params[0]));
      return { ok: true };
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/materiales\/(\d+)\/movimientos$/,
    handler: (params) => api.listMovimientos({ material_id: Number(params[0]) }),
  },
  { method: 'GET', pattern: /^\/api\/movimientos$/, handler: (params, query) => api.listMovimientos(query) },
  {
    method: 'POST',
    pattern: /^\/api\/movimientos$/,
    handler: (params, query, body) => api.createMovimiento(body),
    status: 201,
  },
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/api/login' && req.method === 'POST') {
    await handleLogin(req, res);
    return;
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    handleLogout(req, res);
    return;
  }

  const user = auth.getUserFromRequest(req);
  if (!PUBLIC_PATHS.has(pathname) && !user) {
    if (pathname.startsWith('/api/')) {
      sendJson(res, 401, { error: 'No autenticado' });
    } else {
      res.writeHead(302, { Location: '/login' });
      res.end();
    }
    return;
  }
  if (pathname === '/login' && user) {
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  if (!pathname.startsWith('/api/')) {
    serveStatic(req, res, pathname === '/login' ? '/login.html' : pathname);
    return;
  }

  const query = Object.fromEntries(url.searchParams.entries());
  const route = routes.find((r) => r.method === req.method && r.pattern.test(pathname));

  if (!route) {
    sendJson(res, 404, { error: 'Ruta no encontrada' });
    return;
  }

  try {
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const match = route.pattern.exec(pathname);
    const params = match.slice(1);
    const result = route.handler(params, query, body, user);
    sendJson(res, route.status || 200, result);
  } catch (err) {
    if (err instanceof api.ApiError) {
      sendJson(res, err.status, { error: err.message });
    } else {
      console.error(err);
      sendJson(res, 500, { error: 'Error interno del servidor' });
    }
  }
});

server.listen(PORT, () => {
  console.log(`Araval Inventario escuchando en http://localhost:${PORT}`);
});
