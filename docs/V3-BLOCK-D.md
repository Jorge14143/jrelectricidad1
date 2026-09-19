# V3 — Bloque D: Agenda y Turnos

Estado: 100% estructural en código.

## Fases 22-27
1. Motor de disponibilidad y slots.
2. Agenda pública.
3. Turnos autenticados del cliente.
4. Agenda/calendario administrativo.
5. Confirmación, cancelación y reprogramación.
6. Recordatorios de turnos.

## API cliente
- GET/POST /api/v3/client/appointments
- PATCH /api/v3/client/appointments/:id/cancel
- PATCH /api/v3/client/appointments/:id/reschedule

## API administración
- GET /api/v3/admin/appointments
- PATCH /api/v3/admin/appointments/:id
- PATCH /api/v3/admin/appointments/:id/reschedule
- POST /api/v3/admin/appointments/reminders

## UI
- Público: agenda integrada en la Home V3.
- Cliente: /portal.html.
- Administración: /agenda.html.

## Base de datos
La migración 019 amplía `v3_appointments` con usuario/cliente, lifecycle, cancelación, reprogramación y recordatorios.

## Validación
Ejecutar `npm run test:v3-agenda`.

La migración 019 debe aplicarse a la base de datos real antes de utilizar todas las funciones del Bloque D.
