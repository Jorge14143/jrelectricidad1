# V2 — Fase 3: Cuentas y usuarios

Estado: **100% implementada en `v2-development`**.

## Incluido

- Perfil de usuario: actualización segura del nombre.
- Email verificado con estado visible.
- Reenvío de verificación.
- Cambio de email mediante:
  - contraseña actual requerida;
  - email nuevo almacenado como pendiente;
  - token aleatorio de un solo uso;
  - hash SHA-256 del token en base de datos;
  - expiración de 30 minutos;
  - confirmación en el nuevo correo;
  - invalidación de sesiones después del cambio.
- Protección contra email duplicado.
- Avatar opcional mediante URL HTTPS.
- Historial personal basado en `audit_log`.
- `/api/me` ampliado con estado de email, avatar y 2FA.
- Alta de usuario con envío de confirmación de email sin bloquear el registro si SMTP está temporalmente caído.
- UI de cuenta actualizada.
- Migración `003_accounts.sql`.
- Test estático `npm run test:v2-accounts`.

## Endpoints principales

- `GET /api/me`
- `GET /api/account/email/status`
- `POST /api/account/email/verify/request`
- `GET /api/account/email/verify?token=...`
- `PUT /api/account/email`
- `GET /api/account/email/confirm-change?token=...`
- `PUT /api/account/profile`
- `PUT /api/account/avatar`
- `GET /api/account/activity`
- `PUT /api/account/password`

## Seguridad

Los tokens de correo nunca se almacenan en texto plano. Se guarda únicamente su hash, tienen vencimiento y son de uso único.

El correo actual permanece activo hasta que el nuevo correo sea confirmado. Al completar el cambio, todas las sesiones se invalidan para obligar a una nueva autenticación.

## Validación

Ejecutar:

```bash
npm run test:v2
npm run test:v2-security
npm run test:v2-accounts
npm run migrate
```

No se modifica `main` ni la producción durante esta fase.
