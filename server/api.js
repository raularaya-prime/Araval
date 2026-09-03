const db = require('./db');

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isCritico(m) {
  return m.stock_actual <= m.stock_minimo;
}

function withEstado(m) {
  return { ...m, critico: isCritico(m) };
}

function getMaterialOr404(id) {
  const material = db.prepare('SELECT * FROM materiales WHERE id = ?').get(id);
  if (!material) throw new ApiError(404, 'Material no encontrado');
  return material;
}

function requireString(body, field, { required = true } = {}) {
  const value = body[field];
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw new ApiError(400, `El campo "${field}" es obligatorio`);
    return null;
  }
  return String(value).trim();
}

function requireNumber(body, field, { required = true, min = null } = {}) {
  const value = body[field];
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `El campo "${field}" es obligatorio`);
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) throw new ApiError(400, `El campo "${field}" debe ser numerico`);
  if (min !== null && num < min) throw new ApiError(400, `El campo "${field}" debe ser mayor o igual a ${min}`);
  return num;
}

// ---------- Materiales ----------

function listMateriales(query) {
  let sql = 'SELECT * FROM materiales';
  const clauses = [];
  const params = [];

  if (query.categoria) {
    clauses.push('categoria = ?');
    params.push(query.categoria);
  }
  if (query.buscar) {
    clauses.push('(codigo LIKE ? OR nombre LIKE ?)');
    const like = `%${query.buscar}%`;
    params.push(like, like);
  }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY nombre ASC';

  let materiales = db.prepare(sql).all(...params).map(withEstado);

  if (query.criticos === 'true') {
    materiales = materiales.filter((m) => m.critico);
  }

  return materiales;
}

function getMaterial(id) {
  return withEstado(getMaterialOr404(id));
}

function createMaterial(body) {
  const codigo = requireString(body, 'codigo');
  const nombre = requireString(body, 'nombre');
  const unidad_medida = requireString(body, 'unidad_medida');
  const categoria = requireString(body, 'categoria', { required: false });
  const ubicacion = requireString(body, 'ubicacion', { required: false });
  const proveedor = requireString(body, 'proveedor', { required: false });
  const stock_actual = requireNumber(body, 'stock_actual', { required: false, min: 0 }) ?? 0;
  const stock_minimo = requireNumber(body, 'stock_minimo', { required: false, min: 0 }) ?? 0;
  const precio_unitario = requireNumber(body, 'precio_unitario', { required: false, min: 0 });

  const existente = db.prepare('SELECT id FROM materiales WHERE codigo = ?').get(codigo);
  if (existente) throw new ApiError(409, `Ya existe un material con el codigo "${codigo}"`);

  const result = db
    .prepare(
      `INSERT INTO materiales (codigo, nombre, categoria, unidad_medida, stock_actual, stock_minimo, ubicacion, proveedor, precio_unitario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(codigo, nombre, categoria, unidad_medida, stock_actual, stock_minimo, ubicacion, proveedor, precio_unitario);

  const materialId = result.lastInsertRowid;

  if (stock_actual > 0) {
    db.prepare(
      `INSERT INTO movimientos (material_id, tipo, cantidad, motivo, documento_referencia, responsable, stock_resultante)
       VALUES (?, 'ingreso', ?, 'Stock inicial', 'ALTA-MATERIAL', ?, ?)`
    ).run(materialId, stock_actual, requireString(body, 'responsable', { required: false }) || 'Sistema', stock_actual);
  }

  return getMaterial(materialId);
}

function updateMaterial(id, body) {
  const material = getMaterialOr404(id);

  const fields = {
    codigo: 'codigo' in body ? requireString(body, 'codigo') : material.codigo,
    nombre: 'nombre' in body ? requireString(body, 'nombre') : material.nombre,
    categoria: 'categoria' in body ? requireString(body, 'categoria', { required: false }) : material.categoria,
    unidad_medida: 'unidad_medida' in body ? requireString(body, 'unidad_medida') : material.unidad_medida,
    stock_minimo:
      'stock_minimo' in body ? requireNumber(body, 'stock_minimo', { min: 0 }) : material.stock_minimo,
    ubicacion: 'ubicacion' in body ? requireString(body, 'ubicacion', { required: false }) : material.ubicacion,
    proveedor: 'proveedor' in body ? requireString(body, 'proveedor', { required: false }) : material.proveedor,
    precio_unitario:
      'precio_unitario' in body
        ? requireNumber(body, 'precio_unitario', { required: false, min: 0 })
        : material.precio_unitario,
  };

  if (fields.codigo !== material.codigo) {
    const existente = db.prepare('SELECT id FROM materiales WHERE codigo = ? AND id != ?').get(fields.codigo, id);
    if (existente) throw new ApiError(409, `Ya existe un material con el codigo "${fields.codigo}"`);
  }

  db.prepare(
    `UPDATE materiales SET codigo = ?, nombre = ?, categoria = ?, unidad_medida = ?, stock_minimo = ?,
       ubicacion = ?, proveedor = ?, precio_unitario = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    fields.codigo,
    fields.nombre,
    fields.categoria,
    fields.unidad_medida,
    fields.stock_minimo,
    fields.ubicacion,
    fields.proveedor,
    fields.precio_unitario,
    id
  );

  return getMaterial(id);
}

function deleteMaterial(id) {
  getMaterialOr404(id);
  db.prepare('DELETE FROM materiales WHERE id = ?').run(id);
}

// ---------- Movimientos ----------

function listMovimientos(query) {
  let sql = `
    SELECT mv.*, m.codigo AS material_codigo, m.nombre AS material_nombre, m.unidad_medida
    FROM movimientos mv
    JOIN materiales m ON m.id = mv.material_id
  `;
  const clauses = [];
  const params = [];

  if (query.material_id) {
    clauses.push('mv.material_id = ?');
    params.push(query.material_id);
  }
  if (query.tipo) {
    clauses.push('mv.tipo = ?');
    params.push(query.tipo);
  }
  if (query.desde) {
    clauses.push('date(mv.fecha) >= date(?)');
    params.push(query.desde);
  }
  if (query.hasta) {
    clauses.push('date(mv.fecha) <= date(?)');
    params.push(query.hasta);
  }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY mv.fecha DESC, mv.id DESC';

  const limit = Math.min(Number(query.limit) || 200, 500);
  sql += ' LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

function createMovimiento(body) {
  const material_id = requireNumber(body, 'material_id', { min: 1 });
  const tipo = requireString(body, 'tipo');
  const cantidad = requireNumber(body, 'cantidad', { min: 0.0001 });
  const motivo = requireString(body, 'motivo', { required: false });
  const documento_referencia = requireString(body, 'documento_referencia', { required: false });
  const responsable = requireString(body, 'responsable', { required: false });

  if (!['ingreso', 'salida'].includes(tipo)) {
    throw new ApiError(400, 'El campo "tipo" debe ser "ingreso" o "salida"');
  }

  const material = getMaterialOr404(material_id);

  let nuevoStock;
  if (tipo === 'ingreso') {
    nuevoStock = material.stock_actual + cantidad;
  } else {
    if (cantidad > material.stock_actual) {
      throw new ApiError(
        400,
        `Stock insuficiente: hay ${material.stock_actual} ${material.unidad_medida} disponibles de "${material.nombre}"`
      );
    }
    nuevoStock = material.stock_actual - cantidad;
  }

  const result = db
    .prepare(
      `INSERT INTO movimientos (material_id, tipo, cantidad, motivo, documento_referencia, responsable, stock_resultante)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(material_id, tipo, cantidad, motivo, documento_referencia, responsable, nuevoStock);

  db.prepare(`UPDATE materiales SET stock_actual = ?, updated_at = datetime('now') WHERE id = ?`).run(
    nuevoStock,
    material_id
  );

  const movimiento = db
    .prepare(
      `SELECT mv.*, m.codigo AS material_codigo, m.nombre AS material_nombre, m.unidad_medida
       FROM movimientos mv JOIN materiales m ON m.id = mv.material_id WHERE mv.id = ?`
    )
    .get(result.lastInsertRowid);

  return { movimiento, material: getMaterial(material_id) };
}

// ---------- Alertas / resumen ----------

function listAlertas() {
  return listMateriales({})
    .filter((m) => m.critico)
    .sort((a, b) => a.stock_actual - a.stock_minimo - (b.stock_actual - b.stock_minimo));
}

function listCategorias() {
  return db
    .prepare('SELECT DISTINCT categoria FROM materiales WHERE categoria IS NOT NULL ORDER BY categoria')
    .all()
    .map((r) => r.categoria);
}

function resumen() {
  const materiales = listMateriales({});
  const alertas = materiales.filter((m) => m.critico);
  const movimientosHoy = db
    .prepare("SELECT COUNT(*) AS n FROM movimientos WHERE date(fecha) = date('now')")
    .get().n;
  const valorInventario = materiales.reduce(
    (acc, m) => acc + (m.precio_unitario || 0) * m.stock_actual,
    0
  );

  return {
    total_materiales: materiales.length,
    total_alertas: alertas.length,
    movimientos_hoy: movimientosHoy,
    valor_inventario: valorInventario,
  };
}

module.exports = {
  ApiError,
  listMateriales,
  getMaterial,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  listMovimientos,
  createMovimiento,
  listAlertas,
  listCategorias,
  resumen,
};
