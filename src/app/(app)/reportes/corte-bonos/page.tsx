import Link from 'next/link';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createReportService } from '@/server/report-service';

export const dynamic = 'force-dynamic';

function currentPeriod() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

export default async function CorteBonos({ searchParams }: { searchParams: Promise<{ campaignId?: string; period?: string }> }) {
  const params = await searchParams;
  const period = params.period ?? currentPeriod();

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <p className="p-4 text-sm text-red-600">Sesión no válida.</p>;

  const { data: cu } = await supabase.from('committee_users').select('committee_id').eq('user_id', user.id).eq('status', 'active').single();
  if (!cu) return <p className="p-4 text-sm text-red-600">No perteneces a ningún comité activo.</p>;

  const ctx = { userId: user.id, committeeId: (cu as { committee_id: string }).committee_id, permissions: ['reports.read', 'committee.manage'], isSuperAdmin: false };
  const admin = createSupabaseAdminClient();

  // Load campaigns for the selector
  const { data: campaigns } = await admin.from('bonus_campaigns').select('id, name, year').eq('committee_id', ctx.committeeId).order('year', { ascending: false });

  const campaignId = params.campaignId ?? (campaigns?.[0] as { id: string } | undefined)?.id;

  const service = createReportService({ client: admin });
  const result = campaignId ? await service.bonusMonthlyCut(ctx, campaignId, period) : null;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/reportes" className="text-sm text-brand hover:underline">← Reportes</Link>
          <h1 className="mt-1 text-xl font-bold">Corte mensual de bonos</h1>
        </div>
      </header>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-3">
        <select name="campaignId" defaultValue={campaignId ?? ''}
          className="min-h-touch rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
          {(campaigns ?? []).map((c) => {
            const row = c as { id: string; name: string; year: number };
            return <option key={row.id} value={row.id}>{row.name} ({row.year})</option>;
          })}
        </select>
        <input name="period" type="month" defaultValue={period.slice(0, 7)}
          className="min-h-touch rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        <button type="submit" className="min-h-touch rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:opacity-90">
          Generar
        </button>
        {result?.ok ? (
          <a href={`/api/reportes/export?campaignId=${campaignId}&period=${period}`}
            className="min-h-touch flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            ↓ CSV
          </a>
        ) : null}
      </form>

      {!campaignId ? (
        <p className="text-sm text-gray-500">No hay campañas registradas. Crea una desde la sección de bonos.</p>
      ) : !result ? null : !result.ok ? (
        <p role="alert" className="text-sm text-red-600">{result.error.message}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Esperado" value={`$${result.value.expectedAmount}`} />
          <StatCard label="Cobrado" value={`$${result.value.collectedAmount}`} />
          <StatCard label="Pendiente de cobrar" value={`$${result.value.pendingCollect}`} />
          <StatCard label="Entregado" value={`$${result.value.deliveredAmount}`} />
          <StatCard label="En poder de vendedores" value={`$${result.value.withVendorsAmount}`} />
          <StatCard label="Premio del periodo" value={`$${result.value.prizeAmount}`} />
          <StatCard label="Premio pagado" value={`$${result.value.paidPrize}`} />
          <StatCard label="Premio pendiente" value={`$${result.value.pendingPrize}`} />
        </div>
      )}
    </section>
  );
}
