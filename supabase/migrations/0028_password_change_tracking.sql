-- =====================================================================
-- 0028_password_change_tracking — Agregar tracking de cambios y uso
-- =====================================================================

-- Agregar columnas para tracking
ALTER TABLE password_change_requests
ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS temporary_password_used_at TIMESTAMPTZ;

-- Índice para queries de "cambios completados"
CREATE INDEX IF NOT EXISTS idx_password_change_requests_password_changed_at
  ON password_change_requests(committee_id, password_changed_at DESC)
  WHERE password_changed_at IS NOT NULL;
