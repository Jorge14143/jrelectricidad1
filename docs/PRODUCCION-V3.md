# JR Electricidad — Producción V3

## Arquitectura
- Node.js 24+
- MySQL 8+
- PM2 mantiene el proceso Node activo.
- Nginx funciona como reverse proxy.
- HTTPS se termina en Nginx.

## Variables
Copiar .env.production.example a .env y completar credenciales reales.
Nunca subir .env al repositorio.

Validar:
npm run prod:preflight

## Base de datos
Backup:
npm run backup

Restauración:
CONFIRM_RESTORE=YES npm run restore -- backups/archivo.sql

## PM2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 status
pm2 logs jr-electricidad

## Nginx y HTTPS
Instalar deploy/nginx/jrelectricidad.conf como sitio de Nginx.
Validar la configuración y recargar Nginx.
Emitir el certificado HTTPS para jrelectricidad.dpdns.org con Certbot/Let's Encrypt.
Mantener disponible /.well-known/acme-challenge/ para renovaciones.

## Monitorización
npm run health
node scripts/monitor-health.js https://jrelectricidad.dpdns.org/health

## Recuperación
1. Detener PM2.
2. Crear backup si MySQL responde.
3. Restaurar el backup conocido.
4. Ejecutar npm install.
5. Ejecutar npm run prod:preflight.
6. Levantar PM2.
7. Comprobar /health.
8. Comprobar login, panel admin y flujo de presupuesto.

## Checklist
- [ ] .env configurado
- [ ] SESSION_SECRET fuerte
- [ ] MySQL accesible
- [ ] migraciones aplicadas
- [ ] backup probado
- [ ] PM2 activo
- [ ] Nginx activo
- [ ] HTTPS activo
- [ ] /health responde 200
- [ ] logs sin errores críticos
- [ ] recuperación probada
