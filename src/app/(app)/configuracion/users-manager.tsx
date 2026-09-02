'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { CommitteeUserRow, RoleOption } from '@/server/role-service';
import { assignRoleAction, removeRoleAction } from '@/server/actions/role-actions';

/**
 * Gestión de usuarios del comité: lista de usuarios con sus roles y controles
 * para asignar o retirar roles. Requiere el permiso `users.manage`
 * (el listado ya viene filtrado por la Server Action).
 */
export function UsersManager({
  users,
  roles,
  error,
}: {
  users: CommitteeUserRow[];
  roles: RoleOption[];
  error: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  if (error) {
    return (
      <p role="alert" className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {error}
      </p>
    );
  }

  function assign(userId: string, roleKey: string) {
    if (!roleKey) return;
    setActionError(null);
    setBusyUser(userId);
    startTransition(async () => {
      const result = await assignRoleAction(userId, roleKey);
      setBusyUser(null);
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  function remove(userId: string, roleKey: string, roleName: string) {
    if (!window.confirm(`¿Retirar el rol "${roleName}" a este usuario?`)) return;
    setActionError(null);
    setBusyUser(userId);
    startTransition(async () => {
      const result = await removeRoleAction(userId, roleKey);
      setBusyUser(null);
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  if (users.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Aún no hay usuarios en el comité. Comparte el código para que se unan.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {actionError ? (
        <p role="alert" className="text-sm text-red-600">
          {actionError}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {users.map((u) => {
          const assignedKeys = new Set(u.roles.map((r) => r.key));
          const available = roles.filter((r) => !assignedKeys.has(r.key));
          const busy = isPending && busyUser === u.userId;
          return (
            <li
              key={u.userId}
              className="flex flex-col gap-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-base font-semibold">{u.fullName ?? 'Sin nombre'}</span>
                {u.email ? (
                  <span className="text-sm text-gray-600 dark:text-gray-300">{u.email}</span>
                ) : null}
                {u.status !== 'active' ? (
                  <span className="inline-flex w-fit items-center rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                    {u.status}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {u.roles.length === 0 ? (
                  <span className="text-sm text-gray-500">Sin roles asignados</span>
                ) : (
                  u.roles.map((r) => (
                    <span
                      key={r.key}
                      className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand"
                    >
                      {r.name}
                      <button
                        type="button"
                        aria-label={`Retirar rol ${r.name}`}
                        disabled={busy}
                        onClick={() => remove(u.userId, r.key, r.name)}
                        className="ml-0.5 rounded-full px-1 text-brand hover:bg-brand/20 disabled:opacity-50"
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>

              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`add-role-${u.userId}`}>
                  Asignar rol
                </label>
                <select
                  id={`add-role-${u.userId}`}
                  disabled={busy || available.length === 0}
                  defaultValue=""
                  onChange={(e) => {
                    const value = e.target.value;
                    e.target.value = '';
                    assign(u.userId, value);
                  }}
                  className="min-h-touch rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="" disabled>
                    {available.length === 0 ? 'Todos los roles asignados' : 'Asignar rol…'}
                  </option>
                  {available.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {busy ? <span className="text-sm text-gray-500">Guardando…</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
