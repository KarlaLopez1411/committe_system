-- =====================================================================
-- 0025 — Rol "member" (Miembro) como solo lectura
-- =====================================================================
-- Al unirse un usuario a un comité por código, se le asigna por defecto el
-- rol `member`. Este rol debe permitir SOLO lectura de la información básica
-- del comité (miembros, movimientos, bonos, reportes) sin ningún permiso de
-- escritura ni administrativo.
--
-- Originalmente `member` solo tenía `reports.read`. Aquí se amplía a las
-- lecturas típicas. Idempotente vía ON CONFLICT sobre el PK (role_id, permission_id).
-- =====================================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'members.read',
  'transactions.read',
  'bonuses.read',
  'reports.read'
)
WHERE r.key = 'member'
ON CONFLICT DO NOTHING;
