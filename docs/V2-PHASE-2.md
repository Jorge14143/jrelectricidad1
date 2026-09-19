# JR Electricidad V2 — Fase 2: Seguridad avanzada

## Estado
Fase 2 completada en la rama `v2-development`.

## Controles implementados
- Protección CSRF mediante Fetch Metadata + verificación estricta de Origin/Referer.
- Cookie de sesión `__Host-jr_session` en producción.
- Rotación de sesión durante login/registro/cambio de contraseña.
- Registro y revocación de sesiones activas.
- Cierre remoto de otras sesiones.
- Auditoría de mutaciones administrativas.
- Registro de intentos de autenticación.
- Bloqueo temporal después de múltiples fallos.
- Política de contraseña V2: 12–128 caracteres.
- Reautenticación mediante contraseña actual para operaciones sensibles ya existentes.
- TOTP para administradores.
- Códigos de recuperación MFA de un solo uso.
- Secretos TOTP cifrados con AES-256-GCM usando el secreto de sesión como material de clave.
- Invalidación de sesiones tras recuperación/cambio de contraseña.
- Limpieza de sesiones activas vencidas.
- Rate limiting para autenticación y mutaciones administrativas.

## 2FA
El backend permite:
1. Consultar estado.
2. Generar secreto TOTP.
3. Configurar una aplicación autenticadora.
4. Confirmar el código y activar 2FA.
5. Generar códigos de recuperación.
6. Completar login mediante TOTP o código de recuperación.
7. Deshabilitar 2FA con contraseña + TOTP.

Para una futura puesta en producción, la política puede exigir 2FA a administradores desde la configuración de despliegue sin modificar el código.

## Compatibilidad
Las contraseñas existentes no se invalidan automáticamente. La nueva política se aplica al registrar, cambiar o recuperar una contraseña.

## Referencias de seguridad
Las decisiones de autenticación, sesiones, MFA y CSRF siguen las recomendaciones generales de OWASP.
