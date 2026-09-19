# Fase 14 — Documentos

**Estado: 100% completada en `v2-development`.**

## Implementado

- Gestor centralizado de documentos relacionado con clientes, solicitudes, presupuestos y trabajos.
- Tipos: `quote_pdf`, `job_report`, `work_completion`, `client_attachment`, `request_attachment`, `other`.
- Versionado con SHA-256 y metadatos por versión.
- Almacenamiento privado en `storage/documents`, fuera de `public/`.
- Nombres físicos aleatorios y normalización segura del nombre original.
- Descarga protegida exclusivamente por `requireAdmin`.
- Subida de archivos con límite de 10 MB.
- Lista blanca de MIME types y validación de firma del archivo.
- Generación y almacenamiento de PDF de presupuestos.
- Generación y almacenamiento de informes de trabajo.
- Generación y almacenamiento de constancias de trabajo.
- Historial de versiones y descarga de versiones específicas.
- Búsqueda y filtro por tipo.
- Eliminación del documento y limpieza de sus archivos físicos.
- Auditoría de creación, nuevas versiones, descargas, generación de PDFs y eliminación.
- UI integrada en el panel administrador.
- Cliente JS para carga, búsqueda, filtros, descargas, versiones, eliminación y generación de documentos.
- Script de aceptación `npm run test:v2-documents` reforzado para verificar estructura, seguridad, rutas, auditoría y UI.

## Migración

Ejecutar una vez:

```bash
npm run migrate
```

Validar:

```bash
npm run test:v2-documents
```

## Producción

La fase se implementó únicamente en `v2-development`. `main` no fue modificado.
