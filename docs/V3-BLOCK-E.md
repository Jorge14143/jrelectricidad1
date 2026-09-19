# V3 — Bloque E: Presupuestos V3

Estado: 100% estructural en código.

## Fases 28-37
1. Motor de presupuestos.
2. Conceptos e importes.
3. Descuentos e impuestos.
4. Plantillas.
5. Versionado.
6. Envío y estado.
7. Vista/aceptación cliente.
8. Historial y auditoría específica.
9. PDF.
10. Integración portal/admin.

## API
Cliente:
- GET /api/v3/client/quotes
- GET /api/v3/client/quotes/:id
- POST /api/v3/client/quotes/:id/decision

Admin:
- GET /api/v3/admin/quotes
- GET /api/v3/admin/quotes/:id
- POST /api/v3/admin/quotes/:id/recalculate
- POST /api/v3/admin/quotes/:id/send
- GET /api/v3/admin/quotes/:id/history
- GET /api/v3/admin/quotes/:id/pdf

## Datos
Migración 020: versiones, eventos, plantillas, impuesto y datos públicos del presupuesto.

## UI
- Administración: /presupuestos-v3.html
- Cliente: /portal.html

## Validación
Ejecutar `npm run test:v3-quotes`.

La migración 020 debe ejecutarse en MySQL real antes de utilizar todas las funciones del bloque.
