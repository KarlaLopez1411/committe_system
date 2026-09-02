'use client';

import { useState } from 'react';

import type { UUID } from '@/domain/types';
import type { CommitteeUserRow, RoleOption } from '@/server/role-service';

import { CommitteeConfigForm } from './committee-config-form';
import { CommitteeCodeCard } from './committee-code-card';
import { UsersManager } from './users-manager';

interface CommitteeRow {
  id: UUID;
  name: string;
  locality: string | null;
  phone: string | null;
  email: string | null;
}

const TABS = [
  { id: 'datos', label: 'Datos del comité' },
  { id: 'usuarios', label: 'Usuarios' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Configuración con pestañas: datos del comité (formulario + código para
 * compartir) y gestión de usuarios (roles).
 */
export function ConfigTabs({
  committee,
  code,
  users,
  roles,
  usersError,
}: {
  committee: CommitteeRow;
  code: string | null;
  users: CommitteeUserRow[];
  roles: RoleOption[];
  usersError: string | null;
}) {
  const [active, setActive] = useState<TabId>('datos');

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Secciones de configuración"
        className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800"
      >
        {TABS.map((t) => {
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
          <CommitteeConfigForm committee={committee} />
        </div>
      ) : null}

      {active === 'usuarios' ? (
        <UsersManager users={users} roles={roles} error={usersError} />
      ) : null}
    </div>
  );
}
