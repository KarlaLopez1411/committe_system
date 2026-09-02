import Link from 'next/link';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolvePagePerms } from '@/server/actions/page-perms';
import { NewCampaignFab } from './new-campaign-fab';

export const dynamic = 'force-dynamic';

export default async function BonosPage() {
  const supabase = await createSupabaseServerClient();
  const perms = await resolvePagePerms();
  const { data: campaigns } = await supabase
    .from('bonus_campaigns')
    .select('id, name, year, number_start, number_end, monthly_amount, monthly_prize, status')
    .order('year', { ascending: false });

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Bonos — Campañas</h1>

      <ul className="flex flex-col gap-2">
        {(campaigns ?? []).length === 0 ? (
          <li className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {perms.canManageCommittee
              ? 'Aún no hay campañas. Usa el botón + para crear la primera.'
              : 'Aún no hay campañas.'}
          </li>
        ) : null}
        {(campaigns ?? []).map((c) => {
          const row = c as {
            id: string; name: string; year: number;
            number_start: number; number_end: number;
            monthly_amount: string | number; monthly_prize: string | number; status: string;
          };
          return (
            <li key={row.id}>
              <Link
                href={`/bonos/${row.id}`}
                className="flex justify-between rounded-2xl border border-gray-200 p-4 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                <div>
                  <p className="font-semibold">{row.name} ({row.year})</p>
                  <p className="text-sm text-gray-500">
                    Números {row.number_start}–{row.number_end} · Aportación ${row.monthly_amount} · Premio ${row.monthly_prize}
                  </p>
                </div>
                <span className="text-xs font-medium text-brand">{row.status}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {perms.canManageCommittee ? <NewCampaignFab /> : null}
    </section>
  );
}
