-- =========================================================
-- FASE 11 — NOTIFICACIONES AVANZADAS
-- =========================================================

ALTER TABLE admin_notifications
  ADD COLUMN user_id INT NULL AFTER id,
  ADD COLUMN entity_type VARCHAR(50) NULL AFTER quote_id,
  ADD COLUMN entity_id INT NULL AFTER entity_type,
  ADD COLUMN link_url VARCHAR(500) NULL AFTER message,
  ADD COLUMN priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal' AFTER link_url,
  ADD COLUMN read_at DATETIME NULL AFTER is_read,
  ADD COLUMN archived_at DATETIME NULL AFTER read_at,
  ADD KEY idx_notifications_recipient_read (user_id, is_read, archived_at, created_at),
  ADD KEY idx_notifications_entity (entity_type, entity_id),
  ADD CONSTRAINT fk_notification_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE;

ALTER TABLE admin_notifications
  MODIFY type ENUM(
    'quote_accepted',
    'quote_rejected',
    'quote_request_created',
    'quote_request_status',
    'quote_sent',
    'job_assigned',
    'job_scheduled',
    'job_started',
    'job_status_changed',
    'job_finished',
    'job_closed',
    'gallery_published',
    'security',
    'system'
  ) NOT NULL;

UPDATE admin_notifications
SET priority = CASE
  WHEN type IN ('quote_accepted','job_started','job_finished','job_closed') THEN 'high'
  WHEN type IN ('quote_rejected','quote_request_created','quote_sent','job_assigned','job_scheduled') THEN 'normal'
  ELSE 'low'
END
WHERE priority = 'normal';

UPDATE admin_notifications
SET read_at = created_at
WHERE is_read = 1 AND read_at IS NULL;
