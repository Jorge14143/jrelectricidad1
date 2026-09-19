# V3 — Bloque C: Portal Cliente

Estado: 100% estructural en código.

## Fases 14-21
1. Fundación del portal cliente.
2. Perfil y datos personales.
3. Dashboard/resumen.
4. Solicitudes de presupuesto.
5. Presupuestos y decisiones de aceptación/rechazo.
6. Trabajos y seguimiento.
7. Documentos.
8. Notificaciones y actividad.

## API
- GET /api/v3/client/overview
- GET/PUT /api/v3/client/profile
- GET/POST /api/v3/client/requests
- GET /api/v3/client/quotes
- POST /api/v3/client/quotes/:id/decision
- GET /api/v3/client/jobs
- GET /api/v3/client/documents
- GET /api/v3/client/activity
- GET /api/v3/client/notifications
- POST /api/v3/client/notifications/:id/read

## UI
- /portal.html
- public/js/v3-client.js
- public/css/v3-client.css

## Datos
La migración 018 crea perfil extendido, vínculos de portal y notificaciones privadas. El portal sincroniza vínculos con solicitudes, presupuestos, trabajos y documentos existentes cuando están relacionados con el cliente.

## Validación
Ejecutar:
`npm run test:v3-client`

Importante: el checker valida estructura y sintaxis local. La migración 018 debe ejecutarse en la base de datos real antes de usar el portal en producción.
