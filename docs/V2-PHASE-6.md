# V2 — Fase 6: Presupuestos

## Estado
**100% implementada en `v2-development`.**

## Incluye
- Creación de presupuestos desde una solicitud.
- Edición de presupuestos con conceptos, cantidades, unidades y precios.
- Cálculo de subtotal, descuento y total en servidor.
- Validación estricta de conceptos y valores.
- Numeración y enlace público seguro mediante token aleatorio.
- Estados:
  - Borrador
  - Enviado
  - Aceptado
  - Rechazado
  - Vencido
  - Cerrado
- Transiciones controladas de estado.
- Registro de fechas de envío, aceptación y rechazo.
- Historial de cambios con actor y metadatos.
- Búsqueda y filtros por estado y fechas.
- Detalle completo del presupuesto.
- PDF administrativo.
- Envío por email al cliente cuando SMTP está configurado.
- Actualización del estado de la solicitud al aceptar el presupuesto.
- Integración con trabajos.
- Eliminación limitada a presupuestos en borrador.
- Auditoría V2.
- UI administrativa con acciones de edición, PDF, envío y eliminación.

## Migración
`migrations/006_quotes.sql`

Crea:
- timestamps del ciclo de vida del presupuesto;
- índices de consulta;
- `quote_history`.

## Validación
`npm run test:v2-quotes`

## Producción
Solo se modificó `v2-development`. No se modificó `main` ni producción.
