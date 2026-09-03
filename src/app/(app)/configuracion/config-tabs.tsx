'use client';

import { useState } from 'react';

import type { UUID } from '@/domain/types';
import type { CommitteeUserRow, RoleOption } from '@/server/role-service';

import { CommitteeConfigForm } from './committee-config-form';
import { CommitteeCodeCard } from './committee-code-card';
import { UsersManager } from './users-manager';
import { PasswordChangeRequestsTable } from './password-change-requests';
import { PasswordChangeRequestForm } from './password-change-request-form';

interface CommitteeRow {
  id: UUID;
  name: string;
  locality: string | null;
  phone: string | null;
  email: string | null;
}

const ALL_TABS = [
  { id: 'datos', label: 'Datos del comité' },
  { id: 'usuarios', label: 'Usuarios' },
  { id: 'cambios', label: 'Cambios de contraseña' },
] as const;

type TabId = (typeof ALL_TABS)[number]['id'];

/**
 * Configuración con pestañas: datos del comité (formulario + código para
 * compartir) y gestión de usuarios (roles).
 */
export function ConfigTabs({
  committee,
  code,
  users,
  roles,
  passwordChanges,
  canApprovePasswordChanges,
  usersError,
  canManage,
}: {
  committee: CommitteeRow;
  code: string | null;
  users: CommitteeUserRow[];
  roles: RoleOption[];
  passwordChanges: Array<{ id: UUID; userName: string | null; reason?: string; requestedAt: string }>;
  canApprovePasswordChanges: boolean;
  usersError: string | null;
  /** committee.manage: editar datos y gestionar usuarios. */
  canManage: boolean;
}) {
  // La tab "Usuarios" solo existe para administradores.
  const tabs = canManage ? ALL_TABS : ALL_TABS.filter((t) => t.id !== 'usuarios');
  const [active, setActive] = useState<TabId>('datos');

  // DEBUG
  if (active === 'cambios') {
    console.log('DEBUG: canApprovePasswordChanges =', canApprovePasswordChanges);
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Secciones de configuración"
        className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800"
      >
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              className={[
                'shrink-0 border-b-2 px-4 py-2 text-sm font-medium',
                isActive
                  ? 'border-brand text-brand'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {active === 'datos' ? (
        <div className="flex flex-col gap-6">
          <CommitteeCodeCard code={code} />
          <CommitteeConfigForm committee={committee} readOnly={!canManage} />
        </div>
      ) : null}

      {active === 'usuarios' && canManage ? (
        <UsersManager users={users} roles={roles} error={usersError} />
      ) : null}

      {active === 'cambios' ? (
        canApprovePasswordChanges ? (
          <PasswordChangeRequestsTable requests={passwordChanges} />
        ) : (
          <PasswordChangeRequestForm />
        )
      ) : null}
    </div>
  );
}
