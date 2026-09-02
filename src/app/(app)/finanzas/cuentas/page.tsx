import Link from 'next/link';

import { createSupabaseServerClient } from '@/lib/supabase/server';

import { AccountCreateForm } from './account-create-form';
import { AccountDeactivateButton } from './account-deactivate-button';

/**
 * Pantalla de cuentas financieras (design.md §18.2 #6; Requirements 9.1, 42.2).
 *
 * Server Component que lista las cuentas del comité activo consultando
 * `financial_accounts` con el cliente de servidor ligado a las cookies de
 * sesión, de modo que RLS restringe las filas al comité del usuario
 * (Requirements 2.2). Junto a la lista se presenta un formulario cliente de
 * alta (`AccountCreateForm`) y, por cada cuenta activa, una acción de
 * desactivación con confirmación explícita (`AccountDeactivateButton`, R9.3).
 */

export const dynamic = 'force-dynamic';

/** Etiquetas legibles de los tipos de cuenta (RF-030). */
const TYPE_LABELS: Record<string, string> = {
  caja_general: 'Caja general',
  cuenta_bancaria: 'Cuenta bancaria',
  caja_actividad: 'Caja de actividad',
  cuenta_digital: 'Cuenta digital',
  otra: 'Otra',
};

interface AccountRow {
  id: string;
  name: string;
  type: string;
  opening_balance: string | number | null;
  status: string;
}

function StatusBadge({ status }: { status: string }) {
  const active = status === 'active';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active
          ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
          : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      }`}
    >
      {active ? 'Activa' : 'Inactiva'}
    </span>
  );
}

export default async function AccountsPage() {
  const supabase = await createSupabaseServerClient();

  // RLS limita las filas al comité activo del usuario autenticado (R2.2).
  const { data, error } = await supabase
    .from('financial_accounts')
    .select('id, name, type, opening_balance, status')
    .order('name', { ascending: true });

  const accounts = (data ?? []) as AccountRow[];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">Cuentas</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Cajas y cuentas financieras del comité activo.
        </p>
        <Link
          href="/finanzas/categorias"
          className="w-fit text-sm font-medium text-brand hover:underline"
        >
          Gestionar categorias
        </Link>
        <div className="flex gap-3">
          <Link href="/finanzas/ingresos/nuevo" className="w-fit text-sm font-medium text-brand hover:underline">
            + Nuevo ingreso
          </Link>
          <Link href="/finanzas/egresos/nuevo" className="w-fit text-sm font-medium text-brand hover:underline">
            + Nuevo egreso
          </Link>
          <Link href="/finanzas/transferencias/nuevo" className="w-fit text-sm font-medium text-brand hover:underline">
            + Transferencia
          </Link>
          <Link href="/finanzas" className="w-fit text-sm font-medium text-brand hover:underline">
            Ver movimientos
          </Link>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Lista de cuentas */}
        <div className="flex flex-col gap-3">
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              No se pudieron cargar las cuentas: {error.message}
            </p>
          ) : accounts.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Aún no hay cuentas registradas. Usa el formulario para crear la
              primera.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex flex-col gap-2 rounded-2xl border border-gray-200 p-4 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-base font-semibold">
                      {account.name}
                    </span>
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      {TYPE_LABELS[account.type] ?? account.type}
                    </span>
                    <StatusBadge status={account.status} />
                  </div>
                  {account.status === 'active' ? (
                    <AccountDeactivateButton
                      accountId={account.id}
                      accountName={account.name}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Formulario de alta con validación inmediata */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <AccountCreateForm />
        </div>
      </div>
    </section>
  );
}
