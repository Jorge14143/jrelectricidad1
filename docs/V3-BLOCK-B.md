# V3.0 — Bloque B: Página pública V3

## Fases 5–13 — 100% estructuradas

- Home V3: hero, propuesta de valor, estadísticas y navegación responsive.
- Servicios públicos: catálogo dinámico desde MySQL y CTA directo.
- Galería pública: categorías, destacados y lightbox.
- Testimonios: publicación únicamente de registros aprobados; no se generan reseñas ficticias.
- Solicitud de presupuesto: formulario público reutilizando el endpoint V2 existente.
- Agenda pública: disponibilidad por fecha y solicitudes de turno V3.
- SEO: title, description, canonical, Open Graph, Schema.org, sitemap y robots.
- Contacto: teléfono, WhatsApp, email y zona de atención.
- PWA: manifest y service worker.

La migración `017_v3_public.sql` agrega las tablas de testimonios y agenda y amplía la configuración V3. No se considera ejecutada sobre la base real hasta correr el migrador.

## Verificación

Ejecutar:

`npm run test:v3-public`

El checker valida archivos, rutas V3, migración, SEO y PWA.

## Nota

La implementación está versionada en `v2-development`. La ejecución real de MySQL, pruebas de navegador y despliegue de producción deben verificarse en el entorno del servidor antes de declarar una validación operativa final.