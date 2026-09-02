-- Migración 0004 — Aportaciones, donaciones y actividades
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 17.1, 17.4, 18.1, 19.1, 20.1
--
-- Crea el esquema de operación comunitaria:
--   contributions, donations, activities, activity_members
--
-- DDL alineado con design.md, secciones "Data Models > Aportaciones y donaciones"
-- y "Data Models > Actividades".
-- Depende de 0001_extensions.sql (pgcrypto -> gen_random_uuid()),
-- 0002_identity_authz.sql (committees) y 0003_members_finance.sql
-- (members, financial_accounts, financial_transactions).
--
-- Convenciones (design.md > Data Models):
--   - Toda tabla de comité lleva committee_id UUID NOT NULL REFERENCES committees(id) (R2.1).
--   - Todos los montos son NUMERIC(16,2), nunca float (R41.1).
--   - created_at TIMESTAMPTZ NOT NULL DEFAULT now().
--   - Estados en TEXT con CHECK sobre conjuntos cerrados.
--
-- IMPORTANTE — orden de creación:
--   Las tablas `activities` deben existir antes de agregar la FK sobre
--   financial_transactions.activity_id (declarada como UUID sin FK en 0003).
--   Por eso `activities` se crea primero y la FK se agrega al final.

-- =====================================================================
-- activities — actividades del comité (R19.1, R19.2, R20.1)
-- Estados: planeada, activa, finalizada, cerrada (R19.1).
-- Invariante de fechas: end_date >= start_date (R19.2).
-- =====================================================================
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  name TEXT NOT NULL,
  objective TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  responsible TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planeada'
    CHECK (status IN ('planeada','activa','finalizada','cerrada')), -- R19.1
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)                             -- R19.2
);

-- =====================================================================
-- activity_members — miembros vinculados a una actividad (R19.1)
-- Clave primaria compuesta evita duplicar el vínculo actividad<->miembro.
-- =====================================================================
CREATE TABLE activity_members (
  activity_id UUID NOT NULL REFERENCES activities(id),
  member_id UUID NOT NULL REFERENCES members(id),
  committee_id UUID NOT NULL REFERENCES committees(id),
  PRIMARY KEY (activity_id, member_id)
);

-- =====================================================================
-- contributions — aportaciones voluntarias de miembros (R17.1–17.5)
-- Estado en {registrada, sin_aportacion, exento, no_aplica} (R17.1).
-- Nunca genera adeudo automático (R17.3, lógica de servicio).
-- amount > 0 cuando está presente (R17.2).
-- financial_transaction_id UNIQUE: a lo sumo un ingreso vinculado,
-- sin doble contabilización (R17.4, R17.5).
-- =====================================================================
CREATE TABLE contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  member_id UUID NOT NULL REFERENCES members(id),
  period DATE NOT NULL,
  contributed_at DATE NOT NULL,
  amount NUMERIC(16,2) CHECK (amount IS NULL OR amount > 0),  -- R17.2
  method TEXT,
  account_id UUID REFERENCES financial_accounts(id),
  status TEXT NOT NULL
    CHECK (status IN ('registrada','sin_aportacion','exento','no_aplica')), -- R17.1
  financial_transaction_id UUID UNIQUE REFERENCES financial_transactions(id), -- 1 ingreso, sin doble vínculo (R17.4, R17.5)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- donations — donaciones monetarias y en especie (R18.1–18.7)
-- type/origin sobre conjuntos cerrados (R18.1, R18.2).
-- Campos en especie: descripción 1–500, cantidad>0 y ≤límite, destino 1–200,
-- valor estimado opcional marcado "estimado" sin tocar saldo (R18.3–18.5).
-- financial_transaction_id UNIQUE: 1 ingreso al confirmar donación monetaria (R18.6).
-- =====================================================================
CREATE TABLE donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  type TEXT NOT NULL
    CHECK (type IN ('dinero','material','bien','servicio','otro')),   -- R18.1, R18.2
  origin TEXT NOT NULL
    CHECK (origin IN ('persona','empresa','institucion','anonimo')),  -- R18.1, R18.2
  description TEXT CHECK (description IS NULL OR length(description) BETWEEN 1 AND 500), -- R18.3
  quantity NUMERIC(16,2) CHECK (quantity IS NULL OR (quantity > 0 AND quantity <= 999999999.99)), -- R18.3, R18.4
  estimated_value NUMERIC(16,2) CHECK (estimated_value IS NULL OR (estimated_value BETWEEN 0.01 AND 999999999.99)), -- R18.3
  is_estimated BOOLEAN NOT NULL DEFAULT false,               -- marca "estimado" (R18.5)
  destination TEXT CHECK (destination IS NULL OR length(destination) BETWEEN 1 AND 200), -- R18.3
  confirmed BOOLEAN NOT NULL DEFAULT false,
  financial_transaction_id UUID UNIQUE REFERENCES financial_transactions(id), -- R18.6
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- FK diferida: financial_transactions.activity_id -> activities(id) (R20.1)
-- En 0003, activity_id se declaró como UUID SIN FK porque `activities`
-- aún no existía. Ahora que la tabla existe, se agrega la restricción
-- para garantizar integridad referencial (máx. 1 actividad por movimiento).
-- =====================================================================
ALTER TABLE financial_transactions
  ADD CONSTRAINT fk_financial_transactions_activity
  FOREIGN KEY (activity_id) REFERENCES activities(id);

-- =====================================================================
-- Índices de apoyo (aislamiento por comité y accesos frecuentes)
-- =====================================================================
CREATE INDEX idx_activities_committee ON activities (committee_id);
CREATE INDEX idx_activity_members_committee ON activity_members (committee_id);
CREATE INDEX idx_activity_members_member ON activity_members (member_id);
CREATE INDEX idx_contributions_committee ON contributions (committee_id);
CREATE INDEX idx_contributions_member ON contributions (member_id);
CREATE INDEX idx_contributions_period ON contributions (committee_id, period);
CREATE INDEX idx_donations_committee ON donations (committee_id);
