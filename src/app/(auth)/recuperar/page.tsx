'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { emailValidator, FormField } from '@/components/ui/form-field';

import { requestResetAction, type AuthActionState } from '../actions';

const initialState: AuthActionState = {};

/**
 * Pantalla de recuperación de contraseña (R4.4, R4.5).
 *
 * Envía la solicitud vía `requestResetAction`, que responde SIEMPRE con un
 * mensaje genérico exista o no el correo, para no revelar si está registrado.
 * Validación inmediata del formato de correo antes de permitir el envío (R42.2).
 */
export default function RecoverPasswordPage() {
  const [state, formAction, pending] = useActionState(
    requestResetAction,
    initialState,
  );
  const [emailValid, setEmailValid] = useState(false);

  const canSubmit = emailValid && !pending;

  return (
    <section className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Recuperar contraseña</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Ingresa tu correo y te enviaremos instrucciones si está registrado.
        </p>
      </div>

      {state.message ? (
        <p
          role="status"
          className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200"
        >
          {state.message}
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-4">
          <FormField
            name="email"
            label="Correo electrónico"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            disabled={pending}
            validators={[emailValidator]}
            onValidityChange={(_, isValid) => setEmailValid(isValid)}
          />

          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Enviando…' : 'Enviar instrucciones'}
          </button>
        </form>
      )}

      <div className="text-center text-sm">
        <Link href="/login" className="font-medium text-brand hover:underline">
          Volver a iniciar sesión
        </Link>
      </div>
    </section>
  );
}
