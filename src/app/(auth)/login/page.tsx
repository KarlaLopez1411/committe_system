'use client';

import Link from 'next/link';
import { Suspense, useActionState, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import {
  emailValidator,
  FormField,
  minLengthValidator,
} from '@/components/ui/form-field';

import { signInAction, type AuthActionState } from '../actions';

const initialState: AuthActionState = {};

/**
 * Banner que informa que la cuenta se creó correctamente.
 *
 * Depende de `useSearchParams()`, por lo que se aísla en su propio componente
 * envuelto en `<Suspense>` para evitar el bailout de renderizado estático que
 * exige Next.js 15 (missing-suspense-with-csr-bailout).
 */
function RegisteredBanner() {
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get('registered') === '1';

  if (!justRegistered) {
    return null;
  }

  return (
    <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-300">
      ¡Cuenta creada! Inicia sesión para continuar.
    </p>
  );
}

/**
 * Pantalla de inicio de sesión (R4.1–R4.3, R4.8, R4.9).
 *
 * Formulario cliente mobile-first con validación inmediata de correo y
 * contraseña antes de permitir el envío (R42.2). El envío delega en la Server
 * Action `signInAction`, que aplica la política de auth y redirige según el
 * número de comités del usuario.
 */
export default function LoginPage() {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialState,
  );

  // Validez por campo para bloquear el envío hasta que todo sea válido (R42.2).
  const [validity, setValidity] = useState<Record<string, boolean>>({
    email: false,
    password: false,
  });

  function handleValidity(name: string, isValid: boolean) {
    setValidity((prev) => ({ ...prev, [name]: isValid }));
  }

  const canSubmit = validity.email && validity.password && !pending;

  return (
    <section className="flex flex-col gap-6">
      <Suspense fallback={null}>
        <RegisteredBanner />
      </Suspense>
      <div className="text-center">
        <h2 className="text-lg font-semibold">Iniciar sesión</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Accede con tu correo y contraseña.
        </p>
      </div>

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
          onValidityChange={handleValidity}
        />
        <FormField
          name="password"
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          validators={[minLengthValidator(1)]}
          onValidityChange={handleValidity}
        />

        {state.error ? (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>

      <div className="text-center text-sm">
        <Link href="/recuperar" className="font-medium text-brand hover:underline">
          ¿Olvidaste tu contraseña?
        </Link>
      </div>

      <p className="text-center text-sm text-gray-500">
        ¿Aún no tienes cuenta?{' '}
        <Link href="/registro" className="font-medium text-brand hover:underline">
          Regístrate
        </Link>
      </p>
    </section>
  );
}
