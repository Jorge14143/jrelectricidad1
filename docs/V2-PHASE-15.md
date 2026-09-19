# Fase 15 — Búsqueda global

**Estado: 100% completada en `v2-development`.**

## Implementado

- Endpoint administrativo protegido: `GET /api/admin/search?q=`.
- Búsqueda global sobre:
  - Usuarios
  - Clientes
  - Solicitudes
  - Presupuestos
  - Trabajos
  - Servicios
  - Galería
  - Documentos
- Coincidencia sobre nombres, emails, teléfonos, estados, descripciones, categorías y otros campos relevantes.
- Hasta 50 resultados por búsqueda.
- Búsquedas menores a 2 caracteres no consultan la base de datos.
- Normalización básica del texto de consulta.
- UI integrada en el topbar del panel administrador.
- Resultados agrupados visualmente por módulo.
- Navegación directa a la sección correspondiente.
- Cancelación de la búsqueda anterior con `AbortController`.
- Cierre con Escape y al hacer clic fuera.
- Diseño responsive para escritorio y pantallas pequeñas.
- Se agregó Documentos al sistema de navegación del administrador.
- Checker de aceptación: `npm run test:v2-search`.

## Seguridad

La búsqueda reutiliza `requireAdmin`, por lo que no expone información administrativa a usuarios no autorizados.

## Validación

Ejecutar:

```bash
npm run test:v2-search
```

Luego probar desde el panel:

- nombre de cliente
- teléfono
- email
- número de presupuesto
- número de trabajo
- nombre de servicio
- título de galería
- título de documento

## Producción

La fase se implementó únicamente en `v2-development`. `main` permanece intacta.
