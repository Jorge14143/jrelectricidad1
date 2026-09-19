# JR Electricidad V3 — Documentación general

JR Electricidad es un sistema profesional para gestionar servicios eléctricos: clientes, solicitudes, presupuestos, trabajos, agenda, facturación de servicios, cobros, gastos, comunicaciones, firmas, evidencias y administración.

## Regla comercial
JR Electricidad vende servicios eléctricos. Los materiales son información técnica de los trabajos y no son productos comerciales.

## Arquitectura
- Node.js + Express
- MySQL
- Sesiones persistidas en MySQL
- PM2
- Nginx
- HTTPS
- PDFKit
- Nodemailer

## Flujo principal
Solicitud → Presupuesto → Aceptación → Trabajo → Facturación del servicio → Pago → Finanzas.

## Flujo técnico de materiales
Presupuesto/Trabajo → Lista de materiales → Cantidades → PDF técnico independiente.

Los materiales no modifican el total económico del presupuesto.

## Operación diaria
1. Revisar solicitudes.
2. Preparar y enviar presupuestos.
3. Registrar aceptación/rechazo.
4. Planificar y ejecutar trabajos.
5. Registrar evidencias y tareas.
6. Registrar facturación del servicio.
7. Registrar pagos y gastos.
8. Revisar dashboard y finanzas.
9. Mantener backups y monitorización.

## Producción
Consultar docs/PRODUCCION-V3.md.
Ejecutar npm run prod:check antes de un despliegue.
GET /health debe responder correctamente.
npm test ejecuta las verificaciones de calidad V3.
