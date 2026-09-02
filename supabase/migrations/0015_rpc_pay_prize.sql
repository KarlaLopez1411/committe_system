-- Migración 0015 — RPC atómica: rpc_pay_prize
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 33.1, 33.2, 33.3, 33.4, 33.5, 41.2
--
-- Paga el premio de un sorteo de forma atómica:
--   1. Verifica que el sorteo exista y pertenezca al comité.
--   2. Verifica que no exista ya un pago (draw_id UNIQUE → R33.4).
--   3. Crea un egreso tipo "Premio de bono" con monto = prize_amount.
--   4. Crea ledger entry negativa en la cuenta indicada.
--   5. Inserta bonus_prize_payment vinculando draw y financial_transaction.
--   6. Audita.
--   7. Rollback total (R41.3).

CREATE OR REPLACE FUNCTION rpc_pay_prize(
  p_committee_id UUID,
  p_actor        UUID,
  p_draw_id      UUID,
  p_account_id   UUID,
  p_category_id  UUID
)
RETURNS UUID   -- returns financial_transaction_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_draw   bonus_draws%ROWTYPE;
  v_tx_id  UUID;
BEGIN
  SELECT * INTO v_draw FROM bonus_draws
   WHERE id = p_draw_id AND committee_id = p_committee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rpc_pay_prize: sorteo no encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_draw.status = 'anulado' THEN
    RAISE EXCEPTION 'rpc_pay_prize: el sorteo está anulado' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- R33.4: UNIQUE on draw_id prevents double payment
  -- R33.1: create expense transaction
  INSERT INTO financial_transactions (
    committee_id, type, status, transaction_date, description, category_id,
    source_type, source_id, created_by, created_at
  ) VALUES (
    p_committee_id, 'expense', 'posted', v_draw.draw_date,
    'Premio de bono – ' || v_draw.beneficiary_snapshot, p_category_id,
    'prize', p_draw_id, p_actor, now()
  ) RETURNING id INTO v_tx_id;

  INSERT INTO ledger_entries (committee_id, transaction_id, account_id, amount, created_at)
  VALUES (p_committee_id, v_tx_id, p_account_id, -v_draw.prize_amount, now());

  INSERT INTO bonus_prize_payments (committee_id, draw_id, amount, financial_transaction_id, created_by)
  VALUES (p_committee_id, p_draw_id, v_draw.prize_amount, v_tx_id, p_actor);

  INSERT INTO audit_logs (committee_id, user_id, entity_type, entity_id, action, new_values, created_at)
  VALUES (p_committee_id, p_actor, 'bonus_draw', p_draw_id,
          'prize.paid', jsonb_build_object('transaction_id', v_tx_id, 'amount', v_draw.prize_amount), now());

  RETURN v_tx_id;

EXCEPTION WHEN OTHERS THEN
  RAISE; -- R41.3
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_pay_prize(UUID,UUID,UUID,UUID,UUID) TO authenticated;
