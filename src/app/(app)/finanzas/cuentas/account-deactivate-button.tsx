'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { Result } from '@/domain/types';
import { deactivateAccountAction } from '@/server/actions/finance-actions';

/**
 * Botón cliente para desactivar una cuenta financiera con confirmación
 * explícita (Requirements 9.1, 9.3, 42.3).
 *
 * La desactivación es una acción sensible que conserva el historial de ledger,
 * por lo que se confirma mediante `ConfirmDialog` antes de delegar en
 * `deactivateAccountAction`, que revalida en el servidor (R9.3).
 */
export function AccountDeactivateButton({
  accountId,
  accountName,
}: {
  accountId: string;
  accountName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    startTransition(async () => {
      const result: Result<void> = await deactivateAccountAction(accountId);
      setConfirmOpen(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
        disabled={isPending}
        className="min-h-touch rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        Desactivar
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Desactivar cuenta"
        description={`Se marcará la cuenta "${accountName}" como inactiva. Su historial de movimientos se conserva íntegramente, pero no podrá recibir nuevos movimientos.`}
        confirmLabel="Desactivar"
        destructive
        pending={isPending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
