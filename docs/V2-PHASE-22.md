# Fase 22 — Migración V1 → V2

## Objetivo

Completar la migración operativa desde una base V1 hacia el esquema V2 sin borrar datos existentes y dejando trazabilidad del proceso.

## Flujo

1. Confirmar .env y conexión MySQL.
2. Ejecutar primero npm run migration:v1-v2:dry-run.
3. Revisar tablas V1 detectadas, migraciones pendientes y tablas V2 faltantes.
4. Crear un backup obligatorio.
5. Ejecutar npm run migration:v1-v2 -- --yes.
6. El proceso utiliza el runner oficial de migraciones del proyecto.
7. Se verifica que las tablas V2 requeridas existan.
8. Se comparan cantidades de filas de las tablas de negocio antes y después.
9. Se verifica que exista al menos un administrador.
10. Se registra el resultado en v2_migration_runs.

## Datos preservados

La migración no elimina ni recrea las tablas de negocio V1. Se conservan usuarios, roles, servicios, solicitudes, presupuestos, conceptos, trabajos, galería, notificaciones y configuración existente.

Los archivos de public/uploads no son borrados por el proceso. Los documentos V2 utilizan el almacenamiento privado definido por el proyecto.

## Usuarios y seguridad

Los password_hash existentes se conservan. No se convierten contraseñas ni se almacenan contraseñas en texto plano.

Las sesiones y tokens temporales no se consideran datos de negocio y no se migran como registros funcionales.

## Idempotencia

El proceso usa schema_migrations y el runner oficial para no aplicar dos veces una migración ya registrada. Puede volver a ejecutarse después de una ejecución completada; las migraciones registradas no se repiten.

Antes de una migración real es obligatorio pasar --yes. Sin esa bandera, el proceso no modifica el esquema.

## Backup y rollback

El backup se crea inmediatamente antes de ejecutar las migraciones reales. Si la migración falla, no se declara completada y queda un registro failed.

Rollback recomendado:

1. Detener la aplicación.
2. Conservar el backup generado por el proceso.
3. Restaurar ese backup sobre una base de recuperación o sobre la base original cuando corresponda.
4. Verificar integridad y conteos.
5. Revisar v2_migration_runs.
6. Volver a intentar la migración sólo después de corregir la causa.

No se ejecuta un rollback destructivo automático porque restaurar una base de datos debe apuntar al backup correcto.

## Archivos

- scripts/migrate-v1-to-v2.js: preflight, dry-run, backup, migración y verificación.
- migrations/015_v2_migration.sql: trazabilidad.
- scripts/check-v2-migration.js: checker estructural.
- docs/V2-PHASE-22.md: procedimiento.

## Limitación

El repositorio no contiene la base MySQL viva. Esta implementación prepara y automatiza la migración, pero no afirma haber migrado una base de producción. La ejecución real debe hacerse sobre una copia/backup de la base V1 y verificarse con el reporte generado.
