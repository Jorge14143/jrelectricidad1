# Fase 14 — Documentos

Implementa un gestor centralizado de documentos para V2.

## Incluye
- Documentos relacionados con clientes, solicitudes, presupuestos y trabajos.
- Versionado con SHA-256 y metadatos.
- Almacenamiento privado fuera del acceso estático de `public/`.
- Descarga protegida exclusivamente para administradores.
- Subida de adjuntos de hasta 10 MB con validación MIME/firma.
- Generación y almacenamiento de PDF de presupuestos.
- Generación de informe/constancia PDF de trabajos.
- Historial de versiones.
- Búsqueda y filtro por tipo.
- Auditoría de altas, versiones, descargas y eliminaciones.
- UI integrada al panel administrador.

## Tipos
`quote_pdf`, `job_report`, `work_completion`, `client_attachment`, `request_attachment`, `other`.

## Seguridad
Los archivos no se sirven directamente desde `/public`. Todas las descargas pasan por una ruta autenticada de administrador. Los nombres físicos son aleatorios y se registra SHA-256.

## Migración
Ejecutar una vez:

```bash
npm run migrate
```

Luego validar:

```bash
npm run test:v2-documents
```

## Producción
La implementación se realiza únicamente en `v2-development`; `main` y producción no se modifican.
