'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { UUID } from '@/domain/types';
import type { SellerAssignment } from '@/server/seller-portal-service';
import { recordCollectionAction, reportSettlementAction } from '@/server/actions/bonus-actions';

const STATUS_META: Record<string, { label: string; className: string }> = {
  pendiente: { label: 'Pendiente', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  cobrado_vendedor: { label: 'Cobrado', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  entregado_tesoreria: { label: 'Entregado', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  confirmado: { label: 'Confirmado', className: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
};

function StatusBadge({ status }: { status: string | null }) {
  const meta = STATUS_META[status ?? ''] ?? { label: status ?? '—', className: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>;
}

function CollectForm({ dueId, amount, sellerId, onDone }: { dueId: UUID; amount: string; sellerId: UUID; onDone(): void }) {
  const [value, setValue] = useState(amount);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await recordCollectionAction(dueId, value.trim(), sellerId);
      if (!result.ok) { setError(result.error.message); return; }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-2" noValidate>
      <div className="flex gap-2">
        <input
          type="number" inputMode="decimal" min="0.01" step="0.01"
          value={value} onChange={(e) => setValue(e.target.value)} disabled={isPending}
          className="min-h-touch flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
          aria-label="Monto cobrado"
        />
        <button type="submit" disabled={isPending || !value.trim()}
          className="min-h-touch rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
          {isPending ? '…' : 'Cobrar'}
        </button>
        <button type="button" disabled={isPending} onClick={onDone}
          className="min-h-touch rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800">
          ✕
        </button>
      </div>
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
    </form>
  );
}

export function SellerPortalView({
  sellerId, campaignId, assignments,
}: {
  sellerId: UUID;
  campaignId: UUID | null;
  assignments: SellerAssignment[];
  period: string;
}) {
  const router = useRouter();
  const [collecting, setCollecting] = useState<UUID | null>(null);
  const [selected, setSelected] = useState<Set<UUID>>(new Set());
  const [isReporting, startReport] = useTransition();
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);

  const collectableIds = assignments
    .filter((a) => a.dueStatus === 'cobrado_vendedor' && a.dueId)
    .map((a) => a.dueId as UUID);

  function toggleSelect(id: UUID) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function reportBatch() {
    if (!campaignId || selected.size === 0) return;
    setReportError(null);
    setReportSuccess(null);
    startReport(async () => {
      const result = await reportSettlementAction({
        campaignId,
        sellerId,
        collectionIds: [...selected],
      });
      if (!result.ok) { setReportError(result.error.message); return; }
      setReportSuccess(`Entrega reportada (ID: ${result.value.settlementId.slice(0, 8)}…).`);
      setSelected(new Set());
      router.refresh();
    });
  }

  if (!assignments.length) {
    return (
      <div className="px-4">
        <p className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          No tienes números asignados en este periodo.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4">
      {/* Batch report bar */}
      {collectableIds.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-blue-50 p-4 dark:bg-blue-950/30">
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
            {collectableIds.length} cobro{collectableIds.length !== 1 ? 's' : ''} listo{collectableIds.length !== 1 ? 's' : ''} para reportar. Selecciona los que quieres incluir.
          </p>
          {reportError ? <p role="alert" className="text-sm text-red-600">{reportError}</p> : null}
          {reportSuccess ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{reportSuccess}</p> : null}
          <button
            type="button"
            disabled={isReporting || selected.size === 0 || !campaignId}
            onClick={reportBatch}
            className="min-h-touch self-start rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isReporting ? 'Reportando…' : `Reportar entrega (${selected.size} seleccionados)`}
          </button>
        </div>
      ) : null}

      {/* Number cards */}
      <ul className="flex flex-col gap-3">
        {assignments
          .sort((a, b) => a.number - b.number)
          .map((item) => {
            const isSelectable = item.dueStatus === 'cobrado_vendedor' && item.dueId;
            const isSelected = item.dueId ? selected.has(item.dueId) : false;

            return (
              <li
                key={item.bonusNumberId}
                className={`rounded-2xl border p-4 transition-colors ${
                  isSelected
                    ? 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30'
                    : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {/* Checkbox for batch report */}
                    {isSelectable ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => item.dueId && toggleSelect(item.dueId)}
                        className="h-5 w-5 rounded accent-blue-600"
                        aria-label={`Seleccionar número ${item.number}`}
                      />
                    ) : (
                      <span className="h-5 w-5" />
                    )}
                    <div>
                      <p className="text-2xl font-bold tabular-nums">{item.number}</p>
                      {item.dueAmount ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400">${item.dueAmount}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge status={item.dueStatus} />
                    {/* Collect button: only for 'pendiente' dues */}
                    {item.dueStatus === 'pendiente' && item.dueId ? (
                      collecting === item.dueId ? null : (
                        <button
                          type="button"
                          onClick={() => setCollecting(item.dueId!)}
                          className="min-h-touch rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-brand-fg hover:opacity-90"
                        >
                          Registrar cobro
                        </button>
                      )
                    ) : null}
                  </div>
                </div>

                {/* Inline collect form */}
                {collecting === item.dueId && item.dueId ? (
                  <CollectForm
                    dueId={item.dueId}
                    amount={item.dueAmount ?? ''}
                    sellerId={sellerId}
                    onDone={() => { setCollecting(null); router.refresh(); }}
                  />
                ) : null}
              </li>
            );
          })}
      </ul>
    </div>
  );
}
