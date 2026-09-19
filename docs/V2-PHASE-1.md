# JR Electricidad V2 — Fase 1

## Objetivo
Crear una base de arquitectura compatible con V1 sin modificar la rama main.

## Incluido
- Migraciones versionadas.
- Registro de migraciones aplicadas.
- Auditoría de acciones.
- Registro de intentos de inicio de sesión.
- Logger estructurado con timestamp y metadatos.
- ID único por solicitud.
- Helpers de respuestas API.
- Validadores reutilizables.
- Manejo global de errores existente preparado para usar el logger.
- Script de validación de la fase.

## Regla de despliegue
La rama main permanece estable. V2 se desarrolla en v2-development y se valida antes de desplegar.

## Migraciones
Las migraciones se ejecutan automáticamente al iniciar V2, antes de levantar el servidor.

## Verificación
Ejecutar:

npm test
node scripts/check-v2-foundation.js
