# V2 — Fase 9: Galería avanzada

## Estado

**100% implementada en `v2-development`.**

## Incluye

- CRUD completo de trabajos de galería.
- Upload seguro de JPG, PNG, WEBP y GIF.
- Validación real de firma del archivo.
- Límite de 5 MB por imagen.
- Categorías:
  - instalaciones
  - reparaciones
  - tableros
  - iluminacion
  - mantenimiento
  - otros
- Texto alternativo obligatorio.
- Publicar/ocultar.
- Destacar trabajos.
- Orden manual.
- Búsqueda y filtros por categoría/estado.
- Vinculación con cliente.
- Vinculación con presupuesto.
- Vinculación con trabajo finalizado/cerrado.
- Promoción directa de evidencias fotográficas de trabajos a la galería.
- Protección para no eliminar una evidencia de trabajo mientras está publicada en galería.
- Galería pública con filtros por categoría.
- Lightbox público.
- Auditoría de creación, edición, eliminación, orden y promoción.
- Compatibilidad con la galería existente de V1.

## API

### Pública

- `GET /api/gallery`
- `GET /api/gallery?category=instalaciones`

### Administrativa

- `GET /api/admin/gallery`
- `GET /api/admin/gallery/:id`
- `POST /api/admin/gallery`
- `PUT /api/admin/gallery/:id`
- `DELETE /api/admin/gallery/:id`
- `PUT /api/admin/gallery/:id/order`
- `GET /api/admin/gallery/categories`
- `POST /api/admin/gallery/from-job-attachment/:attachmentId`

## Seguridad

Las imágenes subidas pasan por:

1. Filtro MIME.
2. Límite de tamaño.
3. Validación de firma binaria.
4. Nombre de archivo aleatorio.
5. Almacenamiento dentro de `public/uploads`.

Las relaciones con clientes, presupuestos y trabajos se validan en servidor.

Una evidencia publicada desde un trabajo queda protegida contra eliminación accidental desde el módulo de trabajos.

## Migración

Archivo:

`migrations/009_gallery.sql`

Agrega:

- `alt_text`
- `category`
- `client_id`
- `job_id`
- `quote_id`
- `source_job_attachment_id`
- `updated_at`
- índices y claves foráneas.

## Validación

Ejecutar:

```bash
npm run test:v2-gallery
```

## Producción

Esta fase fue desarrollada exclusivamente sobre:

`v2-development`

No se modificó `main` ni producción.
