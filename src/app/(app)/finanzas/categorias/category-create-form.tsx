'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { createCategoryAction } from '@/server/actions/finance-actions';

const CATEGORY_NAME_MAX = 100;

/** Formulario mínimo para crear una categoría (usado en el modal del FAB). */
export function CategoryCreateForm({ onDone }: { onDone?: () => void } = {}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length > 0 && name.length <= CATEGORY_NAME_MAX;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createCategoryAction(name);
      if (!result.ok) { setError(result.error.message); return; }
      setName('');
      router.refresh();
      onDone?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Nombre de la categoría
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={CATEGORY_NAME_MAX}
          placeholder="Ej. Cooperación"
          disabled={isPending}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={isPending || !valid}
        className="min-h-touch w-fit rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:opacity-60"
      >
        {isPending ? 'Guardando…' : 'Agregar categoría'}
      </button>
    </form>
  );
}
