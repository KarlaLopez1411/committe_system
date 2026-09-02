'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { FormField, emailValidator, minLengthValidator } from '@/components/ui/form-field';

import { signUpAction, type SignUpActionState } from '../actions';

const initialState: SignUpActionState = {};

export default function RegistroPage() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [validity, setValidity] = useState<Record<string, boolean>>({});

  function onValid(name: string, isValid: boolean) {
    setValidity((prev) => ({ ...prev, [name]: isValid }));
  }

  const requiredFields = ['fullName', 'email', 'password', mode === 'create' ? 'committeeName' : 'committeeCode'];
  const canSubmit = !pending && requiredFields.every((f) => validity[f]);

  return (
    <section className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Crear cuenta</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Regístrate y vincula tu cuenta a un comité.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="mode" value={mode} />

        <FormField name="fullName" label="Nombre completo" required autoComplete="name"
          placeholder="Tu nombre completo" disabled={pending}
          validators={[minLengthValidator(2)]} onValidityChange={onValid} />

        <FormField name="email" label="Correo electrónico" type="email" required
          autoComplete="email" inputMode="email" placeholder="correo@ejemplo.com"
          disabled={pending} validators={[emailValidator]} onValidityChange={onValid} />

        <FormField name="password" label="Contraseña" type="password" required
          autoComplete="new-password" placeholder="Mínimo 6 caracteres" disabled={pending}
          validators={[minLengthValidator(6)]} onValidityChange={onValid} />

        {/* Toggle create / join */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Comité</legend>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={pending}
              onClick={() => { setMode('create'); setValidity((v) => ({ ...v, committeeCode: false })); }}
              className={`min-h-touch rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${mode === 'create' ? 'border-brand bg-brand text-brand-fg' : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'}`}>
              Crear comité
            </button>
            <button type="button" disabled={pending}
              onClick={() => { setMode('join'); setValidity((v) => ({ ...v, committeeName: false })); }}
              className={`min-h-touch rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${mode === 'join' ? 'border-brand bg-brand text-brand-fg' : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'}`}>
              Unirme a uno
            </button>
          </div>
        </fieldset>

        {mode === 'create' ? (
          <FormField name="committeeName" label="Nombre del comité" required
            placeholder="Ej. Comité Vecinal Lomas" disabled={pending}
            validators={[minLengthValidator(2)]} onValidityChange={onValid} />
        ) : (
          <FormField name="committeeCode" label="Código del comité" required
            placeholder="Ej. ABC123" disabled={pending}
            hint="Pide el código al administrador del comité."
            validators={[(v) => {
              if (!v) return null;
              if (!/^[A-Za-z0-9]+$/.test(v)) return 'Solo letras y números.';
              if (v.length < 4 || v.length > 12) return 'Entre 4 y 12 caracteres.';
              return null;
            }]}
            onValidityChange={onValid} />
        )}

        {state.error ? (
          <p role="alert" className="text-sm text-red-600">{state.error}</p>
        ) : null}

        <button type="submit" disabled={!canSubmit}
          className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? 'Registrando…' : 'Crear cuenta'}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500">
        ¿Ya tienes cuenta?{' '}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Inicia sesión
        </Link>
      </p>
    </section>
  );
}
