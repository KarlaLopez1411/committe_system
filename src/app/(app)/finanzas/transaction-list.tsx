'use client';

import { useTransition, useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import type { UUID } from '@/domain/types';
import {
  approveTransactionAction,
  voidTransactionAction,
  cancelDraftTransactionAction,
} from '@/server/actions/finance-actions';

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: 'Borrador', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  posted: { label: 'Aprobado', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  reversed: { label: 'Anulado', className: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
};

const TYPE_LABELS: Record<string, string> = {
  income: 'Ingreso', expense: 'Egreso', transfer: 'Transferencia', adjustment: 'Ajuste',
};

export interface TransactionRow {
  id: UUID;
  type: string;
  status: string;
  transaction_date: string;
  description: string | null;
  amount: string | number | null;
  /** Nombre de quien aprobó la transacción (null si aún no se aprueba). */
  approvedByName?: string | null;
  /** Id de la categoría (para filtrar). */
  categoryId?: string | null;
  /** Nombre de la categoría (para mostrar y filtrar). */
  categoryName?: string | null;
}

export function TransactionActions({ tx }: { tx: TransactionRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function approve() {
    if (!window.confirm('¿Aprobar esta transacción?')) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await approveTransactionAction(tx.id);
        if (!result.ok) { setError(result.error.message); return; }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo aprobar la transacción.');
      }
    });
  }

  function voidTx() {
    const reason = window.prompt('Motivo de anulación (opcional):');
    if (reason === null) return; // user cancelled
    setError(null);
    startTransition(async () => {
      try {
        const result = await voidTransactionAction(tx.id, reason || null);
        if (!result.ok) { setError(result.error.message); return; }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo anular la transacción.');
      }
    });
  }

  function cancelDraft() {
    if (!window.confirm('¿Cancelar este movimiento? Se eliminará y no se sumará a la caja.')) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await cancelDraftTransactionAction(tx.id);
        if (!result.ok) { setError(result.error.message); return; }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo cancelar la transacción.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {tx.status === 'draft' ? (
          <>
            <button type="button" disabled={isPending} onClick={approve}
              className="min-h-touch rounded-lg border border-green-500 px-3 py-1 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-60 dark:text-green-300 dark:hover:bg-green-950">
              Aprobar
            </button>
            <button type="button" disabled={isPending} onClick={cancelDraft}
              className="min-h-touch rounded-lg border border-red-300 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
              Cancelar
            </button>
          </>
        ) : null}
        {tx.status === 'posted' ? (
          <button type="button" disabled={isPending} onClick={voidTx}
            className="min-h-touch rounded-lg border border-red-300 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
            Anular
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

const STATUS_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'draft', label: 'Pendientes de aprobar' },
  { id: 'posted', label: 'Aprobados' },
] as const;

type StatusFilterId = (typeof STATUS_FILTERS)[number]['id'];

const PAGE_SIZE = 20;

export function TransactionList({
  transactions,
  showStatusFilter = false,
}: {
  transactions: TransactionRow[];
  /** Muestra el filtro por estado (pendientes/aprobados). Útil en Ingresos/Egresos. */
  showStatusFilter?: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilterId>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  // Categorías presentes en las transacciones (para el dropdown).
  const categoryOptions = useMemo(() => {
    const set = new Map<string, string>();
    let hasUncategorized = false;
    for (const t of transactions) {
      if (t.categoryName) set.set(t.categoryName, t.categoryName);
      else hasUncategorized = true;
    }
    const list = [...set.keys()].sort((a, b) => a.localeCompare(b));
    return { list, hasUncategorized };
  }, [transactions]);

  const filtered = useMemo(
    () =>
      transactions.filter((t) => {
        if (showStatusFilter && statusFilter !== 'all' && t.status !== statusFilter) return false;
        if (categoryFilter === 'all') return true;
        if (categoryFilter === '__none__') return !t.categoryName;
        return t.categoryName === categoryFilter;
      }),
    [transactions, showStatusFilter, statusFilter, categoryFilter],
  );

  // Reinicia a la página 1 cuando cambian los filtros o los datos.
  useEffect(() => { setPage(1); }, [statusFilter, categoryFilter, transactions]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {showStatusFilter
          ? STATUS_FILTERS.map((f) => {
              const isActive = f.id === statusFilter;
              const count =
                f.id === 'all'
                  ? transactions.length
                  : transactions.filter((t) => t.status === f.id).length;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  aria-pressed={isActive}
                  className={[
                    'min-h-touch rounded-full border px-3 py-1 text-sm font-medium',
                    isActive
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800',
                  ].join(' ')}
                >
                  {f.label} ({count})
                </button>
              );
            })
          : null}

        {/* Filtro por categoría (default: todos) */}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-300">Categoría</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="min-h-touch rounded-lg border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="all">Todas</option>
            {categoryOptions.list.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
            {categoryOptions.hasUncategorized ? (
              <option value="__none__">Sin categoría</option>
            ) : null}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          No hay movimientos que coincidan con los filtros.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {pageItems.map((tx) => {
              const statusMeta = STATUS_LABELS[tx.status] ?? STATUS_LABELS.draft;
              return (
                <li key={tx.id} className="flex flex-col gap-2 rounded-2xl border border-gray-200 p-4 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{TYPE_LABELS[tx.type] ?? tx.type}</span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusMeta?.className ?? 'bg-gray-200 text-gray-700'}`}>
                        {statusMeta?.label ?? tx.status}
                      </span>
                      {tx.categoryName ? (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                          {tx.categoryName}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">{tx.transaction_date}</span>
                    {tx.description ? <span className="text-sm">{tx.description}</span> : null}
                    {tx.status === 'posted' && tx.approvedByName ? (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Aprobado por {tx.approvedByName}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                    {tx.amount != null ? (
                      <span
                        className={[
                          'text-base font-bold tabular-nums',
                          tx.type === 'income'
                            ? 'text-green-700 dark:text-green-400'
                            : tx.type === 'expense'
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-gray-700 dark:text-gray-300',
                        ].join(' ')}
                      >
                        {tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}${tx.amount}
                      </span>
                    ) : null}
                    <TransactionActions tx={tx} />
                  </div>
                </li>
              );
            })}
          </ul>
          <ListPager page={safePage} pageCount={pageCount} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/** Controles de paginación reutilizables. */
export function ListPager({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-2">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="min-h-touch rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        Anterior
      </button>
      <span className="text-sm text-gray-500">Página {page} de {pageCount}</span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount}
        className="min-h-touch rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        Siguiente
      </button>
    </div>
  );
}
