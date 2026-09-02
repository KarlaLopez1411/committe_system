'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { UUID } from '@/domain/types';
import type { LedgerRow } from '@/server/bonus-ledger-service';
import {
  assignHolderAction,
  setMonthPaidAction,
} from '@/server/actions/bonus-actions';
import { CheckIcon } from '@/components/ui/icons';

/** Iniciales de los meses para los encabezados compactos. */
const MONTH_INITIALS = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

interface SellerOption { id: UUID; displayName: string; }

/**
 * Tabla del libro de la campaña con control de pago por mes.
 *
 * Columnas: Número · Beneficiario (editable, autoguardado) · Responsable
 * (solo lectura) · 12 casillas de mes (E–D) que marcan/desmarcan el pago.
 * Todo se persiste en `bonus_number_ledger` (una fila por número, `pagos` JSON).
 *
 * Filtros: por responsable y por "no pagado" en un mes concreto.
 */
export function CampaignNumbersTable({
  rows,
  sellers,
  canEditBeneficiary = false,
  canTogglePaid = false,
}: {
  rows: LedgerRow[];
  sellers: SellerOption[];
  /** bonuses.manage/committee.manage: editar beneficiario. */
  canEditBeneficiary?: boolean;
  /** bonuses.collect/manage/committee.manage: marcar pagos por mes. */
  canTogglePaid?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [beneficiaryDraft, setBeneficiaryDraft] = useState<Record<string, string>>({});

  // Filtros
  const [sellerFilter, setSellerFilter] = useState<string>('all'); // 'all' | 'none' | sellerId
  const [unpaidMonth, setUnpaidMonth] = useState<string>('all'); // 'all' | '1'..'12'

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) { setError(result.error?.message ?? 'Ocurrió un error.'); return; }
      router.refresh();
    });
  }

  function saveBeneficiary(row: LedgerRow) {
    const draft = beneficiaryDraft[row.bonusNumberId];
    if (draft === undefined) return;
    const value = draft.trim();
    const current = (row.beneficiary ?? '').trim();
    if (value.length === 0 || value === current) return;
    run(() => assignHolderAction(row.bonusNumberId, value));
  }

  function toggleMonth(row: LedgerRow, month: number) {
    const paid = Boolean(row.pagos[String(month)]);
    run(() => setMonthPaidAction(row.bonusNumberId, month, !paid));
  }

  // Aplica filtros: responsable + no pagado en el mes seleccionado.
  const visibleRows = rows.filter((row) => {
    if (sellerFilter === 'none' && row.sellerId) return false;
    if (sellerFilter !== 'all' && sellerFilter !== 'none' && row.sellerId !== sellerFilter) return false;
    if (unpaidMonth !== 'all' && Boolean(row.pagos[unpaidMonth])) return false;
    return true;
  });

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Esta campaña aún no tiene números.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600 dark:text-gray-300">Responsable</span>
          <select
            value={sellerFilter}
            onChange={(e) => setSellerFilter(e.target.value)}
            className="min-h-touch rounded-lg border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="all">Todos</option>
            <option value="none">Sin responsable</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>{s.displayName}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-600 dark:text-gray-300">No pagado en</span>
          <select
            value={unpaidMonth}
            onChange={(e) => setUnpaidMonth(e.target.value)}
            className="min-h-touch rounded-lg border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="all">Cualquier mes</option>
            {MONTH_NAMES.map((name, i) => (
              <option key={i} value={String(i + 1)}>{name}</option>
            ))}
          </select>
        </label>

        <span className="pb-1 text-sm text-gray-500 dark:text-gray-400">
          {visibleRows.length} de {rows.length} número(s)
        </span>
      </div>

      {visibleRows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Ningún número coincide con los filtros.
        </p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left dark:border-gray-800">
              <th className="px-2 py-2 font-semibold">Núm.</th>
              <th className="px-2 py-2 font-semibold">Beneficiario</th>
              <th className="px-2 py-2 font-semibold">Responsable</th>
              {MONTH_INITIALS.map((mi, i) => (
                <th key={i} className="px-1 py-2 text-center font-semibold" title={MONTH_NAMES[i]}>{mi}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.bonusNumberId} className="border-b border-gray-100 dark:border-gray-900">
                <td className="px-2 py-2 font-medium tabular-nums">{row.number}</td>

                <td className="px-2 py-2">
                  {canEditBeneficiary ? (
                    <input
                      defaultValue={row.beneficiary ?? ''}
                      onChange={(e) => setBeneficiaryDraft((d) => ({ ...d, [row.bonusNumberId]: e.target.value }))}
                      onBlur={() => saveBeneficiary(row)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                      placeholder="Sin asignar"
                      disabled={isPending}
                      className="min-h-touch w-full max-w-[180px] rounded-lg border border-gray-300 bg-white px-2 py-1 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
                    />
                  ) : (
                    <span className={row.beneficiary ? '' : 'text-gray-400'}>
                      {row.beneficiary ?? 'Sin asignar'}
                    </span>
                  )}
                </td>

                <td className="px-2 py-2">
                  <span className={row.sellerName ? '' : 'text-gray-400'}>
                    {row.sellerName ?? 'Sin responsable'}
                  </span>
                </td>

                {/* 12 casillas de mes */}
                {MONTH_INITIALS.map((_, i) => {
                  const month = i + 1;
                  const paid = Boolean(row.pagos[String(month)]);
                  return (
                    <td key={month} className="px-1 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => toggleMonth(row, month)}
                        disabled={isPending || !canTogglePaid}
                        aria-pressed={paid}
                        aria-label={`${MONTH_NAMES[i]}: ${paid ? 'pagado' : 'pendiente'}`}
                        title={`${MONTH_NAMES[i]} — ${paid ? 'pagado' : 'pendiente'}`}
                        className={[
                          'inline-flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-60',
                          paid
                            ? 'border-green-500 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                            : 'border-gray-300 text-transparent hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800',
                        ].join(' ')}
                      >
                        {paid ? <CheckIcon width={14} height={14} /> : <span className="sr-only">pendiente</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Cada casilla (E–D) marca el pago de ese mes para el número. Verde = pagado.
        El responsable se asigna desde la pestaña de responsables.
      </p>
    </div>
  );
}
