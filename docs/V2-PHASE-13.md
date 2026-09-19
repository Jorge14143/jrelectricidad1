# V2 — Fase 13: WhatsApp

## Estado
100% implementada en `v2-development`.

## Arquitectura
- Servicio central en `lib/whatsapp.js`.
- Cola persistente MySQL en `whatsapp_outbox`.
- Normalización de números y generación de enlaces `wa.me`.
- Integración opcional con WhatsApp Cloud API mediante variables de entorno.
- Procesamiento automático cada 30 segundos.
- Reintentos progresivos: 1, 5, 15, 60 y 240 minutos.
- Recuperación de trabajos que quedaron en `sending` tras un reinicio.

## Configuración
No se guardan tokens en MySQL. La integración usa:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_API_VERSION` opcional

La Cloud API es opcional. Sin ella, los mensajes quedan `skipped` y se puede utilizar el enlace `wa.me`.

## Integración del sistema
La fase contempla:
- enlaces de contacto WhatsApp.
- cola de mensajes.
- solicitudes.
- cambios de estado de solicitudes.
- presupuestos.
- trabajos y programación.
- trazabilidad del estado de entrega.

## Seguridad
- Token exclusivamente en `.env`.
- Validación y normalización de números.
- Límite de longitud de mensajes.
- Auditoría mediante request ID y registro del outbox.
- No se expone el token en respuestas API.

## Validación
`npm run test:v2-whatsapp`

Aplicar la migración con:
`npm run migrate`

La fase se desarrolla únicamente en `v2-development`.
