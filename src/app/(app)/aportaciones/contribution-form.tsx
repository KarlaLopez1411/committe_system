'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { UUID } from '@/domain/types';
import { registerContributionsBatchAction } from '@/server/actions/community-actions';
import { currentMonthValue, periodFirstOfMonth, todayIso } from '@/lib/date';

export interface MemberOption {
  id: UUID;
  full_name: string;
  monthly_commitment: boolean;
  monthly_amount: string | number | null;
}

/** Monto por defecto por persona. */
const DEFAULT_AMOUNT = '100';

/**
 * Registro de aportaciones voluntarias por miembro.
 *
 * Permite seleccionar varios miembros (lista con casillas) y registrar la
 * aportación del periodo para todos a la vez, con un monto por persona (por
 * defecto $100). Genera un solo ingreso a caja por el total.
 */
export function ContributionForm({ members, onDone }: { members: MemberOption[]; onDone?: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  // El periodo es mes/año (YYYY-MM); al enviar se normaliza a YYYY-MM-01.
  const [period, setPeriod] = useState(currentMonthValue());
  const [date, setDate] = useState(todayIso());

  const committed = useMemo(() => members.filter((m) => m.monthly_commitment), [members]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(members.map((m) => m.id))); }
  function selectCommitted() { setSelected(new Set(committed.map((m) => m.id))); }
  function clearAll() { setSelected(new Set()); }

  const total = (Number(amount || 0) * selected.size).toFixed(2);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null); setSuccess(null);
    startTransition(async () => {
      const result = await registerContributionsBatchAction({
        memberIds: Array.from(selected) as UUID[],
        period: periodFirstOfMonth(period),
        contributedAt: date,
        amountPerMember: amount,
      });
      if (!result.ok) { setError(result.error.message); return; }
      setSuccess(`Registradas ${result.value.count} aportación(es) · Total $${result.value.total}.`);
      setSelected(new Set());
      router.refresh();
      onDone?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <h2 className="text-lg font-semibold">Registrar aportaciones</h2>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Monto por persona
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number" min="0.01" step="0.01"
            disabled={isPending}
            className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Periodo (mes)
          <input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            type="month" required disabled={isPending}
            className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Fecha
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            type="date" required disabled={isPending}
            className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
      </div>

      {/* Atajos de selección */}
      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" onClick={selectAll} disabled={isPending} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800">Todos</button>
        <button type="button" onClick={selectCommitted} disabled={isPending || committed.length === 0} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800">Solo comprometidos ({committed.length})</button>
        <button type="button" onClick={clearAll} disabled={isPending} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800">Limpiar</button>
      </div>

      {/* Lista de miembros con casillas */}
      {members.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No hay miembros activos. Agrega miembros primero.</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-gray-800">
          {members.map((m) => (
            <li key={m.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-gray-900">
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggle(m.id)}
                  disabled={isPending}
                  className="h-4 w-4"
                />
                <span className="flex-1">{m.full_name}</span>
                {m.monthly_commitment ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
                    Comprometido ${String(m.monthly_amount ?? DEFAULT_AMOUNT)}
                  </span>
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-gray-600 dark:text-gray-300">
        {selected.size} seleccionado(s) · Total <span className="font-semibold">${total}</span>
      </p>

      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {success ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{success}</p> : null}

      <button
        type="submit"
        disabled={isPending || selected.size === 0}
        className="min-h-touch w-fit rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:opacity-60"
      >
        {isPending ? 'Guardando…' : `Registrar aportación (${selected.size})`}
      </button>
    </form>
  );
}
