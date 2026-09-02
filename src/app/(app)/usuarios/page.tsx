import { createSupabaseServerClient } from '@/lib/supabase/server';

import {
  ROLE_LABELS,
  RoleAssignForm,
  type RoleKey,
  type UserOption,
} from './role-assign-form';

/**
 * Pantalla de administración de usuarios / roles / permisos
 * (design.md §18.2 #26; Requirements 5.2, 42.2, 42.3).
 *
 * Server Component que lista los usuarios del comité activo (`committee_users`)
 * junto con sus roles asignados (`user_roles` → `roles`) usando el cliente de
 * servidor ligado a la sesión, de modo que RLS restringe las filas al comité
 * del usuario (Requirements 2.2). Incluye un formulario cliente para asignar
 * uno de los 9 roles predefinidos a un usuario miembro activo mediante
 * `assignRoleAction`, con confirmación explícita.
 */

export const dynamic = 'force-dynamic';

interface CommitteeUserRow {
  id: string;
  user_id: string;
  status: string;
  member_id: string | null;
  members: { full_name: string | null } | null;
}

interface UserRoleRow {
  user_id: string;
  roles: { key: string } | null;
}

/** Traduce una clave de rol a su etiqueta legible; deja la clave si es desconocida. */
function roleLabel(key: string): string {
  return ROLE_LABELS[key as RoleKey] ?? key;
}

export default async function UsersPage() {
  const supabase = await createSupabaseServerClient();

  // Usuarios del comité activo con su miembro vinculado (RLS por comité, R2.2).
  const { data: usersData, error: usersError } = await supabase
    .from('committee_users')
    .select('id, user_id, status, member_id, members(full_name)')
    .order('created_at', { ascending: true });

  const committeeUsers = (usersData ?? []) as unknown as CommitteeUserRow[];

  // Roles asignados por usuario dentro del comité activo.
  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('user_id, roles(key)');

  const userRoles = (rolesData ?? []) as unknown as UserRoleRow[];

  // Agrupa las claves de rol por usuario.
  const rolesByUser = new Map<string, string[]>();
  for (const row of userRoles) {
    const key = row.roles?.key;
    if (!key) {
      continue;
    }
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(key);
    rolesByUser.set(row.user_id, list);
  }

  /** Nombre legible de un usuario: nombre del miembro vinculado o su id. */
  function userDisplayName(row: CommitteeUserRow): string {
    return row.members?.full_name ?? row.user_id;
  }

  // Opciones para el formulario: usuarios miembros activos del comité.
  const userOptions: UserOption[] = committeeUsers
    .filter((row) => row.status === 'active')
    .map((row) => ({ userId: row.user_id, label: userDisplayName(row) }));

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">Usuarios y roles</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Administra los usuarios del comité activo y sus roles.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Lista de usuarios con sus roles */}
        <div className="flex flex-col gap-3">
          {usersError ? (
            <p role="alert" className="text-sm text-red-600">
              No se pudieron cargar los usuarios: {usersError.message}
            </p>
          ) : committeeUsers.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              No hay usuarios en el comité activo.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {committeeUsers.map((row) => {
                const roleKeys = rolesByUser.get(row.user_id) ?? [];
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-2 rounded-2xl border border-gray-200 p-4 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-base font-semibold">
                        {userDisplayName(row)}
                      </span>
                      <span
                        className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          row.status === 'active'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                            : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        }`}
                      >
                        {row.status === 'active' ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 sm:justify-end">
                      {roleKeys.length === 0 ? (
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          Sin roles
                        </span>
                      ) : (
                        roleKeys.map((key) => (
                          <span
                            key={key}
                            className="inline-flex items-center rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand dark:bg-brand/20"
                          >
                            {roleLabel(key)}
                          </span>
                        ))
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Formulario de asignación de rol */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <RoleAssignForm users={userOptions} />
        </div>
      </div>
    </section>
  );
}
