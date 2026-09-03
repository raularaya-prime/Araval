const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'inventario.db');
const isNewDatabase = !fs.existsSync(DB_PATH);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS materiales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    categoria TEXT,
    unidad_medida TEXT NOT NULL,
    stock_actual REAL NOT NULL DEFAULT 0,
    stock_minimo REAL NOT NULL DEFAULT 0,
    ubicacion TEXT,
    proveedor TEXT,
    precio_unitario REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL REFERENCES materiales(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'salida')),
    cantidad REAL NOT NULL CHECK (cantidad > 0),
    motivo TEXT,
    documento_referencia TEXT,
    responsable TEXT,
    fecha TEXT NOT NULL DEFAULT (datetime('now')),
    stock_resultante REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_movimientos_material ON movimientos(material_id);
  CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos(fecha);
`);

function seed() {
  const insert = db.prepare(`
    INSERT INTO materiales (codigo, nombre, categoria, unidad_medida, stock_actual, stock_minimo, ubicacion, proveedor, precio_unitario)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const materiales = [
    ['AC-PL-001', 'Plancha de acero A36 4x8 6mm', 'Acero', 'unidad', 12, 5, 'Estante A1', 'Aceros del Sur', 85000],
    ['AC-RD-002', 'Barra redonda acero 1020 25mm', 'Acero', 'metro', 40, 20, 'Estante A2', 'Aceros del Sur', 4500],
    ['AC-PF-003', 'Perfil angular 40x40x4mm', 'Acero', 'metro', 8, 15, 'Estante A3', 'Comercial Fierro Ltda', 3200],
    ['AC-TU-004', 'Tuberia acero SCH40 2"', 'Acero', 'metro', 25, 10, 'Estante A4', 'Aceros del Sur', 9800],
    ['SD-EL-005', 'Electrodo E6011 1/8"', 'Soldadura', 'kg', 6, 10, 'Estante B1', 'Soldaduras Chile', 3900],
    ['SD-EL-006', 'Electrodo E7018 1/8"', 'Soldadura', 'kg', 18, 10, 'Estante B1', 'Soldaduras Chile', 4200],
    ['SD-AL-007', 'Alambre MIG ER70S-6 0.9mm', 'Soldadura', 'rollo', 4, 6, 'Estante B2', 'Soldaduras Chile', 32000],
    ['GS-OX-008', 'Oxigeno industrial', 'Gases', 'cilindro', 3, 2, 'Patio de gases', 'Indura', 28000],
    ['GS-AC-009', 'Acetileno', 'Gases', 'cilindro', 1, 2, 'Patio de gases', 'Indura', 31000],
    ['CO-DC-010', 'Disco de corte 14" metal', 'Consumibles', 'unidad', 30, 20, 'Estante C1', 'Norton', 2500],
    ['CO-DD-011', 'Disco de desbaste 4.5"', 'Consumibles', 'unidad', 45, 25, 'Estante C1', 'Norton', 1200],
    ['PI-AN-012', 'Pintura anticorrosiva gris', 'Pintura', 'galon', 5, 4, 'Estante D1', 'Pinturas Industriales SA', 18000],
    ['PI-TH-013', 'Thinner acrilico', 'Pintura', 'galon', 2, 3, 'Estante D1', 'Pinturas Industriales SA', 9000],
    ['FE-PE-014', 'Perno hexagonal M12x50 grado 8.8', 'Fijaciones', 'caja', 7, 5, 'Estante E1', 'Fijaciones Andinas', 15000],
    ['FE-TU-015', 'Tuerca hexagonal M12', 'Fijaciones', 'caja', 9, 5, 'Estante E1', 'Fijaciones Andinas', 8000],
  ];

  for (const m of materiales) insert.run(...m);

  const materialIds = db.prepare('SELECT id, stock_actual FROM materiales').all();
  const insertMov = db.prepare(`
    INSERT INTO movimientos (material_id, tipo, cantidad, motivo, documento_referencia, responsable, fecha, stock_resultante)
    VALUES (?, 'ingreso', ?, 'Carga inicial de inventario', 'INV-INICIAL', 'Sistema', datetime('now'), ?)
  `);
  for (const m of materialIds) {
    insertMov.run(m.id, m.stock_actual, m.stock_actual);
  }
}

if (isNewDatabase) {
  seed();
}

module.exports = db;
