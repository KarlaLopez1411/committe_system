'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  FormField,
  type FieldValidator,
} from '@/components/ui/form-field';
import type { Result, UUID } from '@/domain/types';
import { registerMemberAction } from '@/server/actions/member-actions';
import { todayIso } from '@/lib/date';

/**
 * Constantes de dominio de miembros replicadas para el cliente.
 *
 * No se importan desde `@/server/member-service` porque ese módulo es
 * `server-only` y no puede formar parte del bundle del navegador. Deben
 * mantenerse en sincronía con las reglas del servidor (Requirements 7.1, 7.5),
 * que revalida y es la fuente de verdad.
 */
const MEMBER_STATUSES = ['activo', 'inactivo', 'baja'] as const;
const MEMBER_NAME_MAX = 150;
const MEMBER_PHONE_MAX = 30;
const MEMBER_NOTES_MAX = 500;

/** Datos de alta de un miembro (espejo de `MemberInput` del servidor). */
interface MemberInput {
  fullName: string;
  phone?: string | null;
  joinedAt?: string | null;
  position?: string | null;
  status?: string | null;
  notes?: string | null;
  monthlyCommitment?: boolean;
  monthlyAmount?: string | number | null;
}

/**
 * Formulario cliente de alta de miembro con validación inmediata
 * (Requirements 7.1, 42.2).
 *
 * Reutiliza `FormField` para validar cada campo mientras se captura (nombre
 * 1–150, teléfono ≤30, notas ≤500) y el estado dentro del conjunto
 * {activo, inactivo, baja}. El botón de envío permanece deshabilitado hasta que
 * los campos con validación no presenten errores. El envío delega en
 * `registerMemberAction`, que revalida en el servidor y persiste (R7.x).
 */

/** Etiquetas legibles de los estados de miembro. */
const STATUS_LABELS: Record<(typeof MEMBER_STATUSES)[number], string> = {
  activo: 'Activo',
  inactivo: 'Inactivo',
  baja: 'Baja',
};

/** Validador de longitud máxima reutilizable para campos opcionales. */
function maxLengthValidator(max: number, fieldLabel: string): FieldValidator {
  return (value: string) =>
    value.length > max
      ? `${fieldLabel} no puede exceder ${max} caracteres.`
      : null;
}

export function MemberRegisterForm({ onDone }: { onDone?: () => void } = {}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  // Validez por campo para habilitar/deshabilitar el envío (R42.2).
  const [fieldValidity, setFieldValidity] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<(typeof MEMBER_STATUSES)[number]>('activo');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [monthlyCommitment, setMonthlyCommitment] = useState(false);
  const [monthlyAmount, setMonthlyAmount] = useState('100');

  function handleValidityChange(name: string, isValid: boolean) {
    setFieldValidity((prev) => ({ ...prev, [name]: isValid }));
  }

  const hasInvalidField = Object.values(fieldValidity).some((valid) => !valid);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const form = event.currentTarget;
    const formData = new FormData(form);

    const input: MemberInput = {
      fullName: String(formData.get('fullName') ?? ''),
      phone: (formData.get('phone') as string) || null,
      joinedAt: (formData.get('joinedAt') as string) || null,
      position: (formData.get('position') as string) || null,
      status,
      notes: (formData.get('notes') as string) || null,
      monthlyCommitment,
      monthlyAmount: monthlyCommitment ? monthlyAmount || '100' : '0',
    };

    startTransition(async () => {
      const result: Result<{ memberId: UUID }> = await registerMemberAction(input);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSuccess('Miembro registrado correctamente.');
      form.reset();
      setStatus('activo');
      setMonthlyCommitment(false);
      setMonthlyAmount('100');
      setFieldValidity({});
      router.refresh();
      onDone?.();
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
      noValidate
    >
      <h2 className="text-lg font-semibold">Registrar miembro</h2>

      <FormField
        name="fullName"
        label="Nombre completo"
        required
        placeholder="Nombre del miembro"
        autoComplete="name"
        disabled={isPending}
        validators={[maxLengthValidator(MEMBER_NAME_MAX, 'El nombre')]}
        onValidityChange={handleValidityChange}
      />

      <FormField
        name="phone"
        label="Teléfono"
        type="tel"
        inputMode="tel"
        placeholder="Opcional"
        autoComplete="tel"
        disabled={isPending}
        validators={[maxLengthValidator(MEMBER_PHONE_MAX, 'El teléfono')]}
        onValidityChange={handleValidityChange}
      />

      <FormField
        name="joinedAt"
        label="Fecha de incorporación"
        type="date"
        defaultValue={todayIso()}
        disabled={isPending}
      />

      <FormField
        name="position"
        label="Cargo o función"
        placeholder="Opcional"
        disabled={isPending}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="member-status" className="text-sm font-medium">
          Estado
        </label>
        <select
          id="member-status"
          name="status"
          value={status}
          disabled={isPending}
          onChange={(event) =>
            setStatus(event.target.value as (typeof MEMBER_STATUSES)[number])
          }
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        >
          {MEMBER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <FormField
        name="notes"
        label="Notas"
        placeholder="Opcional"
        disabled={isPending}
        validators={[maxLengthValidator(MEMBER_NOTES_MAX, 'Las notas')]}
        onValidityChange={handleValidityChange}
      />

      {/* Compromiso de aportación mensual voluntaria */}
      <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={monthlyCommitment}
            onChange={(e) => setMonthlyCommitment(e.target.checked)}
            disabled={isPending}
            className="h-4 w-4"
          />
          Se compromete a aportación mensual
        </label>
        {monthlyCommitment ? (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Monto mensual
            <input
              type="number"
              min="0"
              step="0.01"
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(e.target.value)}
              disabled={isPending}
              className="min-h-touch w-full max-w-[160px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
        ) : null}
      </div>

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
        disabled={isPending || hasInvalidField}
        className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Registrando…' : 'Registrar miembro'}
      </button>
    </form>
  );
}
