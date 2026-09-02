-- Migración 0009 — RPC atómica: rpc_register_income
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 41.2, 41.3
--
-- Implementa la función PostgreSQL `rpc_register_income` que registra un
-- ingreso de forma atómica dentro de una única transacción de base de datos:
--
--   1. Valida el monto: > 0, ≤ 999 999 999 999.99, exactamente ≤ 2 decimales.
--   2. Valida la cuenta receptora: debe existir, pertenecer al comité indicado
--      y estar activa.
--   3. Crea un registro en `financial_transactions` (type='income', status='draft').
--   4. Crea un apunte positivo en `ledger_entries` para la cuenta receptora.
--   5. Registra el evento en `audit_logs` (acción 'income.registered').
--   6. Retorna el UUID de la transacción creada.
--
-- Ante cualquier fallo se ejecuta un ROLLBACK automático completo (R41.3),
-- dejando el sistema sin cambios parciales.
--
-- La función NO evalúa el permiso RBAC `transactions.create` (R12.3): esa
-- verificación corresponde a la capa de Server Actions de Next.js, que controla
-- qué usuarios autenticados pueden invocar esta función.  Mantener la
-- validación RBAC en el servidor evita el acoplamiento de lógica de sesión
-- dentro de la función PostgreSQL (principio de separación de responsabilidades).
--
-- Convenciones (design.md > Data Models):
--   - Montos NUMERIC(16,2) — nunca float (R41.1).
--   - SECURITY DEFINER con SET search_path = public, pg_temp (R41.2).
--   - Toda operación de escritura participa en la transacción del llamador (R41.2).
--   - audit_logs registrado dentro de la misma transacción (R36.4).
--
-- Depende de:
--   0001_extensions.sql (gen_random_uuid)
--   0002_identity_authz.sql (committees)
--   0003_members_finance.sql (financial_accounts, financial_transactions, ledger_entries)
--   0006_audit_indexes.sql (audit_logs)

-- =====================================================================
-- rpc_register_income — registro atómico de un ingreso (R12.1–12.6, R41.2, R41.3)
-- =====================================================================
CREATE OR REPLACE FUNCTION rpc_register_income(
  p_committee_id  UUID,     -- comité al que pertenece el ingreso (R2.1)
  p_actor         UUID,     -- UUID del usuario que realiza el registro (R12.6, R36.1)
  p_account_id    UUID,     -- cuenta receptora activa y del mismo comité (R12.4)
  p_category_id   UUID,     -- categoría de la transacción (puede ser NULL)
  p_activity_id   UUID,     -- actividad relacionada (puede ser NULL)
  p_amount        NUMERIC,  -- monto del ingreso: > 0, ≤ 999999999999.99, ≤ 2 decimales (R12.1, R12.2)
  p_date          DATE,     -- fecha efectiva del ingreso
  p_description   TEXT,     -- concepto/descripción
  p_source_type   TEXT,     -- origen del dominio ('contribution'|'donation'|'settlement'|null)
  p_source_id     UUID,     -- ID del registro de origen (puede ser NULL)
  p_origin        TEXT,     -- persona u origen libre (campo informativo)
  p_payment_method TEXT     -- método de pago
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx_id  UUID;
  v_account_committee UUID;
  v_account_status    TEXT;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. Validar monto (R12.1, R12.2)
  --    - Debe ser estrictamente positivo.
  --    - No debe exceder 999 999 999 999.99.
  --    - Debe tener exactamente ≤ 2 decimales (ROUND(x,2) = x).
  -- ---------------------------------------------------------------
  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'rpc_register_income: el monto es obligatorio'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'rpc_register_income: el monto debe ser mayor a 0 (recibido: %)', p_amount
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_amount > 999999999999.99 THEN
    RAISE EXCEPTION 'rpc_register_income: el monto excede el límite permitido de 999999999999.99 (recibido: %)', p_amount
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF ROUND(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'rpc_register_income: el monto no puede tener más de 2 decimales (recibido: %)', p_amount
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ---------------------------------------------------------------
  -- 2. Validar cuenta receptora (R12.4)
  --    - Debe existir, pertenecer a p_committee_id y estar activa.
  -- ---------------------------------------------------------------
  SELECT committee_id, status
    INTO v_account_committee, v_account_status
    FROM financial_accounts
   WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rpc_register_income: la cuenta receptora no existe (account_id: %)', p_account_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_account_committee <> p_committee_id THEN
    RAISE EXCEPTION 'rpc_register_income: la cuenta receptora no pertenece al comité indicado (account_id: %, committee_id: %)', p_account_id, p_committee_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_account_status <> 'active' THEN
    RAISE EXCEPTION 'rpc_register_income: la cuenta receptora no está activa (account_id: %, status: %)', p_account_id, v_account_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ---------------------------------------------------------------
  -- 3. Insertar la transacción financiera tipo ingreso (R12.1, R12.6)
  --    status='draft' (ciclo borrador→registrado→aprobado, R15.1)
  --    created_by y created_at proveen la atribución (R12.6, R36.3)
  -- ---------------------------------------------------------------
  INSERT INTO financial_transactions (
    committee_id,
    type,
    status,
    transaction_date,
    description,
    category_id,
    activity_id,
    source_type,
    source_id,
    created_by,
    created_at
  ) VALUES (
    p_committee_id,
    'income',
    'draft',
    p_date,
    p_description,
    p_category_id,
    p_activity_id,
    p_source_type,
    p_source_id,
    p_actor,
    now()
  )
  RETURNING id INTO v_tx_id;

  -- ---------------------------------------------------------------
  -- 4. Insertar apunte positivo en el ledger (R12.5)
  --    Un ingreso genera un apunte con amount POSITIVO en la cuenta
  --    receptora, incrementando el Derived_Balance de esa cuenta.
  -- ---------------------------------------------------------------
  INSERT INTO ledger_entries (
    committee_id,
    transaction_id,
    account_id,
    amount,
    created_at
  ) VALUES (
    p_committee_id,
    v_tx_id,
    p_account_id,
    p_amount,            -- POSITIVO: crédito a la cuenta receptora (R12.5)
    now()
  );

  -- ---------------------------------------------------------------
  -- 5. Registrar en audit_logs (R12.6, R36.1, R36.3, R36.4)
  --    Se invoca dentro de la misma transacción para que el fallo
  --    de auditoría provoque el rollback completo de la operación.
  -- ---------------------------------------------------------------
  INSERT INTO audit_logs (
    committee_id,
    user_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values,
    created_at
  ) VALUES (
    p_committee_id,
    p_actor,
    'financial_transaction',
    v_tx_id,
    'income.registered',
    NULL,
    jsonb_build_object(
      'amount',     p_amount,
      'account_id', p_account_id
    ),
    now()
  );

  -- ---------------------------------------------------------------
  -- 6. Retornar el UUID de la transacción creada (R12.1)
  -- ---------------------------------------------------------------
  RETURN v_tx_id;

EXCEPTION
  WHEN OTHERS THEN
    -- R41.3: propagar la excepción para que PostgreSQL ejecute el
    -- ROLLBACK completo de la transacción, dejando el sistema sin
    -- ningún cambio parcial.
    RAISE;
END;
$$;

COMMENT ON FUNCTION rpc_register_income(UUID, UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT, UUID, TEXT, TEXT) IS
  'Registra un ingreso de forma atómica: valida monto (>0, ≤999999999999.99, ≤2 dec.) y cuenta receptora (activa, del mismo comité); crea financial_transaction tipo income/draft, apunte positivo en ledger_entries y entrada en audit_logs; retorna el transaction_id. Rollback total ante cualquier fallo (R12.1-12.6, R41.2, R41.3).';

-- =====================================================================
-- Permisos de ejecución (R12.3 — solo usuarios autenticados)
-- El rol `authenticated` agrupa a todos los usuarios de Supabase Auth.
-- La autorización RBAC (permiso `transactions.create`) se evalúa en la
-- capa de Server Actions ANTES de invocar esta función.
-- =====================================================================
GRANT EXECUTE ON FUNCTION rpc_register_income(UUID, UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated;
