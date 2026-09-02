-- Migración 0017 — committee_admin recibe todos los permisos
-- Corrige la siembra original de 0002 donde committee_admin tenía un subconjunto
-- de permisos. Ahora tiene todos (igual que superadmin a nivel de comité).
-- Idempotente: ON CONFLICT DO NOTHING ignora los que ya existen.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.key = 'committee_admin'
ON CONFLICT DO NOTHING;
