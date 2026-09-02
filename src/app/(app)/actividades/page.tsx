

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolvePagePerms } from '@/server/actions/page-perms';
import { ActivityForm } from './activity-form';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<string, string> = { planeada: 'Planeada', activa: 'Activa', finalizada: 'Finalizada', cerrada: 'Cerrada' };

export default async function ActividadesPage() {
  const supabase = await createSupabaseServerClient();
  const perms = await resolvePagePerms();
  const { data } = await supabase.from('activities').select('id, name, start_date, end_date, status').order('start_date', { ascending: false }).limit(50);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Actividades</h1>
      <div className={perms.canCreateActivity ? 'grid gap-6 lg:grid-cols-[1fr_360px]' : 'flex flex-col gap-6'}>
        <ul className="flex flex-col gap-2">
          {(data ?? []).map((a) => {
            const row = a as { id: string; name: string; start_date: string; end_date: string; status: string };
            return (
              <li key={row.id} className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
                <p className="font-semibold">{row.name}</p>
                <p className="text-sm text-gray-500">{row.start_date} – {row.end_date}</p>
                <span className="text-xs font-medium text-brand">{STATUS_LABELS[row.status] ?? row.status}</span>
              </li>
            );
          })}
        </ul>
        {perms.canCreateActivity ? <ActivityForm /> : null}
      </div>
    </section>
  );
}
