'use client';

import { useState } from 'react';

import type { UUID } from '@/domain/types';
import { FabModal } from '@/components/ui/fab-modal';
import {
  ListIcon,
  WalletIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  TransferIcon,
  TagIcon,
} from '@/components/ui/icons';

import { TransactionList, ListPager, type TransactionRow } from './transaction-list';
import { AccountCreateForm } from './cuentas/account-create-form';
import { AccountDeactivateButton } from './cuentas/account-deactivate-button';
import { IncomeForm } from './ingresos/nuevo/income-form';
import { ExpenseForm } from './egresos/nuevo/expense-form';
import { TransferForm } from './transferencias/nuevo/transfer-form';
import { CategoryManager } from './categorias/category-manager';
import { CategoryCreateForm } from './categorias/category-create-form';

interface AccountRow {
  id: string; name: string; type: string; status: string;
  /** Saldo derivado (opening_balance + suma de apuntes). */
  balance: string;
}
interface CategoryRow { id: UUID; name: string; }
interface Option { id: UUID; name: string; }

const TYPE_LABELS: Record<string, string> = {
  caja_general: 'Caja general',
  cuenta_bancaria: 'Cuenta bancaria',
  caja_actividad: 'Caja de actividad',
  cuenta_digital: 'Cuenta digital',
  otra: 'Otra',
};

const TABS = [
  { id: 'movimientos', label: 'Movimientos', short: 'Movim.', Icon: ListIcon },
  { id: 'cuentas', label: 'Cuentas', short: 'Cuentas', Icon: WalletIcon },
  { id: 'ingresos', label: 'Ingresos', short: 'Ing.', Icon: ArrowDownIcon },
  { id: 'egresos', label: 'Egresos', short: 'Egr.', Icon: ArrowUpIcon },
  { id: 'transferencias', label: 'Transferencias', short: 'Transf.', Icon: TransferIcon },
  { id: 'categorias', label: 'Categorías', short: 'Categ.', Icon: TagIcon },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Finanzas con pestañas. Cada pestaña muestra su contenido y un botón flotante
 * (FAB) que abre el formulario correspondiente en un modal.
 */
export function FinanzasTabs({
  transactions,
  accounts,
  activeAccounts,
  categories,
  canManageCommittee,
  canCreateTransaction,
}: {
  transactions: TransactionRow[];
  accounts: AccountRow[];
  activeAccounts: Option[];
  categories: CategoryRow[];
  /** committee.manage: crear cuentas y categorías. */
  canManageCommittee: boolean;
  /** transactions.create: registrar ingresos, egresos y transferencias. */
  canCreateTransaction: boolean;
}) {
  const [active, setActive] = useState<TabId>('movimientos');
  const [accountsPage, setAccountsPage] = useState(1);
  const ACCOUNTS_PAGE_SIZE = 20;
  const accountsPageCount = Math.max(1, Math.ceil(accounts.length / ACCOUNTS_PAGE_SIZE));
  const accountsSafePage = Math.min(accountsPage, accountsPageCount);
  const accountsPageItems = accounts.slice(
    (accountsSafePage - 1) * ACCOUNTS_PAGE_SIZE,
    accountsSafePage * ACCOUNTS_PAGE_SIZE,
  );

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Secciones de finanzas" className="flex border-b border-gray-200 dark:border-gray-800">
        {TABS.map((t) => {
          const isActive = t.id === active;
          const { Icon } = t;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={t.label}
              onClick={() => setActive(t.id)}
              className={[
                'flex flex-1 min-w-0 flex-col items-center justify-center gap-1 border-b-2 px-1 py-2 text-xs font-medium',
                'sm:flex-row sm:gap-2 sm:px-4 sm:text-sm',
                isActive ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200',
              ].join(' ')}
            >
              <Icon width={18} height={18} className="shrink-0" aria-hidden />
              {/* Abreviatura en móvil, nombre completo en escritorio */}
              <span className="truncate sm:hidden">{t.short}</span>
              <span className="hidden truncate sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Movimientos */}
      {active === 'movimientos' ? (
        <TransactionList transactions={transactions} />
      ) : null}

      {/* Cuentas */}
      {active === 'cuentas' ? (
        accounts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Aún no hay cuentas. Usa el botón + para crear la primera.
          </p>
        ) : (
          <>
          <ul className="flex flex-col gap-2">
            {accountsPageItems.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 rounded-2xl border border-gray-200 p-4 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-base font-semibold">{a.name}</span>
                  <span className="text-sm text-gray-600 dark:text-gray-300">{TYPE_LABELS[a.type] ?? a.type}</span>
                  <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${a.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                    {a.status === 'active' ? 'Activa' : 'Inactiva'}
                  </span>
                </div>
                <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                  <span className="text-lg font-bold tabular-nums">${a.balance}</span>
                  {a.status === 'active' ? <AccountDeactivateButton accountId={a.id} accountName={a.name} /> : null}
                </div>
              </li>
            ))}
          </ul>
          <ListPager page={accountsSafePage} pageCount={accountsPageCount} onPage={setAccountsPage} />
          </>
        )
      ) : null}

      {/* Ingresos (lista = movimientos tipo income) */}
      {active === 'ingresos' ? (
        <TransactionList transactions={transactions.filter((t) => t.type === 'income')} showStatusFilter />
      ) : null}

      {/* Egresos */}
      {active === 'egresos' ? (
        <TransactionList transactions={transactions.filter((t) => t.type === 'expense')} showStatusFilter />
      ) : null}

      {/* Categorías (lista con editar/eliminar; el alta va por el FAB) */}
      {active === 'categorias' ? (
        <CategoryManager categories={categories} showCreateForm={false} />
      ) : null}

      {/* Transferencias */}
      {active === 'transferencias' ? (
        <TransactionList transactions={transactions.filter((t) => t.type === 'transfer')} />
      ) : null}

      {/* ── FAB por pestaña ──────────────────────────────────────────────── */}
      {active === 'cuentas' && canManageCommittee ? (
        <FabModal label="Crear cuenta" title="Crear cuenta">
          {(close) => <AccountCreateForm onDone={close} />}
        </FabModal>
      ) : null}

      {active === 'categorias' && canManageCommittee ? (
        <FabModal label="Agregar categoría" title="Nueva categoría">
          {(close) => <CategoryCreateForm onDone={close} />}
        </FabModal>
      ) : null}

      {(active === 'ingresos' || active === 'movimientos') && canCreateTransaction ? (
        <FabModal label="Registrar ingreso" title="Nuevo ingreso">
          {(close) =>
            activeAccounts.length === 0 ? (
              <p className="text-sm text-gray-500">No hay cuentas activas. Crea una cuenta primero.</p>
            ) : (
              <IncomeForm accounts={activeAccounts} categories={categories} onDone={close} />
            )
          }
        </FabModal>
      ) : null}

      {active === 'egresos' && canCreateTransaction ? (
        <FabModal label="Registrar egreso" title="Nuevo egreso">
          {(close) =>
            activeAccounts.length === 0 ? (
              <p className="text-sm text-gray-500">No hay cuentas activas. Crea una cuenta primero.</p>
            ) : categories.length === 0 ? (
              <p className="text-sm text-gray-500">No hay categorías. Crea una categoría primero.</p>
            ) : (
              <ExpenseForm accounts={activeAccounts} categories={categories} onDone={close} />
            )
          }
        </FabModal>
      ) : null}

      {active === 'transferencias' && canCreateTransaction ? (
        <FabModal label="Nueva transferencia" title="Nueva transferencia">
          {(close) =>
            activeAccounts.length < 2 ? (
              <p className="text-sm text-gray-500">Se necesitan al menos dos cuentas activas para transferir.</p>
            ) : (
              <TransferForm accounts={activeAccounts} onDone={close} />
            )
          }
        </FabModal>
      ) : null}
    </div>
  );
}
