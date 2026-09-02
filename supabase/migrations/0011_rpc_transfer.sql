-- Migración 0011 — RPC atómica: rpc_transfer
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 41.2, 41.3
--
-- Implementa la transferencia interna entre dos cuentas del mismo comité de
-- forma completamente atómica:
--   1. Valida que las cuentas sean distintas (R11.5).
--   2. Valida el monto (0.01–999,999,999.99, ≤2 decimales).
--   3. Verifica que ambas cuentas existan, pertenezcan al comité y estén activas.
--   4. Crea una financial_transaction de tipo 'transfer' / status 'draft'.
--   5. Crea DOS ledger_entries que suman cero (salida −amount, entrada +amount). (R11.2)
--   6. Crea un registro en `transfers` vinculado a la transacción. (R11.4)
--   7. Registra la operación en audit_logs (R36.1, R36.4).
--   8. Retorna el UUID de la transacción.
--
-- RBAC: la verificación del permiso `transactions.create` se realiza en la capa
-- de Server Actions antes de invocar esta función.
--
-- Depende de: 0001, 0002, 0003, 0006.

CREATE OR REPLACE FUNCTION rpc_transfer(
  p_committee_id   UUID,
  p_actor          UUID,
  p_from_account   UUID,
  p_to_account     UUID,
  p_amount         NUMERIC,
  p_date           DATE,
  p_description    TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx_id          UUID;
  v_from_committee UUID;
  v_from_status    TEXT;
  v_to_committee   UUID;
  v_to_status      TEXT;
BEGIN
  -- 1. Cuentas distintas (R11.5)
  IF p_from_account = p_to_account THEN
    RAISE EXCEPTION 'rpc_transfer: las cuentas de origen y destino deben ser distintas'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 2. Validar monto
  IF p_amount IS NULL OR p_amount < 0.01 THEN
    RAISE EXCEPTION 'rpc_transfer: el monto debe ser al menos 0.01 (recibido: %)', p_amount
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_amount > 999999999.99 THEN
    RAISE EXCEPTION 'rpc_transfer: el monto excede el límite de 999999999.99'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF ROUND(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'rpc_transfer: el monto no puede tener más de 2 decimales'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3a. Validar cuenta de origen
  SELECT committee_id, status INTO v_from_committee, v_from_status
    FROM financial_accounts WHERE id = p_from_account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rpc_transfer: cuenta de origen no existe' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_from_committee <> p_committee_id THEN
    RAISE EXCEPTION 'rpc_transfer: cuenta de origen no pertenece al comité' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_from_status <> 'active' THEN
    RAISE EXCEPTION 'rpc_transfer: cuenta de origen no está activa' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3b. Validar cuenta de destino (R11.6: mismo comité)
  SELECT committee_id, status INTO v_to_committee, v_to_status
    FROM financial_accounts WHERE id = p_to_account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rpc_transfer: cuenta de destino no existe' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_to_committee <> p_committee_id THEN
    RAISE EXCEPTION 'rpc_transfer: cuenta de destino no pertenece al comité' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_to_status <> 'active' THEN
    RAISE EXCEPTION 'rpc_transfer: cuenta de destino no está activa' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 4. Crear transacción
  INSERT INTO financial_transactions (
    committee_id, type, status, transaction_date, description, created_by, created_at
  ) VALUES (
    p_committee_id, 'transfer', 'draft', p_date, p_description, p_actor, now()
  ) RETURNING id INTO v_tx_id;

  -- 5. Dos apuntes que suman cero (R11.2): débito de origen, crédito a destino
  INSERT INTO ledger_entries (committee_id, transaction_id, account_id, amount, created_at)
  VALUES (p_committee_id, v_tx_id, p_from_account, -p_amount, now()),
         (p_committee_id, v_tx_id, p_to_account,   +p_amount, now());

  -- 6. Registro de transferencia (R11.4)
  INSERT INTO transfers (committee_id, transaction_id, from_account_id, to_account_id, amount, created_at)
  VALUES (p_committee_id, v_tx_id, p_from_account, p_to_account, p_amount, now());

  -- 7. Auditoría (R36.1, R36.4)
  INSERT INTO audit_logs (committee_id, user_id, entity_type, entity_id, action, new_values, created_at)
  VALUES (p_committee_id, p_actor, 'financial_transaction', v_tx_id, 'transfer.registered',
          jsonb_build_object('amount', p_amount, 'from_account', p_from_account, 'to_account', p_to_account),
          now());

  RETURN v_tx_id;

EXCEPTION WHEN OTHERS THEN
  RAISE; -- R41.3: rollback total
END;
$$;

COMMENT ON FUNCTION rpc_transfer(UUID,UUID,UUID,UUID,NUMERIC,DATE,TEXT) IS
  'Registra una transferencia interna atómica entre dos cuentas del comité: valida cuentas distintas del mismo comité y activas, crea financial_transaction tipo transfer/draft, dos ledger_entries que suman cero y un registro en transfers (R11.1–11.6, R41.2, R41.3).';

GRANT EXECUTE ON FUNCTION rpc_transfer(UUID,UUID,UUID,UUID,NUMERIC,DATE,TEXT) TO authenticated;
