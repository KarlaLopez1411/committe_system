'use client';

import { useActionState, useState } from 'react';

import { selectCommitteeAction, type AuthActionState } from '../actions';

export interface CommitteeOption {
  id: string;
  name: string;
}

const initialState: AuthActionState = {};

/**
 * Formulario cliente de selección de comité activo (R4.8).
 *
 * Presenta los comités disponibles como opciones de toque cómodo (mobile-first)
 * y exige una selección explícita antes de habilitar el botón de continuar. El
 * envío delega en `selectCommitteeAction`, que fija la cookie de comité activo.
 */
export function CommitteeSelectForm({
  committees,
}: {
  committees: CommitteeOption[];
}) {
  const [state, formAction, pending] = useActionState(
    selectCommitteeAction,
    initialState,
  );
  const [selected, setSelected] = useState('');

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Comités disponibles</legend>
        {committees.map((committee) => (
          <label
            key={committee.id}
            className={[
              'flex min-h-touch cursor-pointer items-center gap-3 rounded-lg border px-4 py-3',
              selected === committee.id
                ? 'border-brand ring-2 ring-brand'
                : 'border-gray-300 dark:border-gray-700',
            ].join(' ')}
          >
            <input
              type="radio"
              name="committeeId"
              value={committee.id}
              checked={selected === committee.id}
              onChange={() => setSelected(committee.id)}
              className="h-4 w-4 accent-brand"
            />
            <span className="text-base font-medium">{committee.name}</span>
          </label>
        ))}
      </fieldset>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={selected.length === 0 || pending}
        className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Entrando…' : 'Continuar'}
      </button>
    </form>
  );
}
