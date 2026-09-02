import Link from 'next/link';

import { createSupabaseServerClient } from '@/lib/supabase/server';

import { TransferForm } from './transfer-form';

export const dynamic = 'force-dynamic';

export default async function NuevaTransferenciaPage() {
  const supabase = await createSupabaseServerClient();
  const { data: accounts } = await supabase
    .from('financial_accounts')
    .select('id, name')
    .eq('status', 'active')
    .order('name');

  return (
    <section className="flex max-w-lg flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link href="/finanzas/cuentas" className="text-sm text-brand hover:underline">
          ← Cuentas
        </Link>
      </header>
      {!accounts || accounts.length < 2 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-gray-700">
          Se necesitan al menos dos cuentas activas para realizar una transferencia.
        </p>
      ) : (
        <TransferForm accounts={accounts} />
      )}
    </section>
  );
}
