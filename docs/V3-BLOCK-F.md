# V3 — Bloque F: Gestión de Trabajos

Estado: **100% estructural/code/documentación**.

Fases 38–46: motor de trabajos, ciclo de estados, asignación y programación, detalle operativo, checklist/tareas, costos de materiales y mano de obra, registro de tiempos, notas/evidencias e integración admin/cliente.

Migración: `migrations/021_v3_jobs.sql`.

Admin: `/trabajos-v3.html`.

API: `/api/v3/admin/jobs` y `/api/v3/client/jobs/:id`.

La migración 021 no se ejecutó contra la base MySQL real durante esta implementación; debe aplicarse antes del uso productivo.
