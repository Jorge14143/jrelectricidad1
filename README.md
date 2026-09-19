# JR Electricidad

**V3.0.0 — Fundación V3 en desarrollo sobre la rama `v2-development`.**

Sitio web para **JR Electricidad | Electricista Matriculado Cat. 3**, desarrollado con Node.js, Express y MySQL.

## Requisitos

- Node.js 24+
- MySQL 8+
- npm

## Instalación local

1. Clonar el repositorio.
2. Ejecutar `npm install`.
3. Crear la base de datos `jr_electricidad`.
4. Importar `schema.sql`.
5. Copiar `.env.example` como `.env`.
6. Completar las credenciales de MySQL, sesión y correo.
7. Ejecutar `npm start`.

## Producción

- Usar `NODE_ENV=production`.
- Generar un `SESSION_SECRET` largo y aleatorio.
- No subir `.env`.
- Mantener `public/uploads` fuera del repositorio.
- Colocar HTTPS mediante un reverse proxy.
- Configurar `APP_URL` con el dominio real.
- Configurar SMTP para recuperación de contraseñas y envío de presupuestos.
- Verificar `GET /health` después del despliegue.
- Ejecutar la aplicación con PM2 o un servicio equivalente.

## Funcionalidades

- Registro, inicio de sesión y recuperación de contraseña.
- Panel administrador.
- Usuarios y roles.
- Clientes consolidados desde solicitudes y presupuestos.
- Solicitudes de presupuesto.
- Presupuestos con PDF y envío por email.
- Aceptación/rechazo mediante enlace seguro.
- Gestión y seguimiento de trabajos.
- Historial de trabajos cerrados.
- Servicios.
- Galería.
- Notificaciones administrativas.
- Configuración de cuenta.
- Dashboard con estadísticas.

## Seguridad

El proyecto incluye sesiones MySQL, bcrypt, Helmet, rate limiting, validación de uploads, tokens de acceso para presupuestos y controles de autorización para las rutas administrativas.

## Migración V1 → V2

Antes de migrar una base V1 existente:

- Ejecutar `npm run migration:v1-v2:dry-run`.
- Revisar las tablas detectadas y las migraciones pendientes.
- Ejecutar `npm run migration:v1-v2` sólo sobre una copia/backup verificable de la base.
- El proceso crea un backup obligatorio antes de modificar el esquema.
- La ejecución queda registrada en `v2_migration_runs`.
- La verificación compara los conteos de las tablas de negocio y valida las estructuras V2 principales.

Para revisar la implementación de la fase:

`npm run test:v2-migration`

La migración real de una base de producción no se considera ejecutada hasta realizarla sobre la instancia MySQL correspondiente y comprobar su reporte.

## V3.0 — Bloque A

La Fundación V3 establece la arquitectura modular, la migración base, la capa de seguridad inicial y el API versionado en /api/v3. La API V2 existente permanece compatible.

Ver: docs/V3-PHASE-01-04.md

Comprobación: npm run test:v3-foundation
