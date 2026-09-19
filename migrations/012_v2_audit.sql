-- Fase 17 — Auditoría
CREATE INDEX idx_audit_created_id ON audit_log (created_at, id);
CREATE INDEX idx_audit_actor_action_created ON audit_log (actor_user_id, action, created_at);
CREATE INDEX idx_audit_entity_created ON audit_log (entity_type, entity_id, created_at);
