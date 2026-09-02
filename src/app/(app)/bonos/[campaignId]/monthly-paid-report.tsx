import type { MonthlyCutRow } from '@/server/bonus-ledger-service';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Corte mensual de bonos por campaña: por cada mes, cuántos números están
 * pagados vs pendientes y su monto. Server component de solo lectura.
 */
export function MonthlyPaidReport({ rows }: { rows: MonthlyCutRow[] }) {
  const hasAny = rows.some((r) => r.paidCount > 0 || r.prizeDelivered);

  if (!hasAny) {
    return (
      <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Aún no se han registrado pagos mensuales.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left dark:border-gray-800">
            <th className="px-2 py-2 font-semibold">Mes</th>
            <th className="px-2 py-2 font-semibold">Pagados</th>
            <th className="px-2 py-2 font-semibold">Pendientes</th>
            <th className="px-2 py-2 font-semibold">Cobrado</th>
            <th className="px-2 py-2 font-semibold">Pendiente</th>
            <th className="px-2 py-2 font-semibold">Premio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month} className="border-b border-gray-100 dark:border-gray-900">
              <td className="px-2 py-2 font-medium">{MONTH_NAMES[r.month - 1]}</td>
              <td className="px-2 py-2 tabular-nums">{r.paidCount}</td>
              <td className="px-2 py-2 tabular-nums text-gray-500">{r.pendingCount}</td>
              <td className="px-2 py-2 font-semibold tabular-nums text-green-700 dark:text-green-400">${r.paidAmount}</td>
              <td className="px-2 py-2 tabular-nums text-gray-500">${r.pendingAmount}</td>
              <td className="px-2 py-2">
                {r.prizeDelivered ? (
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
                    Pagado ${r.prizeAmount}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                    Pendiente ${r.prizeAmount}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
