# V2 — Fase 7: Aceptación digital

Estado: **100%** en `v2-development`.

## Implementado
- Página pública `/presupuesto/<token>`.
- Consulta segura del presupuesto mediante token.
- Formulario de confirmación de cliente.
- Firma digital escrita mediante nombre completo.
- Consentimiento obligatorio para aceptar.
- Observación opcional.
- Evidencia persistida: decisión, fecha/hora, IP, user-agent, datos declarados y firma.
- Bloqueo de presupuestos vencidos/cerrados.
- Transacción con bloqueo de fila para evitar doble decisión concurrente.
- Aceptación: actualiza solicitud y crea/actualiza el trabajo.
- Rechazo: registra la decisión.
- Historial de presupuesto.
- Notificación administrativa.
- Email de constancia si SMTP está configurado.
- Página pública actualizada para mostrar una decisión ya registrada.

## Archivos
- `migrations/007_quote_acceptance.sql`
- `public/presupuesto.html`
- `public/js/public-quote.js`
- `scripts/check-v2-acceptance.js`
- `server.js`

## Validación
`npm run test:v2-acceptance`
