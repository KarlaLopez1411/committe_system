-- Migración 0005 — Módulo de bonos
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 24.5, 25.2, 29.2, 31.5, 32.2, 33.4, 41.4
--
-- Crea el esquema del sistema anual de bonos:
--   bonus_campaigns, bonus_numbers, bonus_holder_assignments,
--   bonus_sellers, bonus_seller_assignments, bonus_monthly_dues,
--   bonus_due_transitions, bonus_collections, bonus_settlements,
--   bonus_settlement_items, bonus_draws, bonus_prize_payments
--
-- DDL alineado con design.md, sección "Data Models > Bonos" y con el modelo
-- preliminar de SAC_requerimientos_diseno_tecnico.md §14.6.
-- Depende de 0001_extensions.sql (pgcrypto -> gen_random_uuid()),
-- 0002_identity_authz.sql (committees, auth.users),
-- 0003_members_finance.sql (members, financial_transactions).
--
-- Convenciones (design.md > Data Models):
--   - Toda tabla de comité lleva committee_id UUID NOT NULL REFERENCES committees(id) (R2.1).
--   - Todos los montos son NUMERIC(16,2), nunca float (R41.1).
--   - created_at TIMESTAMPTZ NOT NULL DEFAULT now().
--   - Estados en TEXT con CHECK sobre conjuntos cerrados.
--
-- IMPORTANTE — orden de creación (respeto de FK):
--   El diseño describe `bonus_collections.settlement_id -> bonus_settlements(id)`,
--   pero conceptualmente `bonus_collections` aparece antes que `bonus_settlements`.
--   Para mantener la migración autocontenida y aplicable en orden, aquí se crea
--   `bonus_settlements` ANTES que `bonus_collections`, de modo que la FK
--   settlement_id pueda declararse en línea sin necesidad de un ALTER diferido.
--   Ninguna de las dos tablas depende de columnas de la otra en el otro sentido.

-- =====================================================================
-- bonus_campaigns — campaña anual de bonos (R24.1–24.5)
-- Una campaña por comité/año (R24.5). number_end >= number_start (R24.2).
-- =====================================================================
CREATE TABLE bonus_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  name TEXT NOT NULL,
  year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),      -- R24.1
  number_start INT NOT NULL CHECK (number_start >= 1),
  number_end INT NOT NULL CHECK (number_end <= 999999999),
  monthly_amount NUMERIC(16,2) NOT NULL CHECK (monthly_amount > 0),  -- R24.3
  monthly_prize NUMERIC(16,2) NOT NULL CHECK (monthly_prize > 0),    -- R24.3
  active_months INT NOT NULL CHECK (active_months BETWEEN 1 AND 12), -- R24.4
  start_date DATE,
  end_date DATE,
  rules JSONB,                                               -- 6 parámetros (R34.1, R34.2)
  rules_defined BOOLEAN NOT NULL DEFAULT false,              -- R34.2, R34.3
  status TEXT NOT NULL DEFAULT 'borrador'
    CHECK (status IN ('borrador','activa','cerrada')),       -- R24.1
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (number_end >= number_start),                        -- R24.2
  UNIQUE (committee_id, year)                                -- una campaña por año (R24.5)
);

-- =====================================================================
-- bonus_numbers — números de la campaña (R25.1, R25.2)
-- Número único por campaña (R25.2).
-- =====================================================================
CREATE TABLE bonus_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  campaign_id UUID NOT NULL REFERENCES bonus_campaigns(id),
  number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo','inactivo')),
  UNIQUE (campaign_id, number)                               -- número único por campaña (R25.2)
);

-- =====================================================================
-- bonus_holder_assignments — historial de beneficiarios/titulares (R26.1, R26.2)
-- valid_to NULL = asignación vigente. Cambiar titular no borra el histórico.
-- A lo sumo una asignación vigente (valid_to IS NULL) por bonus_number_id.
-- =====================================================================
CREATE TABLE bonus_holder_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  bonus_number_id UUID NOT NULL REFERENCES bonus_numbers(id),
  beneficiary_name TEXT NOT NULL,
  member_id UUID REFERENCES members(id),
  valid_from DATE NOT NULL,
  valid_to DATE,                                             -- NULL = vigente (R26.1, R26.2)
  created_by UUID
);
-- Índice único parcial: máx. 1 titular vigente por número
CREATE UNIQUE INDEX uq_active_holder_per_number
  ON bonus_holder_assignments (bonus_number_id) WHERE valid_to IS NULL;

-- =====================================================================
-- bonus_sellers — vendedores de bonos del comité (R27.1)
-- Vinculación opcional a auth.users y/o members.
-- =====================================================================
CREATE TABLE bonus_sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  user_id UUID REFERENCES auth.users(id),
  member_id UUID REFERENCES members(id),
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- bonus_seller_assignments — asignación de números a vendedores (R27.4, R27.5)
-- valid_to NULL = vigente. Máx. 1 vendedor vigente por número (R27.5).
-- =====================================================================
CREATE TABLE bonus_seller_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  bonus_number_id UUID NOT NULL REFERENCES bonus_numbers(id),
  seller_id UUID NOT NULL REFERENCES bonus_sellers(id),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ                                       -- NULL = vigente (R27.4, R27.5)
);
-- Índice único parcial: máx. 1 vendedor vigente por número
CREATE UNIQUE INDEX uq_active_seller_per_number
  ON bonus_seller_assignments (bonus_number_id) WHERE valid_to IS NULL; -- R27.5

-- =====================================================================
-- bonus_monthly_dues — mensualidad por número/periodo (R29.1–29.3)
-- Una mensualidad por número/periodo (R29.2). Máquina de estados en status (R29.3).
-- =====================================================================
CREATE TABLE bonus_monthly_dues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  campaign_id UUID NOT NULL REFERENCES bonus_campaigns(id),
  bonus_number_id UUID NOT NULL REFERENCES bonus_numbers(id),
  period DATE NOT NULL,
  amount NUMERIC(16,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN
    ('pendiente','cobrado_vendedor','entregado_tesoreria','confirmado')), -- R29.3
  UNIQUE (bonus_number_id, period)                           -- una mensualidad por número/periodo (R29.2)
);

-- =====================================================================
-- bonus_due_transitions — bitácora de transiciones de mensualidad (R29.4)
-- Cada cambio de estado registra origen, destino, actor y referencia.
-- =====================================================================
CREATE TABLE bonus_due_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  monthly_due_id UUID NOT NULL REFERENCES bonus_monthly_dues(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor UUID NOT NULL,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- bonus_settlements — entrega de vendedor a tesorería (R31.1–31.5)
-- Se crea ANTES de bonus_collections para que la FK settlement_id sea directa.
-- El vendedor reporta (reported_by) y tesorería confirma (confirmed_by),
-- que debe ser distinto del vendedor (R31.4).
-- financial_transaction_id UNIQUE garantiza idempotencia: una entrega genera
-- a lo sumo un ingreso (R31.5, R41.4).
-- =====================================================================
CREATE TABLE bonus_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  campaign_id UUID NOT NULL REFERENCES bonus_campaigns(id),
  seller_id UUID NOT NULL REFERENCES bonus_sellers(id),
  reported_by UUID NOT NULL,                                 -- vendedor que reporta (R31.4)
  reference TEXT,
  reported_amount NUMERIC(16,2) NOT NULL
    CHECK (reported_amount BETWEEN 0.01 AND 999999999.99),   -- R31.1, R31.2
  confirmed_amount NUMERIC(16,2),
  status TEXT NOT NULL DEFAULT 'reportada'
    CHECK (status IN ('reportada','confirmada','anulada')),  -- R31.3, R31.5
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID,                                         -- distinto de reported_by (R31.4)
  financial_transaction_id UUID UNIQUE REFERENCES financial_transactions(id), -- idempotencia (R31.5, R41.4)
  CHECK (confirmed_by IS NULL OR confirmed_by <> reported_by) -- vendedor no confirma su entrega (R31.4)
);

-- =====================================================================
-- bonus_collections — cobro realizado por el vendedor (R30.1–30.3)
-- Se vincula a una mensualidad y, opcionalmente, a la entrega que lo agrupa.
-- =====================================================================
CREATE TABLE bonus_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  monthly_due_id UUID NOT NULL REFERENCES bonus_monthly_dues(id),
  seller_id UUID NOT NULL REFERENCES bonus_sellers(id),
  amount NUMERIC(16,2) NOT NULL CHECK (amount > 0),          -- R30.3
  settlement_id UUID REFERENCES bonus_settlements(id),       -- agrupación en entrega
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

-- =====================================================================
-- bonus_settlement_items — cobros incluidos en una entrega (R31.1)
-- PK compuesta evita duplicar el vínculo entrega<->cobro.
-- =====================================================================
CREATE TABLE bonus_settlement_items (
  settlement_id UUID NOT NULL REFERENCES bonus_settlements(id),
  collection_id UUID NOT NULL REFERENCES bonus_collections(id),
  committee_id UUID NOT NULL REFERENCES committees(id),
  PRIMARY KEY (settlement_id, collection_id)
);

-- =====================================================================
-- bonus_draws — sorteo mensual (R32.1, R32.2)
-- Un sorteo por campaña/periodo (R32.2). Se guarda snapshot del beneficiario.
-- =====================================================================
CREATE TABLE bonus_draws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  campaign_id UUID NOT NULL REFERENCES bonus_campaigns(id),
  period DATE NOT NULL,
  draw_date DATE NOT NULL,
  winning_bonus_number_id UUID NOT NULL REFERENCES bonus_numbers(id),
  beneficiary_snapshot TEXT NOT NULL,                        -- beneficiario vigente (R32.1)
  prize_amount NUMERIC(16,2) NOT NULL CHECK (prize_amount > 0),
  evidence_path TEXT,
  responsible TEXT,
  status TEXT NOT NULL DEFAULT 'registrado'
    CHECK (status IN ('registrado','anulado')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, period)                               -- un sorteo por campaña/periodo (R32.2)
);

-- =====================================================================
-- bonus_prize_payments — pago del premio del sorteo (R33.1, R33.4, R41.4)
-- draw_id UNIQUE: un pago por sorteo (R33.4).
-- financial_transaction_id UNIQUE: idempotencia, un solo egreso (R33.4, R41.4).
-- =====================================================================
CREATE TABLE bonus_prize_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  draw_id UUID NOT NULL UNIQUE REFERENCES bonus_draws(id),   -- un pago por sorteo (R33.4)
  amount NUMERIC(16,2) NOT NULL CHECK (amount > 0),          -- R33.1
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  financial_transaction_id UUID NOT NULL UNIQUE REFERENCES financial_transactions(id), -- idempotencia (R33.4, R41.4)
  created_by UUID
);

-- =====================================================================
-- Índices de apoyo (aislamiento por comité y accesos frecuentes)
-- =====================================================================
CREATE INDEX idx_bonus_campaigns_committee ON bonus_campaigns (committee_id);
CREATE INDEX idx_bonus_numbers_committee ON bonus_numbers (committee_id);
CREATE INDEX idx_bonus_numbers_campaign ON bonus_numbers (campaign_id);
CREATE INDEX idx_bonus_holder_assignments_committee ON bonus_holder_assignments (committee_id);
CREATE INDEX idx_bonus_holder_assignments_number ON bonus_holder_assignments (bonus_number_id);
CREATE INDEX idx_bonus_sellers_committee ON bonus_sellers (committee_id);
CREATE INDEX idx_bonus_seller_assignments_committee ON bonus_seller_assignments (committee_id);
CREATE INDEX idx_bonus_seller_assignments_number ON bonus_seller_assignments (bonus_number_id);
CREATE INDEX idx_bonus_seller_assignments_seller ON bonus_seller_assignments (seller_id);
CREATE INDEX idx_bonus_monthly_dues_committee ON bonus_monthly_dues (committee_id);
CREATE INDEX idx_bonus_monthly_dues_campaign ON bonus_monthly_dues (campaign_id);
CREATE INDEX idx_bonus_monthly_dues_number ON bonus_monthly_dues (bonus_number_id);
CREATE INDEX idx_bonus_due_transitions_due ON bonus_due_transitions (monthly_due_id);
CREATE INDEX idx_bonus_collections_committee ON bonus_collections (committee_id);
CREATE INDEX idx_bonus_collections_due ON bonus_collections (monthly_due_id);
CREATE INDEX idx_bonus_collections_seller ON bonus_collections (seller_id);
CREATE INDEX idx_bonus_collections_settlement ON bonus_collections (settlement_id);
CREATE INDEX idx_bonus_settlements_committee ON bonus_settlements (committee_id);
CREATE INDEX idx_bonus_settlements_campaign ON bonus_settlements (campaign_id);
CREATE INDEX idx_bonus_settlements_seller ON bonus_settlements (seller_id);
CREATE INDEX idx_bonus_settlement_items_committee ON bonus_settlement_items (committee_id);
CREATE INDEX idx_bonus_settlement_items_collection ON bonus_settlement_items (collection_id);
CREATE INDEX idx_bonus_draws_committee ON bonus_draws (committee_id);
CREATE INDEX idx_bonus_draws_campaign ON bonus_draws (campaign_id);
CREATE INDEX idx_bonus_prize_payments_committee ON bonus_prize_payments (committee_id);
