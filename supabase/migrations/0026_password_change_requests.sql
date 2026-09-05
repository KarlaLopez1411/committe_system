-- =====================================================================
-- 0026_password_change_requests — solicitudes de cambio de contraseña
-- =====================================================================
-- Tabla para gestionar solicitudes de cambio de contraseña sin envío de
-- correo. Admin genera contraseña temporal, usuario entra y cambia.
-- Requirements: admin-initiated, auditable, force_password_change flag.

-- =====================================================================
-- Tabla de solicitudes de cambio de contraseña (nueva)
-- =====================================================================
CREATE TABLE IF NOT EXISTS password_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  committee_id UUID NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reason TEXT,  -- razón de la solicitud (por qué necesita cambio)
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- quién solicitó (admin/usuario)
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  temporary_password TEXT,  -- generada por admin, mostrada una sola vez (después se descarta)
  rejected_reason TEXT,  -- razón del rechazo si aplica
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Restricciones:
  -- 1. Solo una solicitud pendiente por usuario/comité
  UNIQUE(user_id, committee_id) WHERE (status = 'pending'),

  -- 2. Índices para queries comunes
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT fk_committee_id FOREIGN KEY (committee_id) REFERENCES committees(id)
);

CREATE INDEX idx_password_change_requests_committee_status
  ON password_change_requests(committee_id, status);
CREATE INDEX idx_password_change_requests_user_committee
  ON password_change_requests(user_id, committee_id);
CREATE INDEX idx_password_change_requests_requested_at
  ON password_change_requests(requested_at DESC);

-- =====================================================================
-- Agregar flag a profiles para marcar cambio obligatorio post-login
-- =====================================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS force_password_change
  BOOLEAN NOT NULL DEFAULT false;

-- Índice para queries rápidas del middleware
CREATE INDEX IF NOT EXISTS idx_profiles_force_password_change
  ON profiles(force_password_change) WHERE force_password_change = true;

-- =====================================================================
-- Permisos nuevos para el sistema de cambio de contraseña
-- =====================================================================
INSERT INTO permissions (key) VALUES
  ('password_changes.request'),   -- solicitar cambio de contraseña
  ('password_changes.approve')    -- aprobar/generar pass temporal
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- Asignación de permisos a roles (solo admin_committee y president)
-- =====================================================================

-- committee_admin: puede aprobar cambios
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key = 'password_changes.approve'
WHERE r.key = 'committee_admin'
ON CONFLICT DO NOTHING;

-- president: puede aprobar cambios
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key = 'password_changes.approve'
WHERE r.key = 'president'
ON CONFLICT DO NOTHING;

-- (Todos pueden solicitar si quieren auto-request; inicialmente solo admin lo hace)
