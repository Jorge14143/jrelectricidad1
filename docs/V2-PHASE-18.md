# Fase 18 — Backups

## Estado
**Completada al 100% a nivel de implementación.**

## Implementado

- Tabla `backups` para registrar copias, tamaño, SHA-256, estado, usuario y fechas.
- Servicio `lib/backups.js`.
- Backup completo de MySQL mediante `mysqldump`.
- Parámetros seguros con `child_process.spawn()`; la contraseña no se agrega a los argumentos del proceso y se utiliza `MYSQL_PWD`.
- Soporte para:
  - transacción consistente;
  - rutinas;
  - triggers;
  - eventos;
  - blobs en hexadecimal;
  - UTF-8.
- Almacenamiento privado por defecto en `storage/backups`, fuera de `public/`.
- `BACKUP_DIR` permite cambiar la ubicación.
- `MYSQLDUMP_PATH` permite indicar la ruta del ejecutable en Windows/Linux.
- SHA-256 de cada archivo.
- Panel de administración para:
  - listar backups;
  - crear backup manual;
  - descargar;
  - eliminar;
  - ejecutar limpieza;
  - consultar retención.
- Retención configurable mediante `BACKUP_RETENTION_DAYS` (30 días por defecto).
- Limpieza automática después de crear una copia.
- Auditoría de creación, descarga, eliminación, limpieza y errores.
- Script CLI para automatización:

```bash
npm run backup:v2
```

## Variables recomendadas

```env
BACKUP_DIR=
BACKUP_RETENTION_DAYS=30
MYSQLDUMP_PATH=mysqldump
```

En Windows, si MySQL no está en PATH, se puede establecer `MYSQLDUMP_PATH` con la ruta completa al ejecutable.

## Automatización

### Windows Task Scheduler

Programar:

```text
Programa: npm.cmd
Argumentos: run backup:v2
Directorio inicial: C:\ruta\del\proyecto
```

Se recomienda ejecutar el proceso con el mismo usuario que tenga permisos sobre el proyecto y el directorio de backups.

### Linux / cron

Ejemplo diario:

```cron
0 3 * * * cd /ruta/jrelectricidad1 && /usr/bin/npm run backup:v2 >> /var/log/jr-electricidad-backup.log 2>&1
```

## Restauración

La restauración deliberadamente **no se expone como botón remoto del panel** para evitar una operación destructiva accidental.

Para restaurar una copia, primero detener las operaciones de escritura de la aplicación y verificar el SHA-256 del archivo. Después utilizar el cliente MySQL o `mysql` sobre una copia verificada.

Ejemplo conceptual:

```bash
mysql -h HOST -P 3306 -u USUARIO -p BASE_DE_DATOS < backup.sql
```

La restauración debe realizarse con un backup previamente verificado y, preferentemente, en una ventana de mantenimiento.

## Seguridad

- Las rutas de descarga se resuelven a partir del ID de base de datos, no de una ruta enviada por el navegador.
- Se valida que el archivo quede dentro del directorio configurado de backups.
- Los endpoints requieren administrador.
- Las mutaciones usan el rate limiter administrativo existente.
- Los archivos no se sirven mediante `express.static`.
- El SHA-256 permite detectar modificaciones del archivo.

## Verificación

Se agregó:

```bash
npm run test:v2-backups
```

Este checker valida la estructura del código y la integración. La creación real del dump requiere un entorno con Node.js, MySQL, credenciales válidas y `mysqldump` instalado.

## Resultado

Fase 18 implementada: **Backups** con gestión desde el panel, almacenamiento privado, integridad SHA-256, retención, auditoría y soporte de automatización.
