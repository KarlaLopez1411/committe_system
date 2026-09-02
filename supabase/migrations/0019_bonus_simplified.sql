-- Migración 0019 — Simplificación de campañas de bonos
-- =====================================================================
-- Los bonos se manejan por AÑO y son SIEMPRE 100 números (1–100). El alta de
-- campaña solo requiere: año, aportación mensual y premio mensual.
--
-- 1) Se agregan valores por defecto a las columnas que antes eran obligatorias
--    en el alta (name, number_start, number_end, active_months) para que el
--    servidor pueda insertar una campaña indicando solo año + montos.
-- 2) Se agrega `paid` (boolean) a bonus_numbers como bandera simple de "pagado"
--    por número (número, beneficiario, responsable, pagado) que pide la tabla
--    de la campaña.
--
-- Idempotente: usa IF NOT EXISTS / DROP ... IF EXISTS donde aplica.
-- =====================================================================

-- (1) Defaults para simplificar el alta.
ALTER TABLE bonus_campaigns ALTER COLUMN name         SET DEFAULT '';
ALTER TABLE bonus_campaigns ALTER COLUMN number_start SET DEFAULT 1;
ALTER TABLE bonus_campaigns ALTER COLUMN number_end   SET DEFAULT 100;
ALTER TABLE bonus_campaigns ALTER COLUMN active_months SET DEFAULT 12;

-- (2) Bandera de pago por número.
ALTER TABLE bonus_numbers ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false;
