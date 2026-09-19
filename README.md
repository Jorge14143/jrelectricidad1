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


## V3.0 — Bloque B: Página pública V3

La rama `v2-development` incorpora el rediseño público V3: Home, servicios, galería, testimonios aprobados, solicitud de presupuesto, agenda online, SEO, contacto y PWA.

Migración requerida para agenda y testimonios:

`npm run migrate`

Verificación estructural:

`npm run test:v3-public`

La migración y la validación operativa sobre la instancia MySQL/servidor real deben ejecutarse antes del despliegue de producción.


## V3.0 — Bloque C completado

Portal Cliente V3 implementado al 100% estructuralmente: dashboard, perfil, solicitudes, presupuestos con decisión, trabajos, documentos, notificaciones y actividad.

- Portal: `/portal.html`
- API: `/api/v3/client/*`
- Migración: `migrations/018_v3_client_portal.sql`
- Checker: `npm run test:v3-client`
- Documentación: `docs/V3-BLOCK-C.md`

**Nota:** la migración 018 todavía debe ejecutarse en la base de datos real antes de usar estas funciones en producción.


## V3.0 — Bloque D completado

Agenda y Turnos V3 implementados al 100% estructuralmente: disponibilidad, agenda pública, turnos del cliente, calendario administrativo, confirmación/cancelación/reprogramación y recordatorios.

- Cliente: `/portal.html`
- Administración: `/agenda.html`
- API: `/api/v3/client/appointments` y `/api/v3/admin/appointments`
- Migración: `migrations/019_v3_appointments.sql`
- Checker: `npm run test:v3-agenda`
- Documentación: `docs/V3-BLOCK-D.md`

**Nota:** la migración 019 todavía debe ejecutarse en la base de datos real antes de usar todas las funciones del bloque.


## V3.0 — Bloque E completado

Presupuestos V3 implementados al 100% estructuralmente: cálculo, descuentos/impuestos, plantillas, versionado, envío, aceptación cliente, historial, PDF e integración portal/admin.

- Administración: `/presupuestos-v3.html`
- Cliente: `/portal.html`
- API: `/api/v3/admin/quotes` y `/api/v3/client/quotes`
- Migración: `migrations/020_v3_quotes.sql`
- Checker: `npm run test:v3-quotes`
- Documentación: `docs/V3-BLOCK-E.md`

**Nota:** la migración 020 todavía debe ejecutarse en la base de datos real antes de usar todas las funciones del bloque.

## V3.0 — Bloque F completado

Gestión de Trabajos V3 implementada al 100% estructuralmente: motor y ciclo de estados, asignación/programación, detalle operativo, checklist, costos, registro de tiempos, notas, eventos e integración con el portal cliente.

- Administración: `/trabajos-v3.html`
- API: `/api/v3/admin/jobs` y `/api/v3/client/jobs/:id`
- Migración: `migrations/021_v3_jobs.sql`
- Checker: `npm run test:v3-jobs`
- Documentación: `docs/V3-BLOCK-F.md`

**Nota:** la migración 021 todavía debe ejecutarse en la base de datos real antes de usar todas las funciones del bloque.
