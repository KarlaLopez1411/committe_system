-- Migración 0021 — Pagos mensuales de bonos por responsable
-- =====================================================================
-- Registra el pago mensual que hace un responsable (vendedor) por los números
-- que tiene asignados en una campaña. Cada pago:
--   • cubre un mes (period = primer día del mes),
--   • marca como pagados (bonus_monthly_dues.status='confirmado') los números
--     del responsable para ese periodo,
--   • genera UN ingreso a la caja principal (financial_transaction_id).
--
-- UNIQUE(seller_id, campaign_id, period) garantiza idempotencia: un responsable
-- no puede pagar dos veces el mismo mes de la misma campaña.
-- =====================================================================

CREATE TABLE IF NOT EXISTS bonus_month_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  campaign_id UUID NOT NULL REFERENCES bonus_campaigns(id),
  seller_id UUID NOT NULL REFERENCES bonus_sellers(id),
  period DATE NOT NULL,                                      -- primer día del mes pagado
  numbers_count INT NOT NULL CHECK (numbers_count >= 0),
  amount NUMERIC(16,2) NOT NULL CHECK (amount >= 0),
  financial_transaction_id UUID REFERENCES financial_transactions(id),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, campaign_id, period)                   -- un pago por responsable/campaña/mes
);

CREATE INDEX IF NOT EXISTS idx_bonus_month_payments_committee ON bonus_month_payments (committee_id);
CREATE INDEX IF NOT EXISTS idx_bonus_month_payments_campaign ON bonus_month_payments (campaign_id);

-- RLS: mismo patrón multi-tenant que el resto de tablas de bono.
ALTER TABLE bonus_month_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bonus_month_payments_select ON bonus_month_payments;
CREATE POLICY bonus_month_payments_select ON bonus_month_payments
  FOR SELECT USING (has_committee_access(committee_id));
DROP POLICY IF EXISTS bonus_month_payments_insert ON bonus_month_payments;
CREATE POLICY bonus_month_payments_insert ON bonus_month_payments
  FOR INSERT WITH CHECK (has_committee_access(committee_id));
DROP POLICY IF EXISTS bonus_month_payments_update ON bonus_month_payments;
CREATE POLICY bonus_month_payments_update ON bonus_month_payments
  FOR UPDATE USING (has_committee_access(committee_id))
             WITH CHECK (has_committee_access(committee_id));
DROP POLICY IF EXISTS bonus_month_payments_delete ON bonus_month_payments;
CREATE POLICY bonus_month_payments_delete ON bonus_month_payments
  FOR DELETE USING (has_committee_access(committee_id));
