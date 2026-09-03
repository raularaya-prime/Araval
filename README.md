# Araval Inventario

Herramienta web para registrar el inventario de la bodega de insumos de una maestranza
metalmecánica: control de ingresos y salidas de materia prima, y alertas automáticas
cuando algún insumo cae bajo su stock mínimo (crítico).

## Características

- **Inventario de materiales**: código, nombre, categoría, unidad de medida, stock
  actual, stock mínimo, ubicación en bodega, proveedor y precio unitario.
- **Movimientos de ingreso y salida**: cada movimiento actualiza el stock automáticamente
  y queda registrado en un historial con fecha, cantidad, documento/OT y responsable.
  No se permite registrar una salida mayor al stock disponible.
- **Alertas de stock crítico**: un material queda marcado como crítico cuando su stock
  actual es menor o igual a su stock mínimo. Se muestran en el Panel, en una pestaña
  dedicada de Alertas (con contador en la navegación) y opcionalmente como notificaciones
  del navegador.
- **Panel de control**: resumen con total de materiales, cantidad en alerta, movimientos
  del día y valor total del inventario.

## Stack

- Backend: Node.js (`http` nativo) + `node:sqlite` (sin dependencias externas).
- Frontend: HTML/CSS/JS sin build step, servido como archivos estáticos.
- Base de datos: SQLite, archivo local en `data/inventario.db` (se crea automáticamente
  con datos de ejemplo la primera vez que se ejecuta).

Requiere **Node.js 22.5 o superior** (usa el módulo experimental `node:sqlite`).

## Uso

```bash
npm start
# o para reiniciar automáticamente ante cambios:
npm run dev
```

Luego abre `http://localhost:3000`.

Variable de entorno opcional: `PORT` (por defecto `3000`).

Para desplegarla en un servidor real (systemd, Docker, Nginx + HTTPS, backups),
ver [DEPLOY.md](DEPLOY.md).

## Estructura

```
server/
  index.js    servidor HTTP + enrutamiento de la API + archivos estáticos
  api.js      lógica de negocio (materiales, movimientos, alertas)
  db.js       esquema SQLite y datos de ejemplo
public/
  index.html  interfaz (Panel, Inventario, Movimientos, Alertas)
  app.js      lógica de la interfaz (fetch a la API, render de tablas, modales)
  styles.css  estilos
data/
  inventario.db  base de datos SQLite (generada al ejecutar, no versionada)
```

## API

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/resumen` | Estadísticas para el panel |
| GET | `/api/materiales` | Lista materiales (filtros: `categoria`, `buscar`, `criticos`) |
| GET | `/api/materiales/:id` | Detalle de un material |
| POST | `/api/materiales` | Crea un material |
| PUT | `/api/materiales/:id` | Edita un material |
| DELETE | `/api/materiales/:id` | Elimina un material |
| GET | `/api/materiales/:id/movimientos` | Historial de un material |
| GET | `/api/movimientos` | Lista movimientos (filtros: `tipo`, `material_id`, `desde`, `hasta`, `limit`) |
| POST | `/api/movimientos` | Registra un ingreso o salida |
| GET | `/api/alertas` | Materiales con stock crítico |
| GET | `/api/categorias` | Categorías registradas |
