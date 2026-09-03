-- =====================================================================
-- 0027 — El secretario puede aprobar/anular transacciones
-- =====================================================================
-- Regla de negocio: solo Presidente, Tesorero y Secretario (además del
-- Administrador del comité, que es superconjunto) pueden aprobar/anular
-- ingresos, egresos y transferencias. En el sistema esto se gobierna con el
-- permiso `transactions.approve` (cubre aprobar y anular).
--
-- president y treasurer ya tienen `transactions.approve` (migración 0002).
-- Aquí se agrega ese permiso al rol `secretary`.
--
-- Idempotente vía ON CONFLICT sobre el PK (role_id, permission_id).
-- =====================================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key = 'transactions.approve'
WHERE r.key = 'secretary'
ON CONFLICT DO NOTHING;
