import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolvePagePerms } from '@/server/actions/page-perms';
import { CashClosingActions } from './cash-closing-actions';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  abierto: { label: 'Abierto', className: 'text-blue-600' },
  en_revision: { label: 'En revisión', className: 'text-yellow-600' },
  aprobado: { label: 'Aprobado', className: 'text-green-600' },
  cerrado: { label: 'Cerrado', className: 'text-gray-500' },
};

export default async function CortesPage() {
  const supabase = await createSupabaseServerClient();
  const perms = await resolvePagePerms();
  const { data: closings } = await supabase
    .from('cash_closings')
    .select('id, account_id, period, theoretical_balance, real_balance, difference, status')
    .order('period', { ascending: false })
    .limit(50);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Cortes mensuales</h1>
      {!closings?.length ? (
        <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700">
          No hay cortes registrados.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(closings as { id: string; period: string; theoretical_balance: string; real_balance: string | null; difference: string | null; status: string }[]).map((c) => {
            const meta = STATUS_LABELS[c.status];
            return (
              <li key={c.id} className="flex flex-col gap-2 rounded-2xl border border-gray-200 p-4 dark:border-gray-800 sm:flex-row sm:justify-between">
                <div>
                  <p className="font-semibold">{c.period}</p>
                  <p className="text-sm text-gray-500">Teórico: ${c.theoretical_balance} · Real: {c.real_balance ? `$${c.real_balance}` : '—'}</p>
                  <span className={`text-xs font-medium ${meta?.className ?? ''}`}>{meta?.label ?? c.status}</span>
                </div>
                <CashClosingActions
                  closingId={c.id}
                  status={c.status}
                  canReview={perms.canReviewCashClosing}
                  canApprove={perms.canApproveCashClosing}
                  canClose={perms.canCloseCashClosing}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
