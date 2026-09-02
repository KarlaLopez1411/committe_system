import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { createDashboardService } from '@/server/dashboard-service';

export const dynamic = 'force-dynamic';

function IndicatorCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-gray-400 dark:text-gray-500">{sub}</p> : null}
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">Panel</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">Bienvenido a SAC. Inicia sesión para continuar.</p>
      </section>
    );
  }

  const { data: cu } = await supabase.from('committee_users').select('committee_id').eq('user_id', user.id).eq('status', 'active').single();

  if (!cu) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">Panel</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">No perteneces a ningún comité activo.</p>
      </section>
    );
  }

  const ctx = { userId: user.id, committeeId: (cu as { committee_id: string }).committee_id, permissions: [], isSuperAdmin: false };
  const indicators = await createDashboardService({ client: createSupabaseAdminClient() }).getIndicators(ctx);

  if (!indicators.ok) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">Panel</h1>
        <p role="alert" className="text-sm text-red-600">No se pudieron cargar los indicadores.</p>
      </section>
    );
  }

  const d = indicators.value;
  const netPositive = !d.monthNetResult.startsWith('-');

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Panel</h1>

      {/* Financial summary */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Finanzas</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <IndicatorCard label="Saldo consolidado" value={`$${d.consolidatedBalance}`} />
          <IndicatorCard label="Ingresos del mes" value={`$${d.monthIncomeTotal}`} />
          <IndicatorCard label="Egresos del mes" value={`$${d.monthExpenseTotal}`} />
          <IndicatorCard
            label="Resultado del mes"
            value={`${netPositive ? '+' : ''}$${d.monthNetResult}`}
            sub={netPositive ? 'Superávit' : 'Déficit'}
          />
          <IndicatorCard label="Miembros activos" value={String(d.activeMembersCount)} />
        </div>
      </div>

      {/* Per-account balances */}
      {d.accountBalances.length > 0 ? (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Cuentas</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {d.accountBalances.map((a) => (
              <IndicatorCard key={a.accountId} label={a.name} value={`$${a.balance}`} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Bonus metrics */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Bonos</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <IndicatorCard label="Cobrado por vendedores" value={`$${d.bonusCollectedAmount}`} />
          <IndicatorCard label="Entregado a tesorería" value={`$${d.bonusDeliveredAmount}`} />
          <IndicatorCard label="Pendiente de entregar" value={`$${d.bonusPendingDeliverAmount}`} />
        </div>
      </div>
    </section>
  );
}
