-- Migración 0022 — Libro de control de bonos por número (modelo JSON)
-- =====================================================================
-- Reemplaza el control disperso (bonus_monthly_dues por número/mes +
-- bonus_numbers.paid + bonus_month_payments) por UNA fila por número de campaña
-- que concentra: beneficiario, responsable (seller) y los pagos por mes como un
-- JSON { "1": true, "2": false, ... } (meses 1–12).
--
-- Esto evita cientos de filas (una por número/mes) y facilita el reporte de
-- corte por mes. Las tablas históricas (bonus_seller_assignments,
-- bonus_holder_assignments, bonus_monthly_dues) se conservan por compatibilidad,
-- pero el nuevo control vive aquí.
-- =====================================================================

CREATE TABLE IF NOT EXISTS bonus_number_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  campaign_id UUID NOT NULL REFERENCES bonus_campaigns(id),
  bonus_number_id UUID NOT NULL REFERENCES bonus_numbers(id),
  number INT NOT NULL,
  beneficiary TEXT,
  seller_id UUID REFERENCES bonus_sellers(id),
  -- Mapa de pagos por mes: { "1": true, ..., "12": false }. Falta de clave = no pagado.
  pagos JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bonus_number_id)                                    -- una fila por número
);

CREATE INDEX IF NOT EXISTS idx_bonus_number_ledger_committee ON bonus_number_ledger (committee_id);
CREATE INDEX IF NOT EXISTS idx_bonus_number_ledger_campaign ON bonus_number_ledger (campaign_id);
CREATE INDEX IF NOT EXISTS idx_bonus_number_ledger_seller ON bonus_number_ledger (seller_id);

-- ── RLS (mismo patrón multi-tenant) ─────────────────────────────────────────
ALTER TABLE bonus_number_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bonus_number_ledger_select ON bonus_number_ledger;
CREATE POLICY bonus_number_ledger_select ON bonus_number_ledger
  FOR SELECT USING (has_committee_access(committee_id));
DROP POLICY IF EXISTS bonus_number_ledger_insert ON bonus_number_ledger;
CREATE POLICY bonus_number_ledger_insert ON bonus_number_ledger
  FOR INSERT WITH CHECK (has_committee_access(committee_id));
DROP POLICY IF EXISTS bonus_number_ledger_update ON bonus_number_ledger;
CREATE POLICY bonus_number_ledger_update ON bonus_number_ledger
  FOR UPDATE USING (has_committee_access(committee_id))
             WITH CHECK (has_committee_access(committee_id));
DROP POLICY IF EXISTS bonus_number_ledger_delete ON bonus_number_ledger;
CREATE POLICY bonus_number_ledger_delete ON bonus_number_ledger
  FOR DELETE USING (has_committee_access(committee_id));

-- =====================================================================
-- BACKFILL — poblar el libro desde los datos existentes.
-- =====================================================================

-- 1) Una fila por cada número existente (con committee/campaign/number).
INSERT INTO bonus_number_ledger (committee_id, campaign_id, bonus_number_id, number, pagos)
SELECT bn.committee_id, bn.campaign_id, bn.id, bn.number, '{}'::jsonb
FROM bonus_numbers bn
ON CONFLICT (bonus_number_id) DO NOTHING;

-- 2) Beneficiario vigente (bonus_holder_assignments con valid_to IS NULL).
UPDATE bonus_number_ledger l
SET beneficiary = h.beneficiary_name,
    updated_at = now()
FROM bonus_holder_assignments h
WHERE h.bonus_number_id = l.bonus_number_id
  AND h.valid_to IS NULL;

-- 3) Responsable vigente (bonus_seller_assignments con valid_to IS NULL).
UPDATE bonus_number_ledger l
SET seller_id = a.seller_id,
    updated_at = now()
FROM bonus_seller_assignments a
WHERE a.bonus_number_id = l.bonus_number_id
  AND a.valid_to IS NULL;

-- 4) Pagos por mes desde bonus_monthly_dues con status='confirmado':
--    agrega, por número, un objeto JSON { "<mes>": true, ... }.
UPDATE bonus_number_ledger l
SET pagos = COALESCE(l.pagos, '{}'::jsonb) || d.pagos_json,
    updated_at = now()
FROM (
  SELECT bonus_number_id,
         jsonb_object_agg(EXTRACT(MONTH FROM period)::int::text, true) AS pagos_json
  FROM bonus_monthly_dues
  WHERE status = 'confirmado'
  GROUP BY bonus_number_id
) d
WHERE d.bonus_number_id = l.bonus_number_id;
