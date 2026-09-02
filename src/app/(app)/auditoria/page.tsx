import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface AuditRow {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  created_at: string;
}

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity_type?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  let q = supabase
    .from('audit_logs')
    .select('id, user_id, entity_type, entity_id, action, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (params.action) q = q.eq('action', params.action);
  if (params.entity_type) q = q.eq('entity_type', params.entity_type);

  const { data, error } = await q;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">Auditoría</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Registro de operaciones sensibles del comité activo (solo lectura).
        </p>
      </header>

      {/* Filtros simples via GET */}
      <form method="GET" className="flex flex-wrap gap-3">
        <input name="entity_type" defaultValue={params.entity_type ?? ''} placeholder="Tipo de entidad"
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        <input name="action" defaultValue={params.action ?? ''} placeholder="Acción"
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        <button type="submit" className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-brand-fg hover:opacity-90">
          Filtrar
        </button>
        <a href="/auditoria" className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
          Limpiar
        </a>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          No se pudo cargar el registro de auditoría: {error.message}
        </p>
      ) : !data?.length ? (
        <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700">
          No hay registros de auditoría.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800">
                <th className="py-2 pr-4 text-left font-semibold">Fecha</th>
                <th className="py-2 pr-4 text-left font-semibold">Usuario</th>
                <th className="py-2 pr-4 text-left font-semibold">Entidad</th>
                <th className="py-2 pr-4 text-left font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody>
              {(data as AuditRow[]).map((row) => (
                <tr key={row.id} className="border-b border-gray-100 dark:border-gray-900">
                  <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                    {new Date(row.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-gray-600 dark:text-gray-300">
                    {row.user_id.slice(0, 8)}…
                  </td>
                  <td className="py-2 pr-4">
                    {row.entity_type}
                    {row.entity_id ? <span className="ml-1 font-mono text-xs text-gray-400">({row.entity_id.slice(0, 8)})</span> : null}
                  </td>
                  <td className="py-2 pr-4 font-medium">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
