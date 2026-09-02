-- Migración 0007 — Funciones y políticas RLS multi-tenant
-- Feature: sac-sistema-administracion-comunitaria
-- Requirements: 2.1, 2.2, 2.4, 2.6, 36.2, 40.2
--
-- Implementa el aislamiento estricto entre comités a nivel de fila (RLS) sobre
-- todas las tablas propiedad de un comité creadas en 0002–0006, alineado con
-- design.md > "Security Design > Modelo RLS multi-tenant" y con el diseño
-- conceptual de SAC_requerimientos_diseno_tecnico.md §16.
--
-- Depende de:
--   0002_identity_authz.sql (committees, committee_users, user_roles, roles)
--   0003_members_finance.sql, 0004_*, 0005_bonus.sql, 0006_audit_indexes.sql
--
-- Modelo de acceso (Requirements 2):
--   - Un usuario tiene acceso a un comité SOLO si existe committee_users con
--     user_id = auth.uid(), committee_id = <fila> y status = 'active' (R2.4).
--   - El rol superadmin tiene acceso administrativo a TODOS los comités sin
--     requerir membresía por comité (R2.6).
--   - RLS filtra a nivel de fila: un usuario ajeno no recibe filas ni conteos
--     del comité no autorizado (R2.2).
--   - Toda tabla de comité lleva committee_id NOT NULL (R2.1) y su acceso pasa
--     por RLS (R40.2).
--
-- Inmutabilidad de audit_logs (R36.2):
--   - Se habilita RLS y se permiten SELECT (con acceso) e INSERT, pero NO se
--     definen políticas de UPDATE ni DELETE para los roles de aplicación
--     (anon/authenticated). Al ser RLS restrictiva por defecto, la ausencia de
--     política de UPDATE/DELETE impide modificar o borrar la bitácora desde las
--     operaciones normales de la aplicación.
--
-- NOTA sobre service_role (R40.3): las operaciones sistémicas del servidor usan
--   la service_role key, que omite RLS por diseño en PostgreSQL/Supabase
--   (BYPASSRLS). Estas políticas gobiernan el acceso del cliente autenticado
--   (rol `authenticated`) mediante la clave anónima.

-- =====================================================================
-- Funciones de seguridad (SECURITY DEFINER con search_path fijo)
-- =====================================================================
-- Se ejecutan con los privilegios del propietario para poder leer
-- committee_users / user_roles con independencia de las políticas RLS de esas
-- tablas, evitando recursión de políticas. Se fija search_path a un valor
-- seguro y explícito para prevenir secuestro de resolución de nombres.

-- is_superadmin():
--   TRUE si el usuario autenticado tiene el rol 'superadmin' en cualquier
--   comité (rol de plataforma global). (R2.6)
-- Se define ANTES que has_committee_access porque esta última la invoca; en
--   funciones LANGUAGE sql el cuerpo se valida (y sus referencias se resuelven)
--   en tiempo de CREATE, por lo que el orden importa.
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.key = 'superadmin'
  );
$$;

COMMENT ON FUNCTION public.is_superadmin() IS
  'TRUE si auth.uid() posee el rol superadmin (administración global de plataforma, R2.6).';

-- has_committee_access(target_committee):
--   TRUE si el usuario autenticado tiene membresía activa en el comité dado,
--   o si es superadmin (acceso global, R2.6). (R2.4)
CREATE OR REPLACE FUNCTION public.has_committee_access(target_committee UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.committee_users cu
    WHERE cu.user_id = auth.uid()
      AND cu.committee_id = target_committee
      AND cu.status = 'active'                 -- membresía activa (R2.4)
  )
  OR public.is_superadmin();                   -- acceso global superadmin (R2.6)
$$;

COMMENT ON FUNCTION public.has_committee_access(UUID) IS
  'TRUE si auth.uid() tiene membresía activa en el comité indicado o es superadmin. Base de las políticas RLS multi-tenant (R2.4, R2.6).';

-- Exponer las funciones a los roles de aplicación (y revocar de PUBLIC).
REVOKE ALL ON FUNCTION public.has_committee_access(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_superadmin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_committee_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated;

-- =====================================================================
-- Tablas de identidad y autorización (RLS específica)
-- =====================================================================

-- committees: un usuario ve/gestiona el comité si tiene acceso a ese id.
-- has_committee_access(id) cubre membresía activa y superadmin (R2.2, R2.6).
ALTER TABLE committees ENABLE ROW LEVEL SECURITY;

CREATE POLICY committees_select ON committees
  FOR SELECT USING (has_committee_access(id));
CREATE POLICY committees_insert ON committees
  FOR INSERT WITH CHECK (is_superadmin());              -- alta de comité: superadmin
CREATE POLICY committees_update ON committees
  FOR UPDATE USING (has_committee_access(id))
             WITH CHECK (has_committee_access(id));
CREATE POLICY committees_delete ON committees
  FOR DELETE USING (is_superadmin());                   -- baja de comité: superadmin

-- committee_users: membresías. El usuario ve sus propias membresías; con acceso
-- al comité (admin/superadmin) ve y gestiona las membresías de ese comité.
ALTER TABLE committee_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY committee_users_select ON committee_users
  FOR SELECT USING (user_id = auth.uid() OR has_committee_access(committee_id));
CREATE POLICY committee_users_insert ON committee_users
  FOR INSERT WITH CHECK (has_committee_access(committee_id));
CREATE POLICY committee_users_update ON committee_users
  FOR UPDATE USING (has_committee_access(committee_id))
             WITH CHECK (has_committee_access(committee_id));
CREATE POLICY committee_users_delete ON committee_users
  FOR DELETE USING (has_committee_access(committee_id));

-- user_roles: asignación de roles por comité. Gestionable con acceso al comité;
-- el usuario puede leer sus propios roles.
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_roles_select ON user_roles
  FOR SELECT USING (user_id = auth.uid() OR has_committee_access(committee_id));
CREATE POLICY user_roles_insert ON user_roles
  FOR INSERT WITH CHECK (has_committee_access(committee_id));
CREATE POLICY user_roles_update ON user_roles
  FOR UPDATE USING (has_committee_access(committee_id))
             WITH CHECK (has_committee_access(committee_id));
CREATE POLICY user_roles_delete ON user_roles
  FOR DELETE USING (has_committee_access(committee_id));

-- profiles: perfil 1:1 con auth.users. Cada usuario gestiona su propio perfil.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (id = auth.uid() OR is_superadmin());
CREATE POLICY profiles_insert ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update ON profiles
  FOR UPDATE USING (id = auth.uid())
             WITH CHECK (id = auth.uid());

-- Catálogos globales de solo lectura (roles, permissions, role_permissions):
-- no llevan committee_id. Se habilita RLS y se permite SELECT a los usuarios
-- autenticados; la escritura queda reservada al servidor (service_role, que
-- omite RLS). Sin políticas de escritura, anon/authenticated no pueden mutarlos.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_select ON roles
  FOR SELECT USING (auth.uid() IS NOT NULL);

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY permissions_select ON permissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_select ON role_permissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- =====================================================================
-- Tablas de comité (RLS genérica por committee_id)
-- =====================================================================
-- Todas estas tablas llevan committee_id NOT NULL (R2.1). El patrón es idéntico:
--   SELECT/INSERT/UPDATE/DELETE permitidos SOLO cuando
--   has_committee_access(committee_id) es TRUE (incluye superadmin, R2.6).
--
-- Se generan las políticas con un bucle para mantener consistencia y evitar
-- omisiones. `audit_logs` se trata aparte (inmutabilidad, R36.2) y NO se incluye
-- en esta lista.
DO $$
DECLARE
  t TEXT;
  committee_tables TEXT[] := ARRAY[
    -- Miembros y finanzas (0003)
    'members',
    'financial_accounts',
    'transaction_categories',
    'financial_transactions',
    'ledger_entries',
    'transaction_attachments',
    'transfers',
    'cash_closings',
    'cash_closing_details',
    -- Aportaciones, donaciones y actividades (0004)
    'activities',
    'activity_members',
    'contributions',
    'donations',
    -- Bonos (0005)
    'bonus_campaigns',
    'bonus_numbers',
    'bonus_holder_assignments',
    'bonus_sellers',
    'bonus_seller_assignments',
    'bonus_monthly_dues',
    'bonus_due_transitions',
    'bonus_collections',
    'bonus_settlements',
    'bonus_settlement_items',
    'bonus_draws',
    'bonus_prize_payments',
    -- Notificaciones (0006)
    'notifications'
  ];
BEGIN
  FOREACH t IN ARRAY committee_tables LOOP
    -- Habilitar RLS en la tabla (R40.2)
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    -- SELECT: solo filas del comité con acceso (R2.2)
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT USING (has_committee_access(committee_id));
    $f$, t || '_select', t);

    -- INSERT: solo hacia comités con acceso (R2.3)
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR INSERT WITH CHECK (has_committee_access(committee_id));
    $f$, t || '_insert', t);

    -- UPDATE: fila objetivo y resultado deben pertenecer a comité con acceso (R2.3)
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR UPDATE USING (has_committee_access(committee_id))
                   WITH CHECK (has_committee_access(committee_id));
    $f$, t || '_update', t);

    -- DELETE: solo filas del comité con acceso (R2.3)
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR DELETE USING (has_committee_access(committee_id));
    $f$, t || '_delete', t);
  END LOOP;
END;
$$;

-- =====================================================================
-- audit_logs — bitácora inmutable (Requirements 36.2)
-- =====================================================================
-- Se habilita RLS. Se permiten:
--   - SELECT: filas cuyo comité el usuario puede acceder; las filas globales
--     (committee_id IS NULL, acciones de plataforma) solo son visibles al
--     superadmin.
--   - INSERT: registrar operaciones sensibles (incluye intentos denegados de
--     acceso/escritura, R2.5). Se exige que quien inserta sea el propio usuario
--     atribuido (user_id = auth.uid()) para conservar la atribución (R36.3);
--     el servidor con service_role omite RLS para escrituras sistémicas.
-- NO se definen políticas de UPDATE ni de DELETE: al ser RLS restrictiva por
--   defecto, ninguna operación normal de la aplicación (anon/authenticated)
--   podrá modificar ni eliminar un registro de auditoría (inmutabilidad, R36.2).
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT USING (
    (committee_id IS NOT NULL AND has_committee_access(committee_id))
    OR (committee_id IS NULL AND is_superadmin())        -- acciones globales
  );

CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT WITH CHECK (
    user_id = auth.uid()                                 -- atribución (R36.3)
    AND (
      committee_id IS NULL
      OR has_committee_access(committee_id)
    )
  );

-- (Intencionalmente SIN políticas de UPDATE/DELETE — inmutabilidad R36.2.)
