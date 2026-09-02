'use client';

import { useState } from 'react';

import { FabModal } from '@/components/ui/fab-modal';

import { MemberRegisterForm } from './member-register-form';
import { ContributionForm, type MemberOption } from '../aportaciones/contribution-form';
import { ContributionPeriods, type ContributionPeriod } from './contribution-periods';
import { MemberActions } from './member-actions';

export type { ContributionPeriod };

export interface MemberRow {
  id: string;
  full_name: string;
  phone: string | null;
  position: string | null;
  status: string;
  joined_at: string | null;
  notes: string | null;
  monthly_commitment?: boolean;
  monthly_amount?: string | number | null;
}

export interface ContributionRow {
  id: string;
  member_name: string;
  period: string;
  status: string;
  amount: string | null;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  activo: { label: 'Activo', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  inactivo: { label: 'Inactivo', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  baja: { label: 'Baja', className: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
};

const PAGE_SIZE = 10;

const TABS = [
  { id: 'miembros', label: 'Miembros' },
  { id: 'aportaciones', label: 'Aportaciones' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Controles de paginación reutilizables. */
function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="min-h-touch rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        Anterior
      </button>
      <span className="text-sm text-gray-500">Página {page} de {pageCount}</span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount}
        className="min-h-touch rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        Siguiente
      </button>
    </div>
  );
}

/**
 * Miembros + Aportaciones con pestañas. Cada pestaña pagina su lista y ofrece
 * un botón flotante (FAB) que abre el formulario correspondiente en un modal.
 */
export function MiembrosTabs({
  members,
  contributionPeriods,
  memberOptions,
  canCreateMember,
  canCreateContribution,
  canUpdateMember,
}: {
  members: MemberRow[];
  contributionPeriods: ContributionPeriod[];
  memberOptions: MemberOption[];
  /** members.create: dar de alta miembros. */
  canCreateMember: boolean;
  /** transactions.create: registrar aportaciones. */
  canCreateContribution: boolean;
  /** members.update: editar, cambiar estado y eliminar miembros. */
  canUpdateMember: boolean;
}) {
  const [active, setActive] = useState<TabId>('miembros');
  const [memberPage, setMemberPage] = useState(1);

  const memberPageCount = Math.max(1, Math.ceil(members.length / PAGE_SIZE));
  const membersPageItems = members.slice((memberPage - 1) * PAGE_SIZE, memberPage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Secciones de miembros" className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
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
                isActive ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Miembros */}
      {active === 'miembros' ? (
        members.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Aún no hay miembros. Usa el botón + para agregar el primero.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {membersPageItems.map((m) => {
                const meta = STATUS_META[m.status] ?? { label: m.status, className: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' };
                return (
                  <li key={m.id} className="flex flex-col gap-2 rounded-2xl border border-gray-200 p-4 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-base font-semibold">{m.full_name}</span>
                      <div className="mt-1 flex flex-col gap-0.5 text-sm text-gray-500 dark:text-gray-400">
                        <span>Cargo: {m.position?.trim() ? m.position : '—'}</span>
                        <span>Tel: {m.phone?.trim() ? m.phone : '—'}</span>
                        {m.joined_at ? <span>Incorporación: {m.joined_at}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>
                        {m.monthly_commitment ? (
                          <span className="inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                            Comprometido ${String(m.monthly_amount ?? '100')}
                          </span>
                        ) : null}
                      </div>
                      {canUpdateMember ? <MemberActions member={m} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pager page={memberPage} pageCount={memberPageCount} onPage={setMemberPage} />
          </>
        )
      ) : null}

      {/* Aportaciones: seguimiento colapsable por periodo (mes/año) */}
      {active === 'aportaciones' ? (
        <ContributionPeriods periods={contributionPeriods} />
      ) : null}

      {/* FAB por pestaña (solo si el usuario tiene el permiso correspondiente) */}
      {active === 'miembros' && canCreateMember ? (
        <FabModal label="Agregar miembro" title="Registrar miembro">
          {(close) => <MemberRegisterForm onDone={close} />}
        </FabModal>
      ) : null}
      {active === 'aportaciones' && canCreateContribution ? (
        <FabModal label="Registrar aportación" title="Registrar aportaciones">
          {(close) =>
            memberOptions.length === 0 ? (
              <p className="text-sm text-gray-500">No hay miembros activos. Agrega miembros primero.</p>
            ) : (
              <ContributionForm members={memberOptions} onDone={close} />
            )
          }
        </FabModal>
      ) : null}
    </div>
  );
}
