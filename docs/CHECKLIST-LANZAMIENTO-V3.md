# Checklist de lanzamiento — JR Electricidad V3

## Código
- [ ] Código actualizado en GitHub.
- [ ] npm install completado.
- [ ] npm test sin fallos.
- [ ] npm run prod:check sin fallos.
- [ ] No existen secretos en el repositorio.

## Base de datos
- [ ] Base correcta seleccionada.
- [ ] Schema/migraciones aplicadas.
- [ ] Backup reciente creado.
- [ ] Restauración probada en un entorno controlado.

## Producción
- [ ] .env configurado.
- [ ] SESSION_SECRET fuerte.
- [ ] PM2 activo.
- [ ] Nginx activo.
- [ ] HTTPS activo.
- [ ] GET /health devuelve 200.
- [ ] Dominio apunta al servidor correcto.

## Funciones críticas
- [ ] Página pública.
- [ ] Registro/login.
- [ ] Solicitud de presupuesto.
- [ ] Creación y envío de presupuesto.
- [ ] Aceptación/rechazo.
- [ ] Firma cuando corresponda.
- [ ] Creación del trabajo.
- [ ] Agenda/turnos.
- [ ] Evidencias.
- [ ] Lista técnica de materiales.
- [ ] Facturación del servicio.
- [ ] Registro de pago.
- [ ] Finanzas.
- [ ] WhatsApp.
- [ ] Email.
- [ ] Dashboard.
- [ ] Notificaciones.
- [ ] Seguridad/2FA.

## Lanzamiento
- [ ] Crear backup final antes de publicar.
- [ ] Desplegar versión validada.
- [ ] Ejecutar health check.
- [ ] Revisar logs.
- [ ] Realizar prueba funcional de extremo a extremo.
- [ ] Confirmar que no haya errores críticos.

## Post-lanzamiento
- [ ] Monitorizar logs.
- [ ] Revisar /health.
- [ ] Confirmar recepción de solicitudes.
- [ ] Confirmar generación de presupuestos.
- [ ] Confirmar registros financieros.
