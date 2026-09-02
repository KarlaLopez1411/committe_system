-- Migración 0003 — Miembros y finanzas
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 7.1, 9.1, 9.2, 10.1, 11.1, 13.3, 14.1, 22.1, 41.1
--
-- Crea el esquema de miembros y el núcleo financiero (ledger):
--   members,
--   financial_accounts, transaction_categories, financial_transactions,
--   ledger_entries, transaction_attachments, transfers,
--   cash_closings, cash_closing_details
--
-- DDL alineado con design.md, secciones "Data Models > Miembros" y
-- "Data Models > Finanzas".
-- Depende de 0001_extensions.sql (pgcrypto -> gen_random_uuid())
-- y de 0002_identity_authz.sql (committees).
--
-- Convenciones (design.md > Data Models):
--   - Toda tabla de comité lleva committee_id UUID NOT NULL REFERENCES committees(id) (R2.1).
--   - Todos los montos son NUMERIC(16,2), nunca float (R41.1).
--   - created_at TIMESTAMPTZ NOT NULL DEFAULT now().
--   - Estados en TEXT con CHECK sobre conjuntos cerrados.
--
-- NOTA sobre financial_transactions.activity_id:
--   El diseño referencia activities(id), pero la tabla `activities` se crea en
--   una migración posterior (0004). Para mantener las migraciones autocontenidas
--   y aplicables en orden, aquí se declara activity_id como UUID SIN la restricción
--   FOREIGN KEY. La FK a activities(id) se agregará en 0004, una vez exista la tabla.

-- =====================================================================
-- members — registro de miembros del comité (R7.1–7.5, R8.1)
-- =====================================================================
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  full_name TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 150),   -- R7.1, R7.3
  phone TEXT CHECK (phone IS NULL OR length(phone) <= 30),               -- R7.5
  joined_at DATE,
  position TEXT,
  status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo','inactivo','baja')), -- R7.2, R7.4
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),              -- R7.5
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

-- =====================================================================
-- financial_accounts — cuentas/cajas del comité (R9.1–9.4, R10.1)
-- El saldo NO es un campo editable: es derivado del ledger (R10.1, R10.2).
-- =====================================================================
CREATE TABLE financial_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),   -- R9.1, R9.2
  type TEXT NOT NULL CHECK (type IN
    ('caja_general','cuenta_bancaria','caja_actividad','cuenta_digital','otra')),
  opening_balance NUMERIC(16,2) NOT NULL DEFAULT 0,           -- saldo inicial (R10.1)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')), -- R9.3, R9.4
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (committee_id, name)                                 -- nombre único por comité (R9.2)
);

-- =====================================================================
-- transaction_categories — categorías configurables por comité (R13.3, R13.5)
-- =====================================================================
CREATE TABLE transaction_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),  -- R13.5
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (committee_id, name)                                 -- nombre único por comité (R13.3)
);

-- =====================================================================
-- financial_transactions — cabecera de todo movimiento financiero (R12, R15, R14.1)
-- activity_id: UUID sin FK aquí; la FK a activities(id) se agrega en 0004.
-- =====================================================================
CREATE TABLE financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer','adjustment')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')), -- R15.1
  transaction_date DATE NOT NULL,
  description TEXT,
  category_id UUID REFERENCES transaction_categories(id),
  activity_id UUID,                                          -- FK a activities(id) se agrega en 0004 (R20.1)
  source_type TEXT,                                          -- 'contribution'|'donation'|'settlement'|'prize'|null
  source_id UUID,
  created_by UUID NOT NULL,                                  -- atribución (R12.6, R36.3)
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),             -- fecha/hora captura (R12.6)
  posted_at TIMESTAMPTZ,
  reversal_of UUID REFERENCES financial_transactions(id)     -- anulación compensatoria (R15.3)
);

-- =====================================================================
-- ledger_entries — apuntes inmutables; fuente de verdad del saldo (R10.1, R11.2, R41.1)
-- amount positivo = crédito, negativo = débito.
-- Invariante de transferencia: SUM(amount)=0 por transaction_id cuando type='transfer' (R11.2).
-- Derived_Balance(cuenta) = opening_balance + SUM(ledger_entries.amount) (R10.1).
-- =====================================================================
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  transaction_id UUID NOT NULL REFERENCES financial_transactions(id),
  account_id UUID NOT NULL REFERENCES financial_accounts(id),
  amount NUMERIC(16,2) NOT NULL,                              -- positivo=crédito, negativo=débito
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- transaction_attachments — comprobantes en bucket privado (R16.1)
-- =====================================================================
CREATE TABLE transaction_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  transaction_id UUID NOT NULL REFERENCES financial_transactions(id),
  storage_path TEXT NOT NULL,                                 -- bucket privado (R16.1)
  kind TEXT CHECK (kind IN ('imagen','ticket','factura','recibo','pdf','otro')),
  uploaded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- transfers — transferencias internas entre cuentas del comité (R11.1, R11.5, R11.6)
-- Una transferencia -> exactamente una financial_transaction (UNIQUE).
-- =====================================================================
CREATE TABLE transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  transaction_id UUID NOT NULL UNIQUE REFERENCES financial_transactions(id),
  from_account_id UUID NOT NULL REFERENCES financial_accounts(id),
  to_account_id UUID NOT NULL REFERENCES financial_accounts(id),
  amount NUMERIC(16,2) NOT NULL CHECK (amount >= 0.01),       -- R11.1, R11.6
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_account_id <> to_account_id)                    -- cuentas distintas (R11.5)
);

-- =====================================================================
-- cash_closings — cortes mensuales de caja (R22.1, R22.2, R22.4, R22.5, R23.1, R23.3)
-- Un corte por cuenta/periodo (no cerrar dos veces un corte, R23.3).
-- =====================================================================
CREATE TABLE cash_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  account_id UUID NOT NULL REFERENCES financial_accounts(id),
  period DATE NOT NULL,                                       -- primer día del periodo
  opening_balance NUMERIC(16,2) NOT NULL,
  theoretical_balance NUMERIC(16,2) NOT NULL,                 -- R22.1, R22.2
  real_balance NUMERIC(16,2) CHECK (real_balance IS NULL OR (real_balance BETWEEN 0 AND 999999999.99)), -- R22.5
  difference NUMERIC(16,2),                                   -- real - teórico (R22.4)
  status TEXT NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','en_revision','aprobado','cerrado')), -- R23.1
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (committee_id, account_id, period)                  -- un corte por cuenta/periodo (R23.3)
);

-- =====================================================================
-- cash_closing_details — desglose de conceptos de un corte (R22.1)
-- =====================================================================
CREATE TABLE cash_closing_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id UUID NOT NULL REFERENCES committees(id),
  cash_closing_id UUID NOT NULL REFERENCES cash_closings(id),
  concept TEXT NOT NULL,
  amount NUMERIC(16,2) NOT NULL
);

-- =====================================================================
-- Índices de apoyo (aislamiento por comité y resolución del ledger)
-- =====================================================================
CREATE INDEX idx_members_committee ON members (committee_id);
CREATE INDEX idx_financial_accounts_committee ON financial_accounts (committee_id);
CREATE INDEX idx_transaction_categories_committee ON transaction_categories (committee_id);
CREATE INDEX idx_financial_transactions_committee ON financial_transactions (committee_id);
CREATE INDEX idx_financial_transactions_category ON financial_transactions (category_id);
CREATE INDEX idx_financial_transactions_activity ON financial_transactions (activity_id);
CREATE INDEX idx_ledger_entries_transaction ON ledger_entries (transaction_id);
CREATE INDEX idx_ledger_entries_account ON ledger_entries (account_id);
CREATE INDEX idx_ledger_entries_committee ON ledger_entries (committee_id);
CREATE INDEX idx_transaction_attachments_transaction ON transaction_attachments (transaction_id);
CREATE INDEX idx_transfers_committee ON transfers (committee_id);
CREATE INDEX idx_cash_closings_committee ON cash_closings (committee_id);
CREATE INDEX idx_cash_closing_details_closing ON cash_closing_details (cash_closing_id);
