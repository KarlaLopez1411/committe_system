import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  listCommitteeUsersAction,
  listRolesAction,
} from '@/server/actions/role-actions';
import { resolvePagePerms } from '@/server/actions/page-perms';

import { ConfigTabs } from './config-tabs';

export const dynamic = 'force-dynamic';

interface CommitteeRow {
  id: string;
  name: string;
  locality: string | null;
  phone: string | null;
  email: string | null;
  code: string | null;
}

export default async function ConfigurationPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('committees')
    .select('id, name, locality, phone, email, code')
    .maybeSingle();

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        No se pudo cargar la configuración: {error.message}
      </p>
    );
  }

  if (!data) {
    return (
      <section className="flex max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">Configuración del comité</h1>
        </header>
        <p className="text-sm text-gray-500">No hay un comité activo para configurar.</p>
      </section>
    );
  }

  const committee = data as CommitteeRow;

  const perms = await resolvePagePerms();

  // Gestión de usuarios: solo disponible para quien tenga `users.manage`.
  // Las acciones devuelven AUTHZ_FORBIDDEN si no; ese caso se muestra como aviso.
  const [usersResult, rolesResult] = await Promise.all([
    listCommitteeUsersAction(),
    listRolesAction(),
  ]);

  const users = usersResult.ok ? usersResult.value : [];
  const roles = rolesResult.ok ? rolesResult.value : [];
  const usersError = usersResult.ok
    ? null
    : 'No tienes permiso para gestionar los usuarios de este comité.';

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">Configuración del comité</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Actualiza los datos del comité, comparte el código de invitación y administra los usuarios.
        </p>
      </header>
      <ConfigTabs
        committee={committee}
        code={committee.code}
        users={users}
        roles={roles}
        usersError={usersError}
        canManage={perms.canManageCommittee}
      />
    </section>
  );
}
