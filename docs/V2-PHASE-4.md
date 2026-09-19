# V2 — Fase 4: Clientes

Estado: **100% implementada en `v2-development`**.

## Incluido

- Tabla normalizada `clients`.
- Migración de clientes existentes desde `quote_requests`.
- Relación `quote_requests.client_id`.
- CRUD administrativo de clientes.
- Búsqueda por nombre, teléfono, WhatsApp, email, dirección y localidad.
- Filtro por localidad.
- Datos:
  - nombre
  - teléfono
  - WhatsApp
  - email
  - dirección
  - localidad
  - notas internas
- Historial consolidado por cliente:
  - solicitudes
  - presupuestos
  - trabajos
  - trabajos cerrados
  - total presupuestado
- Vinculación automática de nuevas solicitudes públicas con el cliente por teléfono.
- Compatibilidad con la ficha de cliente existente.
- Auditoría de creación, modificación y eliminación.
- Interfaz administrativa completa para alta, edición, eliminación e historial.
- Validación de campos y límites.
- Test `npm run test:v2-clients`.

## Migración

La migración `004_clients.sql` crea la estructura y enlaza los registros históricos existentes sin eliminar solicitudes, presupuestos ni trabajos.

## Validación

```bash
npm run test:v2
npm run test:v2-security
npm run test:v2-accounts
npm run test:v2-clients
npm run migrate
```

No se modifica `main` ni producción durante esta fase.
