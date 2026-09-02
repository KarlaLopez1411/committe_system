-- Migración 0023 — Entregas del premio de bono por mes
-- =====================================================================
-- Registra la ENTREGA del premio mensual de una campaña de bonos: el número
-- ganador, la fecha de entrega y el responsable de entregarlo. Se lleva el
-- histórico por campaña (una entrega por campaña/mes).
--
-- UNIQUE(campaign_id, month) garantiza una sola entrega por mes/campaña.
-- =====================================================================

CREATE TABLE IF NOT EXISTS bonus_prize_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  campaign_id UUID NOT NULL REFERENCES bonus_campaigns(id),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  winning_number INT NOT NULL,                               -- número ganador
  delivery_date DATE NOT NULL,                               -- fecha de entrega
  responsible TEXT,                                          -- quién entrega
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, month)                                -- una entrega por campaña/mes
);

CREATE INDEX IF NOT EXISTS idx_bonus_prize_deliveries_committee ON bonus_prize_deliveries (committee_id);
CREATE INDEX IF NOT EXISTS idx_bonus_prize_deliveries_campaign ON bonus_prize_deliveries (campaign_id);

-- RLS multi-tenant.
ALTER TABLE bonus_prize_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bonus_prize_deliveries_select ON bonus_prize_deliveries;
CREATE POLICY bonus_prize_deliveries_select ON bonus_prize_deliveries
  FOR SELECT USING (has_committee_access(committee_id));
DROP POLICY IF EXISTS bonus_prize_deliveries_insert ON bonus_prize_deliveries;
CREATE POLICY bonus_prize_deliveries_insert ON bonus_prize_deliveries
  FOR INSERT WITH CHECK (has_committee_access(committee_id));
DROP POLICY IF EXISTS bonus_prize_deliveries_update ON bonus_prize_deliveries;
CREATE POLICY bonus_prize_deliveries_update ON bonus_prize_deliveries
  FOR UPDATE USING (has_committee_access(committee_id))
             WITH CHECK (has_committee_access(committee_id));
DROP POLICY IF EXISTS bonus_prize_deliveries_delete ON bonus_prize_deliveries;
CREATE POLICY bonus_prize_deliveries_delete ON bonus_prize_deliveries
  FOR DELETE USING (has_committee_access(committee_id));
