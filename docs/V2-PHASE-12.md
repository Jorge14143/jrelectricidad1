# V2 — Fase 12: Email transaccional

## Estado
100% implementada en `v2-development`.

## Arquitectura
- Servicio central en `lib/email.js`.
- Cola/outbox persistente en MySQL mediante `email_outbox`.
- Configuración SMTP mediante variables de entorno existentes; no se guardan credenciales en la base.
- Procesamiento periódico cada 30 segundos.
- Reintentos progresivos: 1, 5, 15, 60 y 240 minutos.
- Estados: queued, sending, sent, failed y skipped.
- Registro del último error y del ID entregado por el proveedor.

## Plantillas
- Recuperación de contraseña.
- Verificación/cambio de correo y cuenta.
- Envío de presupuesto.
- Confirmación de aceptación/rechazo de presupuesto.
- Confirmación de solicitud recibida y cambios de estado.
- Actualizaciones de trabajos, programación, inicio y finalización.

## Seguridad
- No se almacenan contraseñas SMTP en MySQL.
- Se valida el destinatario antes de encolar.
- El contenido dinámico HTML se escapa en las plantillas.
- Los secretos siguen exclusivamente en `.env`.
- Los envíos quedan trazables por estado, intentos y request ID.

## Compatibilidad
Se mantiene Nodemailer y las variables SMTP existentes:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `APP_URL`.

Los flujos existentes de recuperación, verificación de cuenta, envío de presupuestos y confirmación de decisiones pasan por la cola.

## Operación
La cola se procesa automáticamente mientras el servidor está activo. Si SMTP no está configurado, los mensajes quedan marcados como `skipped` en lugar de bloquear el resto de la aplicación.

## Validación
`npm run test:v2-email`

Aplicar migraciones con:
`npm run migrate`

La fase se desarrolla únicamente en `v2-development`.
