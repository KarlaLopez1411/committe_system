'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { UUID } from '@/domain/types';
import { reviewCashClosingAction, approveCashClosingAction, closeCashClosingAction } from '@/server/actions/community-actions';

export function CashClosingActions({
  closingId,
  status,
  canReview = false,
  canApprove = false,
  canClose = false,
}: {
  closingId: UUID;
  status: string;
  canReview?: boolean;
  canApprove?: boolean;
  canClose?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(action: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) { setError((result as { ok: false; error: { message: string } }).error.message); return; }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {status === 'abierto' && canReview ? <button type="button" disabled={isPending} onClick={() => act(() => reviewCashClosingAction(closingId))} className="min-h-touch rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700">Revisar</button> : null}
        {status === 'en_revision' && canApprove ? <button type="button" disabled={isPending} onClick={() => act(() => approveCashClosingAction(closingId))} className="min-h-touch rounded-lg border border-green-400 px-3 py-1 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-60 dark:text-green-300">Aprobar</button> : null}
        {status === 'aprobado' && canClose ? (
          <button type="button" disabled={isPending}
            onClick={() => { if (window.confirm('¿Cerrar definitivamente este corte?')) act(() => closeCashClosingAction(closingId)); }}
            className="min-h-touch rounded-lg border border-red-300 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:text-red-300">
            Cerrar
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
