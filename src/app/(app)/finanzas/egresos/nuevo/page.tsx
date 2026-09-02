import Link from 'next/link';

import { createSupabaseServerClient } from '@/lib/supabase/server';

import { ExpenseForm } from './expense-form';

export const dynamic = 'force-dynamic';

export default async function NuevoEgresoPage() {
  const supabase = await createSupabaseServerClient();

  const [{ data: accounts }, { data: categories }] = await Promise.all([
    supabase.from('financial_accounts').select('id, name').eq('status', 'active').order('name'),
    supabase.from('transaction_categories').select('id, name').order('name'),
  ]);

  return (
    <section className="flex max-w-lg flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link href="/finanzas/cuentas" className="text-sm text-brand hover:underline">
          ← Cuentas
        </Link>
      </header>
      {!accounts?.length ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-gray-700">
          No hay cuentas activas. Crea una cuenta antes de registrar un egreso.
        </p>
      ) : !categories?.length ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-gray-700">
          No hay categorías disponibles. Crea al menos una categoría antes de registrar un egreso.
        </p>
      ) : (
        <ExpenseForm accounts={accounts} categories={categories} />
      )}
    </section>
  );
}
