-- Migración 0014 — RPC atómica: rpc_confirm_settlement
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 31.3, 31.4, 31.5, 31.6, 41.2, 41.4
--
-- Confirma la entrega de un vendedor a tesorería de forma atómica:
--   1. Valida que el confirmador ≠ quien reportó (R31.4).
--   2. Valida permiso implícito (debe ser llamado solo tras verificación RBAC en SA).
--   3. Crea un ingreso categoría Bonos (R31.3).
--   4. Transiciona mensualidades vinculadas a 'confirmado'.
--   5. Marca la entrega como 'confirmada' con financial_transaction_id.
--   6. UNIQUE en financial_transaction_id previene confirmación doble (R31.5, R41.4).
--   7. Audita (R36.1).
--   8. Rollback total ante cualquier fallo (R41.3).

CREATE OR REPLACE FUNCTION rpc_confirm_settlement(
  p_committee_id   UUID,
  p_actor          UUID,
  p_settlement_id  UUID,
  p_account_id     UUID,
  p_category_id    UUID
)
RETURNS UUID           -- returns financial_transaction_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settlement  bonus_settlements%ROWTYPE;
  v_tx_id       UUID;
BEGIN
  SELECT * INTO v_settlement FROM bonus_settlements
   WHERE id = p_settlement_id AND committee_id = p_committee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rpc_confirm_settlement: entrega no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  -- R31.4: confirmador ≠ quien reportó
  IF v_settlement.reported_by = p_actor THEN
    RAISE EXCEPTION 'rpc_confirm_settlement: el vendedor no puede confirmar su propia entrega' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Only 'reportada' can be confirmed
  IF v_settlement.status <> 'reportada' THEN
    RAISE EXCEPTION 'rpc_confirm_settlement: la entrega debe estar en estado reportada (estado actual: %)', v_settlement.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- R31.3: create income transaction for the reported amount
  INSERT INTO financial_transactions (
    committee_id, type, status, transaction_date, description, category_id,
    source_type, source_id, created_by, created_at
  ) VALUES (
    p_committee_id, 'income', 'posted', current_date,
    'Confirmación de entrega de bono', p_category_id,
    'settlement', p_settlement_id, p_actor, now()
  ) RETURNING id INTO v_tx_id;

  INSERT INTO ledger_entries (committee_id, transaction_id, account_id, amount, created_at)
  VALUES (p_committee_id, v_tx_id, p_account_id, v_settlement.reported_amount, now());

  -- Transition all linked monthly dues to 'confirmado'
  UPDATE bonus_monthly_dues
     SET status = 'confirmado'
   WHERE id IN (
     SELECT bc.monthly_due_id          -- get monthly_due_id from the collection record
     FROM bonus_settlement_items bsi
     JOIN bonus_collections bc ON bc.id = bsi.collection_id
     WHERE bsi.settlement_id = p_settlement_id
   );

  -- Mark settlement as confirmed (R31.5 UNIQUE prevents double)
  UPDATE bonus_settlements
     SET status = 'confirmada', confirmed_at = now(), confirmed_by = p_actor,
         confirmed_amount = reported_amount, financial_transaction_id = v_tx_id
   WHERE id = p_settlement_id AND committee_id = p_committee_id;

  INSERT INTO audit_logs (committee_id, user_id, entity_type, entity_id, action, new_values, created_at)
  VALUES (p_committee_id, p_actor, 'bonus_settlement', p_settlement_id,
          'settlement.confirmed', jsonb_build_object('transaction_id', v_tx_id), now());

  RETURN v_tx_id;

EXCEPTION WHEN OTHERS THEN
  RAISE; -- R41.3
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_confirm_settlement(UUID,UUID,UUID,UUID,UUID) TO authenticated;
