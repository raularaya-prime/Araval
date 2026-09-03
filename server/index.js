const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { URL } = require('node:url');

const api = require('./api');

const PORT = process.env.PORT || 3000;
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

  if (!pathname.startsWith('/api/')) {
    serveStatic(req, res, pathname);
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
    const result = route.handler(params, query, body);
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
