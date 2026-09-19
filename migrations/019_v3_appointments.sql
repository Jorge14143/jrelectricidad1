-- V3 BLOCK D — AGENDA Y TURNOS
-- Fases 22-27: lifecycle, cliente, administración y recordatorios

ALTER TABLE v3_appointments
  ADD COLUMN IF NOT EXISTS user_id INT NULL AFTER id,
  ADD COLUMN IF NOT EXISTS client_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(500) NULL AFTER cancelled_at,
  ADD COLUMN IF NOT EXISTS confirmed_at DATETIME NULL AFTER status,
  ADD COLUMN IF NOT EXISTS cancelled_at DATETIME NULL AFTER confirmed_at,
  ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL AFTER confirmed_at,
  ADD COLUMN IF NOT EXISTS reminder_sent_at DATETIME NULL AFTER completed_at,
  ADD COLUMN IF NOT EXISTS admin_notes VARCHAR(1000) NULL AFTER notes,
  ADD COLUMN IF NOT EXISTS rescheduled_from_id BIGINT UNSIGNED NULL AFTER admin_notes;

CREATE INDEX IF NOT EXISTS idx_v3_appointments_user_date ON v3_appointments (user_id,appointment_date,start_time);
CREATE INDEX IF NOT EXISTS idx_v3_appointments_client_date ON v3_appointments (client_id,appointment_date,start_time);
CREATE INDEX IF NOT EXISTS idx_v3_appointments_reminders ON v3_appointments (status,reminder_sent_at,appointment_date,start_time);
CREATE INDEX IF NOT EXISTS idx_v3_appointments_rescheduled ON v3_appointments (rescheduled_from_id);

-- Enlaza turnos existentes con cuentas/clientes cuando sea posible.
UPDATE v3_appointments a
LEFT JOIN users u ON LOWER(u.email)=LOWER(a.email)
SET a.user_id=COALESCE(a.user_id,u.id)
WHERE a.user_id IS NULL AND a.email IS NOT NULL AND a.email<>'';

UPDATE v3_appointments a
LEFT JOIN clients c ON LOWER(c.email)=LOWER(a.email)
SET a.client_id=COALESCE(a.client_id,c.id)
WHERE a.client_id IS NULL AND a.email IS NOT NULL AND a.email<>'';
