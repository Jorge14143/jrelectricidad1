# V2 — Fase 5: Solicitudes

## Estado
**100% implementada en `v2-development`.**

## Incluye
- Flujo de estados:
  - Nueva
  - En revisión
  - Presupuestando
  - Presupuestada
  - Aceptada
  - Programada
  - En trabajo
  - Finalizada
  - Cerrada
- Prioridad: baja, normal, alta, urgente.
- Asignación a usuario/técnico.
- Fecha y hora programada.
- Notas internas.
- Fecha de cierre automática para solicitudes finalizadas/cerradas.
- Historial de cambios con actor, estado anterior/nuevo y metadatos.
- Archivos adjuntos de hasta 10 MB: imágenes, PDF, Office y texto.
- Eliminación segura de adjuntos desde el panel.
- Relación con cliente, presupuesto y trabajo.
- Conversión de solicitud a presupuesto borrador.
- Conversión de solicitud a trabajo; si no existe presupuesto, crea uno borrador.
- Notificación administrativa al cambiar el estado.
- Notificación por email al cliente cuando el estado cambia, si SMTP está configurado.
- Compatibilidad con el endpoint V1 de cambio de estado.
- Búsqueda, filtros por estado/prioridad/técnico/fechas.
- Panel de gestión completo desde el detalle de solicitud.
- Auditoría de cambios y adjuntos.

## Migración
`migrations/005_requests.sql`

Crea:
- columnas avanzadas en `quote_requests`
- `quote_request_history`
- `quote_request_attachments`

También migra los estados V1 a los nuevos estados V2.

## Validación
`npm run test:v2-requests`

## Seguridad
Los cambios administrativos requieren autenticación de administrador y están protegidos por el rate limit de mutaciones, CSRF/Origin y auditoría de V2.

## Producción
Esta fase se implementó únicamente en la rama `v2-development`. No se modificó `main` ni producción.
