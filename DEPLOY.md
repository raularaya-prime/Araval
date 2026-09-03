# Despliegue en un servidor real

La app no tiene dependencias externas (usa `http` y `node:sqlite` nativos de
Node.js), así que desplegarla es simplemente: tener Node 22.5+ en el
servidor, copiar el código, y mantener el proceso vivo. Elige una de las dos
rutas de abajo según el tipo de servidor que tengas.

> ⚠️ **Revisa las credenciales del primer arranque.** La app pide login,
> pero el usuario administrador inicial se crea automáticamente con una
> contraseña que solo se muestra una vez en los logs (o la que tú definas
> por variable de entorno). Ver [Seguridad y acceso](#seguridad-y-acceso).

## Requisitos

- Un servidor Linux (VPS, servidor on-prem, etc.) con acceso SSH.
- Node.js **22.5 o superior** (requiere el módulo `node:sqlite`).
- Un dominio o IP fija si quieres acceder por nombre y con HTTPS.

---

## Opción A: servidor Linux con systemd (recomendada)

### 1. Instalar Node.js 22 en el servidor

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # debe ser >= 22.5
```

### 2. Crear un usuario de servicio y traer el código

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin araval
sudo -u araval git clone https://github.com/raularaya-prime/Araval.git /home/araval/app
```

Para actualizaciones futuras: `cd /home/araval/app && sudo -u araval git pull`.

### 3. Crear el servicio systemd

Crea `/etc/systemd/system/araval.service`:

```ini
[Unit]
Description=Araval Inventario - bodega de insumos
After=network.target

[Service]
Type=simple
User=araval
WorkingDirectory=/home/araval/app
ExecStart=/usr/bin/node server/index.js
Environment=PORT=3000
Restart=on-failure
RestartSec=5

# Endurecimiento básico
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/home/araval/app/data

[Install]
WantedBy=multi-user.target
```

Actívalo:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now araval
sudo systemctl status araval        # debe decir "active (running)"
curl -s http://localhost:3000/api/resumen   # prueba rápida
```

Los datos quedan en `/home/araval/app/data/inventario.db`. Ese archivo se
crea solo la primera vez, con los materiales de ejemplo — bórralo antes del
primer arranque en producción si no los quieres (`rm -rf data` antes de
iniciar el servicio la primera vez).

Ver logs: `journalctl -u araval -f`.

### 4. Poner Nginx delante (dominio + HTTPS)

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/araval`:

```nginx
server {
    listen 80;
    server_name inventario.tu-dominio.cl;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/araval /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d inventario.tu-dominio.cl   # emite y configura HTTPS
```

---

## Opción B: Docker

Si prefieres contenedores, no hay `Dockerfile` en el repo todavía — este es
uno mínimo que puedes agregar como `Dockerfile` en la raíz:

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY . .
ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
```

Construir y correr:

```bash
docker build -t araval-inventario .
docker run -d --name araval \
  -p 3000:3000 \
  -v araval-data:/app/data \
  --restart unless-stopped \
  araval-inventario
```

El volumen `araval-data` persiste `data/inventario.db` entre reinicios del
contenedor. Delante de esto puedes poner el mismo bloque de Nginx + certbot
de la Opción A (apuntando a `127.0.0.1:3000` igual).

Avísame si quieres que agregue este `Dockerfile` (y opcionalmente un
`docker-compose.yml`) al repositorio.

---

## Seguridad y acceso

La app tiene login incorporado (usuario/contraseña + sesión por cookie).
Todas las rutas — la interfaz y la API — exigen sesión iniciada; sin ella,
el navegador es redirigido a `/login` y las llamadas a la API responden 401.

### Primer arranque: usuario administrador

En el primer arranque (cuando la tabla de usuarios está vacía) se crea un
único usuario automáticamente:

- **Usuario**: `admin`, o el valor de la variable de entorno
  `ADMIN_USERNAME`.
- **Contraseña**: el valor de `ADMIN_PASSWORD` si la defines; si no, se
  genera una aleatoria y se imprime **una sola vez** en los logs al arrancar
  (`journalctl -u araval` o `docker logs araval`). Guárdala en ese momento —
  no se vuelve a mostrar — o cámbiala luego desde la app (botón "Cambiar
  contraseña" en el encabezado).

Para fijar la contraseña inicial en vez de dejar que se genere:

```bash
# systemd: agrega a la sección [Service] de araval.service
Environment=ADMIN_USERNAME=bodega
Environment=ADMIN_PASSWORD=una-clave-fuerte-aqui

# Docker: pásalas como -e al correr el contenedor
docker run -d --name araval -p 3000:3000 -v araval-data:/app/data \
  -e ADMIN_USERNAME=bodega -e ADMIN_PASSWORD=una-clave-fuerte-aqui \
  --restart unless-stopped araval-inventario
```

Las sesiones duran 7 días por defecto (`SESSION_DAYS`).

### Usuarios adicionales

Con la cuenta del administrador puedes crear más usuarios desde la pestaña
"Usuarios" (solo visible para administradores): usuario + contraseña
inicial, con o sin rol de administrador. Desde ahí también se puede
resetear la contraseña de otro usuario, promover/quitar el rol de admin, o
eliminar una cuenta. Protecciones incorporadas: nadie puede eliminarse ni
quitarse el rol de administrador a sí mismo (usa "Cambiar contraseña" en el
encabezado para tu propia cuenta), ni dejar al sistema sin ningún
administrador. Actualizar una instalación que ya tenía un único usuario
(de antes de esta función) lo asciende automáticamente a administrador la
primera vez que arranca con el código nuevo.

### Aun así, usa HTTPS

El login es solo tan seguro como el transporte: sin HTTPS, la contraseña y
la cookie de sesión viajan en texto plano. La sección de Nginx + Certbot de
arriba ya deja esto resuelto — no lo saltes en producción. Detrás de ese
proxy, la cookie de sesión se marca `Secure` automáticamente (la app detecta
el header `X-Forwarded-Proto` que ya viene configurado en el bloque Nginx).

Para capas adicionales (uso solo interno, defensa en profundidad), sigue
siendo válido restringir por VPN/red interna o sumar HTTP Basic Auth en
Nginx delante del login de la app.

## Backups

Todo el estado vive en un único archivo SQLite: `data/inventario.db`.
Respaldarlo es copiar ese archivo (hazlo con el servicio detenido o con
`sqlite3 data/inventario.db ".backup data/backup-$(date +%F).db"` para una
copia consistente en caliente). Un cron diario simple:

```cron
0 3 * * * sqlite3 /home/araval/app/data/inventario.db ".backup /home/araval/backups/inventario-$(date +\%F).db"
```

## Variables de entorno

| Variable | Default | Descripción |
| --- | --- | --- |
| `PORT` | `3000` | Puerto donde escucha el servidor HTTP |
| `ADMIN_USERNAME` | `admin` | Usuario administrador creado en el primer arranque |
| `ADMIN_PASSWORD` | (aleatoria, se imprime en logs) | Contraseña del administrador en el primer arranque |
| `SESSION_DAYS` | `7` | Duración de la sesión iniciada antes de expirar |
