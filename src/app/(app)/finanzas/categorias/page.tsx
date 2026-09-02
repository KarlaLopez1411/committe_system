import { createSupabaseServerClient } from '@/lib/supabase/server';

import { CategoryManager } from './category-manager';

export const dynamic = 'force-dynamic';

interface CategoryRow {
  id: string;
  name: string;
}

export default async function CategoriesPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('transaction_categories')
    .select('id, name')
    .order('name', { ascending: true });

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">Categorias</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Clasifica los ingresos y movimientos del comite activo.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          No se pudieron cargar las categorias: {error.message}
        </p>
      ) : (
        <CategoryManager categories={(data ?? []) as CategoryRow[]} />
      )}
    </section>
  );
}
