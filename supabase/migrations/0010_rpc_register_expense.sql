-- Migración 0010 — RPC atómica: rpc_register_expense
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 41.2, 41.3
--
-- Implementa la función PostgreSQL `rpc_register_expense` que registra un
-- egreso de forma atómica dentro de una única transacción de base de datos:
--
--   1. Valida que los campos obligatorios estén presentes y no vacíos
--      (fecha, monto, beneficiario, descripción, categoría, método de pago,
--      cuenta de origen).  (R14.3)
--   2. Valida el monto: 0.01 ≤ monto ≤ 999 999 999.99, exactamente ≤ 2 decimales. (R14.2)
--   3. Valida la cuenta de origen: debe existir, pertenecer al comité indicado
--      y estar activa. (R14.5)
--   4. Crea un registro en `financial_transactions` (type='expense', status='draft'). (R14.1)
--   5. Crea un apunte NEGATIVO en `ledger_entries` para la cuenta de origen. (R14.4)
--   6. Registra el evento en `audit_logs` (acción 'expense.registered'). (R36.1, R36.3)
--   7. Retorna el UUID de la transacción creada.
--
-- Ante cualquier fallo se ejecuta un ROLLBACK automático completo (R41.3),
-- dejando el sistema sin cambios parciales.
--
-- La función NO evalúa el permiso RBAC `transactions.create` (R14.1): esa
-- verificación corresponde a la capa de Server Actions de Next.js, que controla
-- qué usuarios autenticados pueden invocar esta función. Mantener la
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
-- rpc_register_expense — registro atómico de un egreso (R14.1–14.5, R41.2, R41.3)
-- =====================================================================
CREATE OR REPLACE FUNCTION rpc_register_expense(
  p_committee_id   UUID,     -- comité al que pertenece el egreso (R2.1)
  p_actor          UUID,     -- UUID del usuario que realiza el registro (R36.1, R36.3)
  p_account_id     UUID,     -- cuenta de origen activa y del mismo comité (R14.5)
  p_category_id    UUID,     -- categoría de la transacción (obligatoria, R14.3)
  p_activity_id    UUID,     -- actividad relacionada (puede ser NULL)
  p_amount         NUMERIC,  -- monto del egreso: 0.01–999999999.99, ≤ 2 decimales (R14.1, R14.2)
  p_date           DATE,     -- fecha efectiva del egreso (R14.3)
  p_beneficiary    TEXT,     -- beneficiario/proveedor (R14.3)
  p_description    TEXT,     -- concepto/descripción (R14.3)
  p_payment_method TEXT,     -- método de pago (R14.3)
  p_source_type    TEXT,     -- origen del dominio ('prize'|'settlement'|null)
  p_source_id      UUID      -- ID del registro de origen (puede ser NULL)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx_id             UUID;
  v_account_committee UUID;
  v_account_status    TEXT;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. Validar campos obligatorios (R14.3)
  --    Todos los campos requeridos deben estar presentes y, donde
  --    aplica, no ser cadenas vacías ni solo espacios en blanco.
  -- ---------------------------------------------------------------
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'rpc_register_expense: la fecha efectiva es obligatoria'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'rpc_register_expense: el monto es obligatorio'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_beneficiary IS NULL OR trim(p_beneficiary) = '' THEN
    RAISE EXCEPTION 'rpc_register_expense: el beneficiario es obligatorio'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_description IS NULL OR trim(p_description) = '' THEN
    RAISE EXCEPTION 'rpc_register_expense: la descripción/concepto es obligatoria'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_category_id IS NULL THEN
    RAISE EXCEPTION 'rpc_register_expense: la categoría es obligatoria'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_payment_method IS NULL OR trim(p_payment_method) = '' THEN
    RAISE EXCEPTION 'rpc_register_expense: el método de pago es obligatorio'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'rpc_register_expense: la cuenta de origen es obligatoria'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ---------------------------------------------------------------
  -- 2. Validar monto (R14.2)
  --    - Debe ser ≥ 0.01.
  --    - No debe exceder 999 999 999.99.
  --    - Debe tener exactamente ≤ 2 decimales (ROUND(x,2) = x).
  -- ---------------------------------------------------------------
  IF p_amount < 0.01 THEN
    RAISE EXCEPTION 'rpc_register_expense: el monto debe ser al menos 0.01 (recibido: %)', p_amount
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_amount > 999999999.99 THEN
    RAISE EXCEPTION 'rpc_register_expense: el monto excede el límite permitido de 999999999.99 (recibido: %)', p_amount
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF ROUND(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'rpc_register_expense: el monto no puede tener más de 2 decimales (recibido: %)', p_amount
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ---------------------------------------------------------------
  -- 3. Validar cuenta de origen (R14.5)
  --    - Debe existir, pertenecer a p_committee_id y estar activa.
  --    - Si está inactiva se lanza excepción específica (R14.5).
  -- ---------------------------------------------------------------
  SELECT committee_id, status
    INTO v_account_committee, v_account_status
    FROM financial_accounts
   WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rpc_register_expense: la cuenta de origen no existe (account_id: %)', p_account_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_account_committee <> p_committee_id THEN
    RAISE EXCEPTION 'rpc_register_expense: la cuenta de origen no pertenece al comité indicado (account_id: %, committee_id: %)', p_account_id, p_committee_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_account_status <> 'active' THEN
    RAISE EXCEPTION 'rpc_register_expense: la cuenta de origen no está activa (account_id: %, status: %)', p_account_id, v_account_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ---------------------------------------------------------------
  -- 4. Insertar la transacción financiera tipo egreso (R14.1)
  --    status='draft' (ciclo borrador→registrado→aprobado, R15.1)
  --    created_by y created_at proveen la atribución (R36.3)
  --    p_beneficiary se almacena en description para el concepto del
  --    egreso; el campo description lleva el concepto libre.
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
    'expense',
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
  -- 5. Insertar apunte NEGATIVO en el ledger (R14.4)
  --    Un egreso genera un apunte con amount NEGATIVO en la cuenta
  --    de origen, reduciendo el Derived_Balance de esa cuenta.
  --    El monto almacenado es -p_amount para reflejar el débito.
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
    -p_amount,           -- NEGATIVO: débito a la cuenta de origen (R14.4)
    now()
  );

  -- ---------------------------------------------------------------
  -- 6. Registrar en audit_logs (R36.1, R36.3, R36.4)
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
    'expense.registered',
    NULL,
    jsonb_build_object(
      'amount',         p_amount,
      'account_id',     p_account_id,
      'beneficiary',    p_beneficiary,
      'payment_method', p_payment_method
    ),
    now()
  );

  -- ---------------------------------------------------------------
  -- 7. Retornar el UUID de la transacción creada (R14.1)
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

COMMENT ON FUNCTION rpc_register_expense(UUID, UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID) IS
  'Registra un egreso de forma atómica: valida campos obligatorios (fecha, monto, beneficiario, descripción, categoría, método de pago, cuenta); valida monto (0.01–999999999.99, ≤2 dec.) y cuenta de origen (activa, del mismo comité); crea financial_transaction tipo expense/draft, apunte negativo en ledger_entries y entrada en audit_logs; retorna el transaction_id. Rollback total ante cualquier fallo (R14.1-14.5, R41.2, R41.3).';

-- =====================================================================
-- Permisos de ejecución (R14.1 — solo usuarios autenticados)
-- El rol `authenticated` agrupa a todos los usuarios de Supabase Auth.
-- La autorización RBAC (permiso `transactions.create`) se evalúa en la
-- capa de Server Actions ANTES de invocar esta función.
-- =====================================================================
GRANT EXECUTE ON FUNCTION rpc_register_expense(UUID, UUID, UUID, UUID, UUID, NUMERIC, DATE, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
