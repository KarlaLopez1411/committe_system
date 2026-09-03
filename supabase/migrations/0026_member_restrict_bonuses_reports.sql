-- =====================================================================
-- 0026 — El rol member no puede consultar bonos ni reportes
-- =====================================================================

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.key = 'member'
  AND p.key IN ('bonuses.read', 'reports.read');
