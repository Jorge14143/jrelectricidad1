JR ELECTRICIDAD - NODE.JS

1) Instala Node.js 20+.
2) Copia .env.example a .env y completa MySQL y SMTP.
3) En MySQL ejecuta schema.sql.
4) En esta carpeta:
   npm install
   npm start
5) Abre http://localhost:3000

CREAR EL PRIMER ADMINISTRADOR
Después de registrar una cuenta normal, ejecuta en MySQL:
UPDATE users SET role='admin' WHERE email='TU_CORREO';

Luego entra a:
http://localhost:3000/admin

RECUPERACIÓN DE CONTRASEÑA
Configura SMTP_* en .env. Para Gmail usa una contraseña de aplicación, no la contraseña normal de la cuenta.

IMPORTANTE
Antes de publicar en Internet:
- Usa HTTPS.
- Cambia SESSION_SECRET por un secreto largo y aleatorio.
- Configura APP_URL con tu dominio HTTPS.
- Cambia el número de WhatsApp y correo en public/index.html.
- No publiques el archivo .env.
- Mantén Node y dependencias actualizados.
