# JR Electricidad

Sitio web para **JR Electricidad | Electricista Matriculado Cat. 3**, desarrollado con Node.js, Express y MySQL.

## Requisitos

- Node.js 24+
- MySQL 8+
- npm

## Instalación local

1. Clonar el repositorio.
2. Ejecutar `npm install`.
3. Crear la base de datos `jr_electricidad`.
4. Importar `schema.sql`.
5. Copiar `.env.example` como `.env`.
6. Completar las credenciales de MySQL, sesión y correo.
7. Ejecutar `npm start`.

## Producción

- Usar `NODE_ENV=production`.
- Generar un `SESSION_SECRET` largo y aleatorio.
- No subir `.env`.
- Mantener `public/uploads` fuera del repositorio.
- Colocar HTTPS mediante un reverse proxy.
- Configurar `APP_URL` con el dominio real.
- Configurar SMTP para recuperación de contraseñas y envío de presupuestos.
- Verificar `GET /health` después del despliegue.
- Ejecutar la aplicación con PM2 o un servicio equivalente.

## Funcionalidades

- Registro, inicio de sesión y recuperación de contraseña.
- Panel administrador.
- Usuarios y roles.
- Clientes consolidados desde solicitudes y presupuestos.
- Solicitudes de presupuesto.
- Presupuestos con PDF y envío por email.
- Aceptación/rechazo mediante enlace seguro.
- Gestión y seguimiento de trabajos.
- Historial de trabajos cerrados.
- Servicios.
- Galería.
- Notificaciones administrativas.
- Configuración de cuenta.
- Dashboard con estadísticas.

## Seguridad

El proyecto incluye sesiones MySQL, bcrypt, Helmet, rate limiting, validación de uploads, tokens de acceso para presupuestos y controles de autorización para las rutas administrativas.
