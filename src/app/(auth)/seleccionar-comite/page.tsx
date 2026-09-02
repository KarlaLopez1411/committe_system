import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';

import {
  CommitteeSelectForm,
  type CommitteeOption,
} from './committee-select-form';

/**
 * Pantalla de selección de comité activo (R4.8).
 *
 * Se muestra tras la autenticación cuando el usuario pertenece a más de un
 * comité (`resolveActiveCommittee` ⇒ 'choose'). Carga en el servidor los
 * comités con membresía activa del usuario (sujeto a RLS) y delega la elección
 * al formulario cliente, que fija la cookie de comité activo vía Server Action.
 */
export default async function SelectCommitteePage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sin sesión no hay comités que resolver: se exige autenticación.
  if (!user) {
    redirect('/login');
  }

  const { data, error } = await supabase
    .from('committee_users')
    .select('committee_id, committees(id, name)')
    .eq('user_id', user.id)
    .eq('status', 'active');

  const committees: CommitteeOption[] = (data ?? [])
    .map((row) => {
      const committee = (row as { committees?: unknown }).committees as
        | { id?: unknown; name?: unknown }
        | { id?: unknown; name?: unknown }[]
        | null
        | undefined;
      // La relación puede resolverse como objeto o arreglo según la inferencia.
      const single = Array.isArray(committee) ? committee[0] : committee;
      if (
        single &&
        typeof single.id === 'string' &&
        typeof single.name === 'string'
      ) {
        return { id: single.id, name: single.name };
      }
      return null;
    })
    .filter((option): option is CommitteeOption => option !== null);

  return (
    <section className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Selecciona un comité</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Perteneces a varios comités. Elige con cuál quieres trabajar.
        </p>
      </div>

      {error || committees.length === 0 ? (
        <p
          role="alert"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          No se encontraron comités activos para tu cuenta. Contacta al
          administrador de tu comité.
        </p>
      ) : (
        <CommitteeSelectForm committees={committees} />
      )}
    </section>
  );
}
