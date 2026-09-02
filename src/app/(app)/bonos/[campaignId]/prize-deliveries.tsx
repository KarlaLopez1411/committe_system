'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { UUID } from '@/domain/types';
import type { PrizeDeliveryRow } from '@/server/bonus-ledger-service';
import { recordPrizeDeliveryAction } from '@/server/actions/bonus-actions';
import { todayIso } from '@/lib/date';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Entrega del premio de bono por mes.
 *
 * Muestra el histórico de entregas realizadas HASTA HOY y un botón "Agregar
 * entrega" que abre un modal (pop-up) con el formulario de registro (mes,
 * número ganador, fecha, responsable).
 */
export function PrizeDeliveries({
  campaignId,
  deliveries,
  canManage = false,
}: {
  campaignId: UUID;
  deliveries: PrizeDeliveryRow[];
  /** bonuses.draw/manage/committee.manage: registrar entregas de premio. */
  canManage?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentMonth = new Date().getMonth() + 1;
  const [month, setMonth] = useState(currentMonth);
  const [winning, setWinning] = useState('');
  const [date, setDate] = useState(todayIso());
  const [responsible, setResponsible] = useState('');

  // Solo entregas con fecha <= hoy.
  const today = todayIso();
  const upToToday = deliveries
    .filter((d) => d.deliveryDate <= today)
    .sort((a, b) => a.month - b.month);

  const delivered = new Set(deliveries.map((d) => d.month));

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await recordPrizeDeliveryAction(campaignId, {
        month,
        winningNumber: parseInt(winning, 10),
        deliveryDate: date,
        responsible: responsible.trim() || null,
      });
      if (!result.ok) { setError(result.error.message); return; }
      setWinning('');
      setResponsible('');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Entregas realizadas
        </h3>
        {canManage ? (
          <button
            type="button"
            onClick={() => { setError(null); setOpen(true); }}
            className="min-h-touch rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:opacity-90"
          >
            + Agregar entrega
          </button>
        ) : null}
      </div>

      {/* Histórico (hasta hoy) */}
      {upToToday.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Aún no hay entregas registradas.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left dark:border-gray-800">
                <th className="px-2 py-2 font-semibold">Mes</th>
                <th className="px-2 py-2 font-semibold">Número ganador</th>
                <th className="px-2 py-2 font-semibold">Fecha de entrega</th>
                <th className="px-2 py-2 font-semibold">Responsable</th>
              </tr>
            </thead>
            <tbody>
              {upToToday.map((d) => (
                <tr key={d.id} className="border-b border-gray-100 dark:border-gray-900">
                  <td className="px-2 py-2 font-medium">{MONTH_NAMES[d.month - 1]}</td>
                  <td className="px-2 py-2 font-semibold tabular-nums">{d.winningNumber}</td>
                  <td className="px-2 py-2 tabular-nums">{d.deliveryDate}</td>
                  <td className="px-2 py-2">{d.responsible ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de registro */}
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="prize-delivery-title"
            className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl dark:bg-gray-900 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 id="prize-delivery-title" className="text-lg font-semibold">Registrar entrega</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="rounded-lg px-2 py-1 text-xl leading-none text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium">
                Mes
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  disabled={isPending}
                  className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
                >
                  {MONTH_NAMES.map((label, i) => (
                    <option key={label} value={i + 1} disabled={delivered.has(i + 1)}>
                      {label}{delivered.has(i + 1) ? ' (entregado)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm font-medium">
                Número ganador
                <input
                  value={winning}
                  onChange={(e) => setWinning(e.target.value)}
                  type="number"
                  min={1}
                  required
                  placeholder="Ej. 47"
                  disabled={isPending}
                  className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-medium">
                Fecha de entrega
                <input
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  type="date"
                  required
                  disabled={isPending}
                  className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-medium">
                Responsable <span className="font-normal text-gray-400">(opcional)</span>
                <input
                  value={responsible}
                  onChange={(e) => setResponsible(e.target.value)}
                  maxLength={150}
                  placeholder="Quién entrega"
                  disabled={isPending}
                  className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
                />
              </label>

              {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}

              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="min-h-touch rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-60 dark:border-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending || winning.trim().length === 0}
                  className="min-h-touch rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:opacity-90 disabled:opacity-60"
                >
                  {isPending ? 'Guardando…' : 'Registrar entrega'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
