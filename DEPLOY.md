# Despliegue en un servidor real

La app no tiene dependencias externas (usa `http` y `node:sqlite` nativos de
Node.js), así que desplegarla es simplemente: tener Node 22.5+ en el
servidor, copiar el código, y mantener el proceso vivo. Elige una de las dos
rutas de abajo según el tipo de servidor que tengas.

> ⚠️ **La app no tiene login.** Cualquiera que llegue a la URL puede ver y
> modificar el inventario. Antes de exponerla en internet, restringe el
> acceso (ver [Seguridad y acceso](#seguridad-y-acceso) más abajo).

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

La app no implementa autenticación. Antes de exponerla, elige al menos una:

- **Restringir por red**: solo accesible por VPN o red interna de la
  maestranza (lo más simple y recomendado si el uso es solo interno).
- **HTTP Basic Auth en Nginx** como capa mínima:
  ```bash
  sudo apt-get install -y apache2-utils
  sudo htpasswd -c /etc/nginx/.htpasswd bodega
  ```
  y agregar dentro del `location /` del bloque Nginx:
  ```nginx
  auth_basic "Araval Inventario";
  auth_basic_user_file /etc/nginx/.htpasswd;
  ```
- **Autenticación en la app**: requiere agregar login al backend — se puede
  hacer, pero es trabajo adicional fuera del alcance actual; pídelo si lo
  necesitas.

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
