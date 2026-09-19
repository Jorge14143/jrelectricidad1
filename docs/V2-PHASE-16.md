# Fase 16 — Configuración

**Estado: 100% implementada en `v2-development`.**

## Implementado

- Configuración central del negocio.
- Nombre comercial y razón social/titular.
- Teléfono, WhatsApp, email, dirección, localidad y horarios.
- Logo / URL del logo.
- Integración y notificaciones automáticas de WhatsApp.
- Moneda configurable mediante código y símbolo.
- Impuesto configurable: activar/desactivar, nombre y porcentaje.
- Numeración documental configurable para presupuestos y trabajos.
- Próximo número editable para cada serie.
- Vigencia predeterminada de presupuestos.
- Notas predeterminadas de presupuestos.
- Condiciones de presupuestos.
- Condiciones comerciales.
- Generación segura de números secuenciales con bloqueo transaccional.
- Nuevo identificador `job_number` para trabajos.
- API administrativa protegida.
- API pública de datos comerciales ampliada.
- UI completa dentro de Configuración del panel.
- Auditoría al guardar la configuración.
- Migración `011_v2_configuration.sql`.
- Checker: `npm run test:v2-configuration`.

## Seguridad

- Solo administradores pueden modificar la configuración.
- Validación de email, moneda, porcentajes, rangos numéricos y longitudes.
- La numeración se incrementa dentro de la transacción que crea el documento.

## Producción

La fase se implementó únicamente en `v2-development`. `main` permanece intacta.
