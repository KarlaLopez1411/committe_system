'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import type { Result, UUID } from '@/domain/types';
import {
  createCategoryAction,
  deleteCategoryAction,
  renameCategoryAction,
} from '@/server/actions/finance-actions';

import { ListPager } from '../transaction-list';

const CATEGORY_PAGE_SIZE = 20;

interface CategoryRow {
  id: UUID;
  name: string;
}

const CATEGORY_NAME_MAX = 100;

export function CategoryManager({
  categories,
  showCreateForm = true,
}: {
  categories: CategoryRow[];
  /** Muestra el formulario de alta inline. En la tab de Finanzas se oculta y
   *  el alta se hace desde el botón flotante (pop-up). */
  showCreateForm?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<UUID | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const nameIsValid = name.trim().length > 0 && name.length <= CATEGORY_NAME_MAX;

  const pageCount = Math.max(1, Math.ceil(categories.length / CATEGORY_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = categories.slice((safePage - 1) * CATEGORY_PAGE_SIZE, safePage * CATEGORY_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [categories.length]);

  function run(operation: () => Promise<Result<unknown>>) {
    setError(null);
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setName('');
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {showCreateForm ? (
        <form
          className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => createCategoryAction(name));
          }}
          noValidate
        >
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="category-name" className="text-sm font-medium">
              Nueva categoria<span className="ml-0.5 text-red-600">*</span>
            </label>
            <input
              id="category-name"
              name="category-name"
              value={name}
              required
              maxLength={CATEGORY_NAME_MAX}
              placeholder="Ej. Cooperacion"
              disabled={isPending}
              onChange={(event) => setName(event.target.value)}
              className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <button
            type="submit"
            disabled={isPending || !nameIsValid}
            className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? 'Guardando...' : 'Agregar'}
          </button>
        </form>
      ) : null}

      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}

      {categories.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          No hay categorias registradas.
        </p>
      ) : (
        <>
        <ul className="flex flex-col gap-2">
          {pageItems.map((category) => (
            <li key={category.id} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800 sm:flex-row sm:items-center">
              {editing === category.id ? (
                <input
                  value={editName}
                  maxLength={CATEGORY_NAME_MAX}
                  onChange={(event) => setEditName(event.target.value)}
                  disabled={isPending}
                  className="min-h-touch flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900"
                />
              ) : (
                <span className="flex-1 font-medium">{category.name}</span>
              )}
              <div className="flex gap-2">
                {editing === category.id ? (
                  <button type="button" disabled={isPending || editName.trim().length === 0} onClick={() => run(() => renameCategoryAction(category.id, editName))} className="min-h-touch rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800">Guardar</button>
                ) : (
                  <button type="button" disabled={isPending} onClick={() => { setEditing(category.id); setEditName(category.name); }} className="min-h-touch rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800">Editar</button>
                )}
                <button type="button" disabled={isPending} onClick={() => { if (window.confirm(`Eliminar la categoria \"${category.name}\"?`)) run(() => deleteCategoryAction(category.id)); }} className="min-h-touch rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">Eliminar</button>
              </div>
            </li>
          ))}
        </ul>
        <ListPager page={safePage} pageCount={pageCount} onPage={setPage} />
        </>
      )}
    </div>
  );
}
