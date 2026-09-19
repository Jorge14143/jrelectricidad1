# Release V3 — JR Electricidad

## Alcance
V3 consolida la gestión del servicio eléctrico desde la solicitud hasta el cobro, con administración, trabajos, agenda, comunicaciones, firma, evidencias, materiales técnicos, finanzas, seguridad, automatizaciones y controles de calidad/producción.

## Regla económica
Solo los servicios forman parte de la economía y facturación del sistema. Los materiales son información técnica.

## Verificaciones
Antes de declarar una versión lista:
- npm test
- npm run prod:check
- npm run prod:preflight
- npm run health

## Publicación
El release de código debe desplegarse mediante el procedimiento documentado en docs/PRODUCCION-V3.md. Esta documentación no implica que el servidor público haya sido actualizado automáticamente.

## Recuperación
Conservar el backup previo y utilizar el procedimiento documentado si el despliegue debe revertirse.
