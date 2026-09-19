# V2 — Fase 11: Notificaciones

## Estado
100% implementada en `v2-development`.

## Funcionalidades
- Centro de notificaciones dentro del panel admin.
- Badge de no leídas en topbar y sidebar.
- Notificaciones dirigidas a un usuario o broadcast para todos los administradores.
- Prioridades: baja, normal, alta y urgente.
- Relación con entidad: solicitud, presupuesto, trabajo, galería o sistema.
- Enlace directo desde cada notificación.
- Marcar una como leída.
- Marcar todas como leídas.
- Archivar una o todas.
- Fecha/hora localizada para Argentina.
- Polling liviano para mantener actualizado el contador.
- Compatibilidad con las notificaciones V1 existentes.
- Migración versionada `010_notifications.sql`.
- Eventos integrados para solicitudes, presupuestos, trabajos y aceptación digital.

## Seguridad
Las consultas del centro de notificaciones están limitadas al administrador autenticado. Las notificaciones dirigidas a un usuario solo son visibles para ese destinatario; las notificaciones broadcast mantienen `user_id=NULL`.

## Compatibilidad
Se conserva `is_read` por compatibilidad con V1 y se agrega `read_at` para el modelo V2. Las notificaciones históricas se migran sin perder información.

## Validación
Ejecutar:

```bash
npm run test:v2-notifications
```

Y para aplicar la migración:

```bash
npm run migrate
```

La fase se desarrolla únicamente en `v2-development`; no modifica `main` ni producción.
