# Fase 19 — Servidor / Producción

## Estado

**Implementada al 100% a nivel de proyecto.**

## Producción

El proyecto queda preparado para ejecutarse detrás de un reverse proxy y administrarse con PM2.

### Variables obligatorias

En producción se validan:

- `DB_HOST`
- `DB_USER`
- `DB_NAME`
- `SESSION_SECRET`
- `APP_URL` cuando `NODE_ENV=production`

También se recomienda:

- `TRUST_PROXY=true` detrás de Nginx/Cloudflare.
- `NODE_ENV=production`
- `PORT=3000`

No se deben subir secretos reales al repositorio.

## PM2

Se agregó:

```text
ecosystem.config.cjs
```

Arranque:

```bash
npm ci
npm run migrate
pm2 start ecosystem.config.cjs
pm2 save
```

Verificación:

```bash
pm2 status
pm2 logs jr-electricidad
```

La configuración incluye reinicio automático, límite de memoria, tiempo mínimo de actividad, retardo de reinicio y apagado controlado.

## Health checks

### Liveness

```text
GET /health
```

Comprueba que la aplicación pueda consultar MySQL.

### Readiness

```text
GET /health/ready
```

Comprueba:

- variables de configuración esenciales;
- `APP_URL` en producción;
- `TRUST_PROXY=true` en producción;
- conexión MySQL.

Devuelve HTTP 200 cuando está lista y HTTP 503 cuando no lo está.

## Apagado seguro

Se implementó graceful shutdown para:

- SIGTERM;
- SIGINT;
- cierre controlado del servidor HTTP;
- espera limitada de conexiones;
- cierre del pool MySQL.

Esto evita cortar abruptamente operaciones al reiniciar el proceso.

## Nginx

Se agregó una plantilla en:

```text
deploy/nginx/jr-electricidad.conf
```

Está preparada para:

```text
Internet
   ↓
Nginx / Cloudflare
   ↓
127.0.0.1:3000
   ↓
JR Electricidad / Node.js
   ↓
MySQL
```

El reverse proxy conserva Host, IP original y protocolo para que la aplicación pueda trabajar correctamente con sesiones, auditoría y URLs HTTPS.

## HTTPS

El certificado TLS debe terminar en Nginx o Cloudflare. Node no necesita exponerse directamente a Internet.

Cuando se usa HTTPS delante de Node:

```env
NODE_ENV=production
TRUST_PROXY=true
APP_URL=https://tu-dominio
```

## Backups

La fase anterior deja disponible:

```bash
npm run backup:v2
```

y permite configurar:

```env
BACKUP_DIR=
BACKUP_RETENTION_DAYS=30
MYSQLDUMP_PATH=mysqldump
```

## Checklist de despliegue

```text
[ ] Node.js instalado
[ ] npm ci ejecutado
[ ] .env configurado
[ ] SESSION_SECRET aleatorio y largo
[ ] NODE_ENV=production
[ ] APP_URL correcta
[ ] TRUST_PROXY=true si hay reverse proxy
[ ] MySQL accesible
[ ] npm run migrate
[ ] npm run test:v2-backups
[ ] npm run backup:v2
[ ] pm2 start ecosystem.config.cjs
[ ] pm2 save
[ ] Nginx configurado
[ ] HTTPS activo
[ ] /health responde 200
[ ] /health/ready responde 200
[ ] firewall solo expone 80/443
[ ] puerto 3000 no expuesto públicamente
```

## Resultado

Fase 19 preparada para operación de producción con PM2, reverse proxy, health checks, validación de configuración, graceful shutdown y documentación de despliegue.
