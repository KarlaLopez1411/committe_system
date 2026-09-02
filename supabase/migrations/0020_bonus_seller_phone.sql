-- Migración 0020 — Teléfono opcional del responsable (vendedor)
-- =====================================================================
-- Los responsables de bonos pueden tener un teléfono de contacto opcional.
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- =====================================================================

ALTER TABLE bonus_sellers ADD COLUMN IF NOT EXISTS phone TEXT;
