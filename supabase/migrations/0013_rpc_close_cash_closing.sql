-- Migración 0013 — RPC atómica: rpc_close_cash_closing
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 23.2, 23.3, 23.4, 41.3
--
-- Cierra un corte mensual de caja de forma atómica:
--   1. Verifica existencia y pertenencia al comité.
--   2. Verifica que el estado sea 'aprobado' (R23.2).
--   3. Transiciona a 'cerrado' (R23.3: un solo cierre).
--   4. Registra en audit_logs.

CREATE OR REPLACE FUNCTION rpc_close_cash_closing(
  p_committee_id UUID,
  p_actor        UUID,
  p_closing_id   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
    FROM cash_closings
   WHERE id = p_closing_id AND committee_id = p_committee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rpc_close_cash_closing: corte no encontrado'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- R23.2: solo desde 'aprobado'
  IF v_status <> 'aprobado' THEN
    RAISE EXCEPTION 'rpc_close_cash_closing: el corte debe estar en estado aprobado para cerrarse (estado actual: %)', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- R23.3: transition aprobado → cerrado
  UPDATE cash_closings SET status = 'cerrado' WHERE id = p_closing_id AND committee_id = p_committee_id;

  INSERT INTO audit_logs (committee_id, user_id, entity_type, entity_id, action, new_values, created_at)
  VALUES (p_committee_id, p_actor, 'cash_closing', p_closing_id, 'cash_closing.closed',
          jsonb_build_object('status', 'cerrado'), now());

EXCEPTION WHEN OTHERS THEN
  RAISE; -- R41.3
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_close_cash_closing(UUID,UUID,UUID) TO authenticated;
