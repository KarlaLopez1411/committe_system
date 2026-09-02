'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { UUID } from '@/domain/types';
import { generateNumbersAction } from '@/server/actions/bonus-actions';

/**
 * Botón de recuperación para campañas sin números.
 *
 * Las campañas nuevas generan sus 100 números automáticamente, pero las
 * creadas antes de ese cambio pueden estar vacías. Este botón genera el rango
 * 1–100 de la campaña bajo demanda.
 */
export function GenerateNumbersButton({ campaignId }: { campaignId: UUID }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await generateNumbersAction(campaignId);
      if (!result.ok) { setError(result.error.message); return; }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-gray-300 p-4 dark:border-gray-700">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Esta campaña aún no tiene números generados.
      </p>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        onClick={generate}
        disabled={isPending}
        className="min-h-touch w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:opacity-90 disabled:opacity-60"
      >
        {isPending ? 'Generando…' : 'Generar 100 números (1–100)'}
      </button>
    </div>
  );
}
