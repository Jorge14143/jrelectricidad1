# V2 — Fase 10: Dashboard

## Estado

**100% implementada en `v2-development`.**

## Dashboard operativo

El panel ahora centraliza:

- Clientes registrados.
- Clientes nuevos del período.
- Servicios totales y activos.
- Solicitudes pendientes.
- Presupuestos enviados, aceptados, rechazados y vencidos.
- Importe total de presupuestos aceptados.
- Trabajos en proceso.
- Trabajos terminados.
- Actividad del período seleccionado.
- Publicaciones de galería.
- Trabajos destacados de galería.
- Conversión del pipeline de solicitudes.
- Pipeline de solicitudes por etapa.
- Próximos trabajos programados.
- Servicios más solicitados.
- Distribución de trabajos por estado.
- Actividad reciente.
- Evolución mensual de presupuestos.

## Períodos

El administrador puede seleccionar:

- 7 días.
- 30 días.
- 90 días.
- 365 días.

Las consultas del período se calculan en servidor.

## Seguridad

El endpoint de estadísticas mantiene protección de administrador mediante `requireAdmin`.

No se exponen credenciales ni información sensible.

## UX

- Diseño integrado con el panel oscuro de JR Electricidad.
- Componentes adaptables a escritorio, tablet y móvil.
- Barras de progreso para el pipeline.
- Agenda de trabajos.
- Estados de trabajos legibles.
- Métricas monetarias en formato ARS.

## Validación

Ejecutar:

```bash
npm run test:v2-dashboard
```

## Producción

Esta fase fue desarrollada exclusivamente en:

`v2-development`

No se modificó `main` ni producción.
