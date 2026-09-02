'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { createCampaignAction } from '@/server/actions/bonus-actions';

/**
 * Alta de campaña de bonos simplificada.
 *
 * Los bonos se manejan por año y son SIEMPRE 100 números (1–100), por lo que el
 * formulario solo solicita: año, aportación mensual y premio mensual. El nombre
 * ("Bonos {año}") y el rango 1–100 se derivan automáticamente en el servidor,
 * que además genera los 100 números al crear la campaña.
 */
export function CampaignForm({ onCreated }: { onCreated?: () => void } = {}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null); setSuccess(null);
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createCampaignAction({
        year: parseInt(String(fd.get('year') ?? ''), 10),
        monthlyAmount: String(fd.get('monthlyAmount') ?? ''),
        monthlyPrize: String(fd.get('monthlyPrize') ?? ''),
      });
      if (!result.ok) { setError(result.error.message); return; }
      setSuccess('Campaña creada con 100 números (1–100).');
      (event.target as HTMLFormElement).reset();
      router.refresh();
      onCreated?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Se crean 100 números (1–100) automáticamente para el año indicado.
      </p>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Año
        <input name="year" type="number" required min={2000} max={2100} placeholder="Año" disabled={isPending}
          defaultValue={new Date().getFullYear()}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900" />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Aportación mensual
        <input name="monthlyAmount" type="number" required min="0.01" step="0.01" placeholder="Aportación mensual" disabled={isPending}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900" />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Premio mensual
        <input name="monthlyPrize" type="number" required min="0.01" step="0.01" placeholder="Premio mensual" disabled={isPending}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900" />
      </label>

      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {success ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{success}</p> : null}
      <button type="submit" disabled={isPending} className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:opacity-60">
        {isPending ? 'Guardando…' : 'Crear campaña'}
      </button>
    </form>
  );
}
