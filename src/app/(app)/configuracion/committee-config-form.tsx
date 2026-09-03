'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { FormField } from '@/components/ui/form-field';
import type { Result, UUID } from '@/domain/types';
import { updateCommitteeConfigAction } from '@/server/actions/committee-actions';

interface CommitteeRow {
  id: UUID;
  name: string;
  locality: string | null;
  phone: string | null;
  email: string | null;
}

const TEXT_MAX = 120;

export function CommitteeConfigForm({
  committee,
  readOnly = false,
}: {
  committee: CommitteeRow;
  /** Cuando es true, los campos están deshabilitados y no se puede guardar. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const disabled = isPending || readOnly;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result: Result<void> = await updateCommitteeConfigAction(committee.id, {
        name: String(formData.get('name') ?? ''),
        locality: String(formData.get('locality') ?? '') || null,
        phone: String(formData.get('phone') ?? '') || null,
        email: String(formData.get('email') ?? '') || null,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSuccess('Configuracion actualizada.');
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      {readOnly ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Solo un administrador puede editar estos datos.
        </p>
      ) : null}
      <FormField name="name" label="Nombre" required defaultValue={committee.name} disabled={disabled} validators={[(value) => value.length > 150 ? 'El nombre no puede exceder 150 caracteres.' : null]} />
      <FormField name="locality" label="Localidad" defaultValue={committee.locality ?? ''} disabled={disabled} validators={[(value) => value.length > TEXT_MAX ? `La localidad no puede exceder ${TEXT_MAX} caracteres.` : null]} />
      <FormField name="phone" label="Telefono" type="tel" defaultValue={committee.phone ?? ''} disabled={disabled} validators={[(value) => value.length > TEXT_MAX ? `El telefono no puede exceder ${TEXT_MAX} caracteres.` : null]} />
      <FormField name="email" label="Correo electronico" type="email" defaultValue={committee.email ?? ''} disabled={disabled} validators={[(value) => value.length > TEXT_MAX ? `El correo no puede exceder ${TEXT_MAX} caracteres.` : null]} />
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {success ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{success}</p> : null}
      {readOnly ? null : (
        <button type="submit" disabled={disabled} className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
          {isPending ? 'Guardando...' : 'Guardar cambios'}
        </button>
      )}
    </form>
  );
}
