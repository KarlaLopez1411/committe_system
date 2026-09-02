-- Migración 0024 — Compromiso de aportación mensual del miembro
-- =====================================================================
-- Las aportaciones voluntarias se ligan a los miembros del comité. Cada miembro
-- puede comprometerse (o no) a un pago mensual, con un monto por defecto de
-- $100 por persona.
--
--   monthly_commitment: TRUE si el miembro se compromete al pago mensual.
--   monthly_amount:     monto comprometido (por defecto 100.00).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- =====================================================================

ALTER TABLE members ADD COLUMN IF NOT EXISTS monthly_commitment BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS monthly_amount NUMERIC(16,2) NOT NULL DEFAULT 100 CHECK (monthly_amount >= 0);
