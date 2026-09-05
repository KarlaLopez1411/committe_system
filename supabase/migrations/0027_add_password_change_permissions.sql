-- =====================================================================
-- 0027_add_password_change_permissions — Agregar permisos de cambio de contraseña
-- =====================================================================

-- Eliminar constraint anterior
ALTER TABLE permissions DROP CONSTRAINT permissions_key_check;

-- Agregar nuevo constraint con password_changes.* incluidos
ALTER TABLE permissions ADD CONSTRAINT permissions_key_check CHECK (key IN
  ('members.read','members.create','members.update',
   'transactions.read','transactions.create','transactions.approve','transactions.void',
   'cash_closings.create','cash_closings.review','cash_closings.close',
   'bonuses.read','bonuses.collect','bonuses.settle','bonuses.draw',
   'reports.read','users.manage','committee.manage','audit.read',
   'password_changes.request','password_changes.approve'));

-- Insertar permisos
INSERT INTO permissions (key) VALUES
  ('password_changes.request'),
  ('password_changes.approve')
ON CONFLICT (key) DO NOTHING;

-- Asignar permisos a roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key = 'password_changes.approve'
WHERE r.key = 'committee_admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key = 'password_changes.approve'
WHERE r.key = 'president'
ON CONFLICT DO NOTHING;
