-- Migración 0012 — RPC atómica: rpc_void_transaction
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 15.3, 15.4, 41.3
--
-- Anula una transacción contabilizada creando una transacción compensatoria
-- con `reversal_of`:
--   1. Verifica que la transacción exista y pertenezca al comité (R15.4).
--   2. Verifica que esté en estado 'posted' (solo movimientos contabilizados
--      pueden anularse) (R15.3).
--   3. Crea una nueva transacción compensatoria con el mismo tipo y
--      `reversal_of = p_transaction_id`, `status = 'posted'`.
--   4. Duplica los ledger_entries con montos negados (suma cero acumulada).
--   5. Marca la transacción original como 'reversed'.
--   6. NO elimina ni modifica físicamente ningún registro original (R15.4).
--   7. Audita (R36.1, R36.4).
--   8. Retorna el UUID de la nueva transacción compensatoria.
--
-- Depende de: 0001, 0002, 0003, 0006.

CREATE OR REPLACE FUNCTION rpc_void_transaction(
  p_committee_id   UUID,
  p_actor          UUID,
  p_transaction_id UUID,
  p_reason         TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_orig       financial_transactions%ROWTYPE;
  v_new_tx_id  UUID;
  v_entry      ledger_entries%ROWTYPE;
BEGIN
  -- 1. Obtener y validar la transacción original
  SELECT * INTO v_orig FROM financial_transactions
   WHERE id = p_transaction_id AND committee_id = p_committee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rpc_void_transaction: transacción no encontrada o no pertenece al comité (id: %)', p_transaction_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 2. Solo transacciones en estado 'posted' pueden anularse (R15.3)
  IF v_orig.status <> 'posted' THEN
    RAISE EXCEPTION 'rpc_void_transaction: solo se pueden anular transacciones en estado posted (estado actual: %)', v_orig.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3. Crear transacción compensatoria (R15.3, R15.4)
  INSERT INTO financial_transactions (
    committee_id, type, status, transaction_date, description,
    category_id, activity_id, created_by, created_at, reversal_of
  ) VALUES (
    v_orig.committee_id,
    v_orig.type,
    'posted',               -- ya contabilizada
    v_orig.transaction_date,
    COALESCE(p_reason, 'Anulación de transacción ' || p_transaction_id),
    v_orig.category_id,
    v_orig.activity_id,
    p_actor,
    now(),
    p_transaction_id        -- vínculo con el original (R15.3)
  ) RETURNING id INTO v_new_tx_id;

  -- 4. Duplicar ledger_entries con montos negados (suma acumulada = 0)
  FOR v_entry IN
    SELECT * FROM ledger_entries
     WHERE transaction_id = p_transaction_id AND committee_id = p_committee_id
  LOOP
    INSERT INTO ledger_entries (committee_id, transaction_id, account_id, amount, created_at)
    VALUES (p_committee_id, v_new_tx_id, v_entry.account_id, -v_entry.amount, now());
  END LOOP;

  -- 5. Marcar original como 'reversed' (no se elimina ni modifica el contenido, R15.4)
  UPDATE financial_transactions
     SET status = 'reversed'
   WHERE id = p_transaction_id AND committee_id = p_committee_id;

  -- 6. Auditoría (R36.1, R36.4)
  INSERT INTO audit_logs (committee_id, user_id, entity_type, entity_id, action, old_values, new_values, created_at)
  VALUES (
    p_committee_id, p_actor, 'financial_transaction', p_transaction_id,
    'transaction.voided',
    jsonb_build_object('status', 'posted'),
    jsonb_build_object('status', 'reversed', 'reversal_id', v_new_tx_id, 'reason', p_reason),
    now()
  );

  RETURN v_new_tx_id;

EXCEPTION WHEN OTHERS THEN
  RAISE; -- R41.3: rollback total
END;
$$;

COMMENT ON FUNCTION rpc_void_transaction(UUID,UUID,UUID,TEXT) IS
  'Anula una transacción contabilizada (posted) creando una transacción compensatoria con reversal_of y apuntes de ledger negados; marca el original como reversed. No elimina ni modifica físicamente el original (R15.3, R15.4, R41.3).';

GRANT EXECUTE ON FUNCTION rpc_void_transaction(UUID,UUID,UUID,TEXT) TO authenticated;
