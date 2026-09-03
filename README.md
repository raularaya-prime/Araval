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
- **Login**: toda la app (interfaz y API) requiere sesión iniciada. En el primer arranque
  se crea un usuario administrador con contraseña generada (o la que definas por variable
  de entorno); cada usuario puede cambiar su contraseña desde la app.

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

Luego abre `http://localhost:3000`. Te va a pedir login — revisa la consola/log
al arrancar: ahí se imprime el usuario y contraseña del administrador creado
en el primer arranque (solo se muestra esa vez).

Variables de entorno opcionales: `PORT` (por defecto `3000`), `ADMIN_USERNAME`,
`ADMIN_PASSWORD`, `SESSION_DAYS` — ver [DEPLOY.md](DEPLOY.md#variables-de-entorno).

Para desplegarla en un servidor real (systemd, Docker, Nginx + HTTPS, backups),
ver [DEPLOY.md](DEPLOY.md).

## Estructura

```
server/
  index.js    servidor HTTP + enrutamiento de la API + archivos estáticos + puerta de login
  api.js      lógica de negocio (materiales, movimientos, alertas)
  auth.js     sesiones, cookies, rate limiting de login
  password.js hash/verificación de contraseñas (scrypt)
  db.js       esquema SQLite, datos de ejemplo y usuario administrador inicial
public/
  index.html  interfaz (Panel, Inventario, Movimientos, Alertas)
  app.js      lógica de la interfaz (fetch a la API, render de tablas, modales)
  styles.css  estilos
  login.html  página de inicio de sesión
  login.js    lógica del formulario de login
data/
  inventario.db  base de datos SQLite (generada al ejecutar, no versionada)
```

## API

Todas las rutas (excepto `/api/login`) requieren sesión iniciada; sin ella
responden `401`.

| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | `/api/login` | Inicia sesión (`username`, `password`) |
| POST | `/api/logout` | Cierra la sesión actual |
| GET | `/api/me` | Usuario de la sesión activa |
| POST | `/api/cambiar-password` | Cambia la contraseña (`password_actual`, `password_nueva`) |
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
