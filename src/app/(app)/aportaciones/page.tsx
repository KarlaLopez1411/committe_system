import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ContributionForm, type MemberOption } from './contribution-form';

export const dynamic = 'force-dynamic';

interface ContributionRow {
  id: string; member_id: string; period: string;
  contributed_at: string; status: string; amount: string | null;
}

export default async function AportacionesPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: contributions }, { data: members }] = await Promise.all([
    supabase.from('contributions').select('id, member_id, period, contributed_at, status, amount').order('contributed_at', { ascending: false }).limit(100),
    supabase.from('members').select('id, full_name, monthly_commitment, monthly_amount').eq('status', 'activo').order('full_name'),
  ]);

  const memberById = new Map((members ?? []).map((m) => [m.id as string, m.full_name as string]));

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Aportaciones</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Historial</h2>
          {(contributions ?? []).length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Aún no hay aportaciones registradas.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(contributions ?? []).map((c) => {
                const row = c as ContributionRow;
                return (
                  <li key={row.id} className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
                    <p className="font-medium">{memberById.get(row.member_id) ?? 'Miembro'}</p>
                    <p className="text-sm text-gray-500">
                      {row.period} · {row.status}{row.amount ? ` · $${row.amount}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <ContributionForm members={(members ?? []) as MemberOption[]} />
      </div>
    </section>
  );
}
