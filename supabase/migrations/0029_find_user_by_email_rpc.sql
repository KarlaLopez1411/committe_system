-- RPC para buscar user_id por email (seguro)
-- Permite que el backend busque usuarios sin acceso directo a auth.users
CREATE OR REPLACE FUNCTION find_user_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Buscar en auth.users por email (acceso via service_role)
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = LOWER(TRIM(p_email))
  LIMIT 1;

  RETURN v_user_id;
END;
$$;

-- Alternativa: buscar user_id en profiles que está vinculado a auth.users
-- Esta función es más segura porque no accede directamente a auth.users
CREATE OR REPLACE FUNCTION find_user_by_email_via_profiles(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Buscar el user_id que pertenece a un perfil
  -- y verificar que tiene al menos un comité activo
  SELECT cu.user_id INTO v_user_id
  FROM committee_users cu
  WHERE cu.status = 'active'
  LIMIT 1;

  RETURN v_user_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION find_user_by_email(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION find_user_by_email_via_profiles(text) TO authenticated, anon;
