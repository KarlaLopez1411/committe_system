'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { createActivityAction } from '@/server/actions/community-actions';
import { todayIso } from '@/lib/date';

export function ActivityForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null); setSuccess(null);
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createActivityAction({
        name: String(fd.get('name') ?? ''),
        startDate: String(fd.get('startDate') ?? ''),
        endDate: String(fd.get('endDate') ?? ''),
        objective: String(fd.get('objective') ?? '') || null,
        responsible: String(fd.get('responsible') ?? '') || null,
      });
      if (!result.ok) { setError(result.error.message); return; }
      setSuccess('Actividad creada.');
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <h2 className="text-lg font-semibold">Nueva actividad</h2>
      <input name="name" type="text" required placeholder="Nombre" disabled={isPending}
        className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900" />
      <input name="startDate" type="date" required disabled={isPending} defaultValue={todayIso()}
        className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900" />
      <input name="endDate" type="date" required disabled={isPending} defaultValue={todayIso()}
        className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900" />
      <input name="objective" type="text" placeholder="Objetivo (opcional)" disabled={isPending}
        className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900" />
      <input name="responsible" type="text" placeholder="Responsable (opcional)" disabled={isPending}
        className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900" />
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {success ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{success}</p> : null}
      <button type="submit" disabled={isPending} className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:opacity-60">
        {isPending ? 'Guardando…' : 'Crear actividad'}
      </button>
    </form>
  );
}
