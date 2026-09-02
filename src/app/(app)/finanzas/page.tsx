import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolvePagePerms } from '@/server/actions/page-perms';

import { FinanzasTabs } from './finanzas-tabs';
import type { TransactionRow } from './transaction-list';

export const dynamic = 'force-dynamic';

export default async function FinanzasPage() {
  const supabase = await createSupabaseServerClient();
  const perms = await resolvePagePerms();

  const [txRes, balancesRes, categoriesRes] = await Promise.all([
    supabase
      .from('financial_transactions')
      .select('id, type, status, transaction_date, description, approved_by, created_at, category_id, ledger_entries(amount)')
      .order('created_at', { ascending: false })
      .limit(200),
    // Saldo derivado por cuenta (opening_balance + suma de apuntes del ledger).
    supabase
      .from('account_derived_balances')
      .select('account_id, name, type, status, derived_balance')
      .order('name', { ascending: true }),
    supabase
      .from('transaction_categories')
      .select('id, name')
      .order('name', { ascending: true }),
  ]);

  const rawTx = (txRes.data ?? []) as {
    id: string; type: string; status: string; transaction_date: string;
    description: string | null; approved_by: string | null; category_id: string | null;
    ledger_entries: { amount: string | number }[] | null;
  }[];

  // Mapa id→nombre de categoría (para etiquetar y filtrar transacciones).
  const categoryNameById = new Map<string, string>(
    ((categoriesRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );

  // Resuelve el nombre de quien aprobó cada transacción (approved_by → profiles).
  const approverIds = Array.from(
    new Set(rawTx.map((t) => t.approved_by).filter((v): v is string => Boolean(v))),
  );
  const approverNameById = new Map<string, string>();
  if (approverIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', approverIds);
    for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) approverNameById.set(p.id, p.full_name);
    }
  }

  // Monto por transacción: derivado de sus apuntes de ledger.
  // income → suma de créditos; expense → |débitos|; transfer → monto movido.
  const transactions: TransactionRow[] = rawTx.map((t) => {
    let credits = 0;
    let debits = 0;
    for (const e of t.ledger_entries ?? []) {
      const n = Number(e.amount);
      if (n >= 0) credits += n; else debits += -n;
    }
    const amount = Math.max(credits, debits).toFixed(2);
    return {
      id: t.id, type: t.type, status: t.status,
      transaction_date: t.transaction_date, description: t.description, amount,
      approvedByName: t.approved_by ? (approverNameById.get(t.approved_by) ?? 'Usuario') : null,
      categoryId: t.category_id,
      categoryName: t.category_id ? (categoryNameById.get(t.category_id) ?? null) : null,
    };
  });

  const accounts = ((balancesRes.data ?? []) as {
    account_id: string; name: string; type: string; status: string; derived_balance: string | number | null;
  }[]).map((a) => ({
    id: a.account_id, name: a.name, type: a.type, status: a.status,
    balance: String(a.derived_balance ?? '0.00'),
  }));

  const categories = (categoriesRes.data ?? []) as { id: string; name: string }[];
  const activeAccounts = accounts
    .filter((a) => a.status === 'active')
    .map((a) => ({ id: a.id, name: a.name }));

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Finanzas</h1>
      <FinanzasTabs
        transactions={transactions}
        accounts={accounts}
        activeAccounts={activeAccounts}
        categories={categories}
        canManageCommittee={perms.canManageCommittee}
        canCreateTransaction={perms.canCreateTransaction}
      />
    </section>
  );
}
