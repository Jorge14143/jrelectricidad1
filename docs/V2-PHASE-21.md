# Fase 21 — Testing

## Estado

**100% completada a nivel de implementación de la suite.**

## Cobertura

- Verificación estructural de las fases V2.
- Verificación de existencia de archivos críticos.
- Verificación de sintaxis JavaScript.
- Seguridad y autenticación.
- Cuentas y clientes.
- Solicitudes y presupuestos.
- Aceptación/rechazo de presupuestos.
- Trabajos.
- Galería.
- Dashboard.
- Notificaciones.
- Email transaccional.
- WhatsApp.
- Documentos.
- Búsqueda global.
- Configuración.
- Auditoría.
- Backups.
- Producción.
- Responsive / UX.
- Tests unitarios de:
  - política de contraseñas
  - TOTP
  - cifrado de secretos
  - validación
  - firmas de documentos
  - normalización de WhatsApp
  - enlaces WhatsApp
  - retención de backups

## Comandos

- `npm run test:v2-unit`
- `npm run test:v2-all`

## Correcciones encontradas durante Testing

- Corregida la validación de números de WhatsApp para utilizar expresiones numéricas reales.
- Alineada la validación frontend de contraseñas de registro, recuperación y administrador con la política de 12 caracteres del backend.

## Alcance

La suite incluye pruebas estáticas y unitarias automatizadas. Las pruebas que requieren una instancia real de MySQL, SMTP, WhatsApp Cloud API, navegador/dispositivo o `mysqldump` deben ejecutarse en el entorno de despliegue para validar integración real.

## Resultado

La Fase 21 queda implementada y lista para ejecución en el entorno del proyecto. El siguiente paso del roadmap es la **Fase 22 — Migración V1 → V2**.
