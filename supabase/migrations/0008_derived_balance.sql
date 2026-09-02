-- Migración 0008 — Saldo derivado del ledger (Ledger_Service)
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 10.1, 10.2, 10.3
--
-- Materializa la definición de RF-031: el saldo de una cuenta SIEMPRE es un
-- valor DERIVADO del ledger, nunca un campo editable.
--
--   Derived_Balance(cuenta) = opening_balance + COALESCE(SUM(amount), 0)
--
-- (Requirements 10.1). No existe una columna de saldo editable en
-- `financial_accounts`: la tabla solo expone `opening_balance` (saldo inicial),
-- por lo que NO hay forma de asignar directamente un valor de saldo a una
-- cuenta (Requirements 10.2). Cualquier apunte nuevo en `ledger_entries` queda
-- reflejado automáticamente porque el saldo se computa al vuelo (Requirements
-- 10.3).
--
-- Depende de 0001_extensions.sql (pgcrypto),
-- 0003_members_finance.sql (financial_accounts, ledger_entries) y
-- 0006_audit_indexes.sql (idx_ledger_committee_account).
--
-- Convenciones (design.md > Data Models):
--   - Los montos son NUMERIC(16,2), nunca float (R41.1).
--   - El cálculo respeta committee_id (aislamiento multi-tenant, R2.x).

-- =====================================================================
-- Índices de apoyo
-- =====================================================================
-- El índice compuesto (committee_id, account_id) que acelera la agregación del
-- saldo derivado ya existe: `idx_ledger_committee_account` se creó en
-- 0006_audit_indexes.sql. NO se duplica aquí para evitar índices redundantes.
--
-- Se agrega, de forma idempotente, un índice por account_id que soporta la
-- variante de consulta que agrupa apuntes solo por cuenta (por ejemplo, la
-- función `account_derived_balance` cuando ya se conoce la cuenta), y que
-- resulta útil si el planificador no puede aprovechar el índice compuesto.
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_amount
  ON ledger_entries (account_id);

-- =====================================================================
-- account_derived_balance(account) — saldo derivado de una cuenta (R10.1, R10.3)
-- =====================================================================
-- Recibe una fila de `financial_accounts` y devuelve su saldo derivado como
-- opening_balance + COALESCE(SUM(ledger_entries.amount), 0). La suma se acota
-- al mismo committee_id de la cuenta, de modo que solo intervienen los apuntes
-- del comité propietario (aislamiento, R2.x). Al no existir un campo de saldo
-- editable, esta función es la ÚNICA fuente de verdad del saldo (R10.2).
--
-- Es STABLE (solo lee) y puede usarse como "columna calculada" del esquema:
--   SELECT *, account_derived_balance(a) AS balance FROM financial_accounts a;
-- o directamente:
--   SELECT account_derived_balance(a) FROM financial_accounts a WHERE a.id = ?;
CREATE OR REPLACE FUNCTION account_derived_balance(account financial_accounts)
RETURNS NUMERIC(16,2)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT account.opening_balance
    + COALESCE(
        (
          SELECT SUM(le.amount)
          FROM ledger_entries le
          WHERE le.account_id = account.id
            AND le.committee_id = account.committee_id
        ),
        0
      );
$$;

COMMENT ON FUNCTION account_derived_balance(financial_accounts) IS
  'Saldo derivado = opening_balance + COALESCE(SUM(ledger_entries.amount),0), acotado al committee_id de la cuenta (RF-031; Requirements 10.1, 10.2, 10.3).';

-- =====================================================================
-- account_derived_balances — vista de saldo derivado por cuenta (R10.1)
-- =====================================================================
-- Expone el saldo derivado de cada cuenta para dashboard/reportes (saldo por
-- cuenta, saldo consolidado). Al derivarse de la función anterior, hereda el
-- mismo cálculo y aislamiento por comité. Como no persiste saldo alguno, es
-- imposible asignar un saldo directamente a través de ella (R10.2).
CREATE OR REPLACE VIEW account_derived_balances AS
  SELECT
    a.id            AS account_id,
    a.committee_id  AS committee_id,
    a.name          AS name,
    a.type          AS type,
    a.status        AS status,
    a.opening_balance,
    account_derived_balance(a) AS derived_balance
  FROM financial_accounts a;

COMMENT ON VIEW account_derived_balances IS
  'Saldo derivado por cuenta (opening_balance + suma de apuntes del ledger), por comité (Requirements 10.1, 10.3).';

-- Grant access so authenticated users and the service role can query the view.
GRANT SELECT ON account_derived_balances TO authenticated;
GRANT EXECUTE ON FUNCTION account_derived_balance(financial_accounts) TO authenticated;
