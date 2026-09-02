'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { FormField, type FieldValidator } from '@/components/ui/form-field';
import type { Result, UUID } from '@/domain/types';
import { createAccountAction } from '@/server/actions/finance-actions';

/**
 * Constantes de dominio de cuentas replicadas para el cliente.
 *
 * No se importan desde `@/server/finance-service` porque ese módulo es
 * `server-only` y no puede formar parte del bundle del navegador. Deben
 * mantenerse en sincronía con las reglas del servidor (Requirements 9.1, 9.2),
 * que revalida y es la fuente de verdad.
 */
const ACCOUNT_TYPES = [
  'caja_general',
  'cuenta_bancaria',
  'caja_actividad',
  'cuenta_digital',
  'otra',
] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

const ACCOUNT_NAME_MAX = 80;

/** Etiquetas legibles de los tipos de cuenta (RF-030). */
const TYPE_LABELS: Record<AccountType, string> = {
  caja_general: 'Caja general',
  cuenta_bancaria: 'Cuenta bancaria',
  caja_actividad: 'Caja de actividad',
  cuenta_digital: 'Cuenta digital',
  otra: 'Otra',
};

/** Datos de creación de una cuenta (espejo de `AccountInput` del servidor). */
interface AccountInput {
  name: string;
  type: AccountType;
  openingBalance?: string;
}

/** Validador de longitud máxima para el nombre de la cuenta. */
function maxLengthValidator(max: number, fieldLabel: string): FieldValidator {
  return (value: string) =>
    value.length > max
      ? `${fieldLabel} no puede exceder ${max} caracteres.`
      : null;
}

/**
 * Formulario cliente de alta de cuenta financiera con validación inmediata
 * (Requirements 9.1, 42.2).
 *
 * Valida el nombre (1–80) mientras se captura y ofrece el tipo dentro del
 * conjunto cerrado {caja_general, cuenta_bancaria, caja_actividad,
 * cuenta_digital, otra}. El botón de envío permanece deshabilitado hasta que el
 * nombre sea válido. El envío delega en `createAccountAction`, que revalida en
 * el servidor y persiste (R9.1, R9.2).
 */
export function AccountCreateForm({ onDone }: { onDone?: () => void } = {}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [nameValid, setNameValid] = useState(false);
  const [type, setType] = useState<AccountType>('caja_general');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const form = event.currentTarget;
    const formData = new FormData(form);

    const input: AccountInput = {
      name: String(formData.get('name') ?? ''),
      type,
      openingBalance: (formData.get('openingBalance') as string) || undefined,
    };

    startTransition(async () => {
      const result: Result<{ accountId: UUID }> = await createAccountAction(input);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSuccess('Cuenta creada correctamente.');
      form.reset();
      setType('caja_general');
      setNameValid(false);
      router.refresh();
      onDone?.();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
      noValidate
    >
      <h2 className="text-lg font-semibold">Crear cuenta</h2>

      <FormField
        name="name"
        label="Nombre de la cuenta"
        required
        placeholder="Ej. Caja general"
        disabled={isPending}
        validators={[maxLengthValidator(ACCOUNT_NAME_MAX, 'El nombre')]}
        onValidityChange={(_, isValid) => setNameValid(isValid)}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="account-type" className="text-sm font-medium">
          Tipo
          <span className="ml-0.5 text-red-600">*</span>
        </label>
        <select
          id="account-type"
          name="type"
          value={type}
          disabled={isPending}
          onChange={(event) => setType(event.target.value as AccountType)}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        >
          {ACCOUNT_TYPES.map((value) => (
            <option key={value} value={value}>
              {TYPE_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <FormField
        name="openingBalance"
        label="Saldo inicial"
        type="number"
        inputMode="decimal"
        placeholder="0.00"
        hint="Opcional. Se registra como saldo inicial de la cuenta."
        disabled={isPending}
      />

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {success}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending || !nameValid}
        className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Creando…' : 'Crear cuenta'}
      </button>
    </form>
  );
}
