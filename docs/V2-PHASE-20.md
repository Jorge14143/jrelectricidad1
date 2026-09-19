# Fase 20 — Responsive / UX

## Estado

**100% completada.**

## Objetivo

Adaptar V2 para escritorio, tablet y móvil sin romper el diseño oscuro ni las funciones existentes.

## Implementado

### Panel administrador
- Menú lateral móvil con apertura/cierre.
- Fondo de bloqueo para interacción fuera del sidebar.
- Cierre con Escape.
- Cierre automático al seleccionar una sección.
- Cierre automático al volver a escritorio.
- Topbar adaptable.
- Usuario reducido a avatar en pantallas pequeñas.
- Búsqueda global adaptable.
- Notificaciones convertidas en panel móvil utilizable.
- Formularios y barras de filtros apilados progresivamente.
- Botones de acciones con tamaño táctil adecuado.
- Modales adaptados a formato inferior en móvil.
- Tablas conservan todos sus datos mediante scroll horizontal.
- Dashboard, KPIs, pipeline y gráficos adaptados a pantallas pequeñas.
- Prevención de overflow horizontal.

### Sitio público
- Hero y tipografías fluidas.
- Acciones principales apiladas en móvil.
- Servicios y bloques informativos adaptados.
- Galería pasa de composición destacada a una columna en móvil.
- Formulario de presupuesto pasa a una columna.
- Mapa y zona de atención adaptables.
- Footer apilado.
- Botón flotante de WhatsApp ajustado.
- Áreas táctiles y controles reforzados.
- Soporte de `prefers-reduced-motion`.

## Archivos

- `public/admin.html`
- `public/css/admin.css`
- `public/css/style.css`
- `public/js/admin-navigation.js`
- `scripts/check-v2-responsive.js`

## Verificación

El checker valida la presencia de los puntos estructurales de la fase. No implica una prueba visual real en navegadores/dispositivos.

## Resultado

La Fase 20 queda cerrada y el proyecto puede avanzar a la **Fase 21 — Testing**.
