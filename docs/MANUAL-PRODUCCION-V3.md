# Manual de producción — JR Electricidad V3

## Requisitos
- Node.js 24+
- MySQL 8+
- PM2
- Nginx
- certificado HTTPS

## Preparación
1. Configurar .env.
2. Ejecutar npm install.
3. Aplicar schema/migraciones.
4. Ejecutar npm run prod:preflight.
5. Ejecutar npm run prod:check.

## Arranque
pm2 start ecosystem.config.js
pm2 save

## Verificación
npm run health
node scripts/monitor-health.js https://jrelectricidad.dpdns.org/health

## Backup
npm run backup

## Recuperación
Detener PM2, conservar un backup del estado actual si es posible, restaurar el backup conocido, reinstalar dependencias, ejecutar preflight, iniciar PM2 y verificar /health y los flujos principales.

## HTTPS
Nginx termina HTTPS y reenvía al puerto interno de Node. El certificado debe mantenerse renovable.

## Logs
Revisar pm2 logs jr-electricidad y los logs de Nginx cuando haya errores.

## Seguridad
Nunca publicar .env, credenciales SMTP, contraseñas de base de datos o secretos de sesión.
