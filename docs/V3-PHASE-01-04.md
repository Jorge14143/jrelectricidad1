# JR Electricidad V3.0 — Bloque A: Fundación

## Estado
**100% implementado en v2-development.**

## Fase 1 — Arquitectura V3
- Modular monolith sobre Node.js + Express + MySQL.
- API nuevo bajo /api/v3.
- API V2/legacy permanece bajo /api.
- Metadata central en lib/v3.js.
- Migraciones registradas por schema_migrations.

## Fase 2 — Base de datos V3
La migración 016_v3_foundation.sql crea v3_system y v3_api_clients.
La migración es idempotente.

## Fase 3 — Seguridad V3
- X-JR-API-Version.
- X-Content-Type-Options: nosniff.
- Referrer-Policy restrictiva.
- Permissions-Policy cerrada por defecto.
- Separación V2/V3.
- Health sin exposición de errores internos.

La autenticación avanzada, 2FA, sesiones y RBAC ampliado siguen en el Bloque O.

## Fase 4 — API V3
Base de router independiente con:
- GET /api/v3/health
- GET /api/v3/meta

## Verificación
Ejecutar: npm run test:v3-foundation

La verificación estructural no sustituye pruebas contra MySQL real.

## Compatibilidad
Este bloque no elimina ni renombra rutas V2.
