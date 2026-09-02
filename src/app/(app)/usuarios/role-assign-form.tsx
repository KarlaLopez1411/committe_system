'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { Result, UUID } from '@/domain/types';
import { assignRoleAction } from '@/server/actions/role-actions';

/**
 * Catálogo cerrado de los 9 roles predefinidos replicado para el cliente
 * (Requirements 5.1). No se importa desde `@/server/role-service` porque ese
 * módulo es `server-only`; debe mantenerse en sincronía con el CHECK de
 * `roles.key` y con el servicio, que revalida en el servidor (R5.1, R5.3).
 */
export const PREDEFINED_ROLE_KEYS = [
  'superadmin',
  'committee_admin',
  'president',
  'treasurer',
  'secretary',
  'clerk',
  'bonus_seller',
  'auditor',
  'member',
] as const;

export type RoleKey = (typeof PREDEFINED_ROLE_KEYS)[number];

/**
 * Formulario cliente de asignación de rol a un usuario del comité activo
 * (Requirements 5.2, 42.2, 42.3).
 *
 * Presenta la lista cerrada de los 9 roles predefinidos y exige seleccionar un
 * usuario y un rol antes de habilitar la acción (validación inmediata, R42.2).
 * La asignación es una acción administrativa sensible, por lo que se confirma
 * de forma explícita mediante `ConfirmDialog` (R42.3) y delega en
 * `assignRoleAction`, que revalida en el servidor (R5.1–R5.4).
 */

export interface UserOption {
  /** Id del usuario (auth.users.id) miembro del comité. */
  userId: string;
  /** Nombre legible del usuario/miembro para mostrar. */
  label: string;
}

/** Etiquetas legibles de los 9 roles predefinidos (RF-011). */
export const ROLE_LABELS: Record<RoleKey, string> = {
  superadmin: 'Superadministrador',
  committee_admin: 'Administrador del comité',
  president: 'Presidente',
  treasurer: 'Tesorero',
  secretary: 'Secretario',
  clerk: 'Capturista',
  bonus_seller: 'Vendedor de bonos',
  auditor: 'Auditor',
  member: 'Miembro',
};

export function RoleAssignForm({ users }: { users: UserOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [userId, setUserId] = useState('');
  const [roleKey, setRoleKey] = useState<RoleKey | ''>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSubmit = userId.length > 0 && roleKey.length > 0 && !isPending;

  const selectedUserLabel =
    users.find((u) => u.userId === userId)?.label ?? userId;
  const selectedRoleLabel = roleKey ? ROLE_LABELS[roleKey] : '';

  function handleRequestConfirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!canSubmit) {
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirm() {
    if (!roleKey) {
      return;
    }
    startTransition(async () => {
      const result: Result<{ userRoleId: UUID }> = await assignRoleAction(
        userId,
        roleKey,
      );
      setConfirmOpen(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSuccess(
        `Rol "${selectedRoleLabel}" asignado a ${selectedUserLabel}.`,
      );
      setUserId('');
      setRoleKey('');
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleRequestConfirm}
      className="flex flex-col gap-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-800"
      noValidate
    >
      <h2 className="text-lg font-semibold">Asignar rol</h2>

      <div className="flex flex-col gap-1">
        <label htmlFor="assign-user" className="text-sm font-medium">
          Usuario
          <span className="ml-0.5 text-red-600">*</span>
        </label>
        <select
          id="assign-user"
          value={userId}
          disabled={isPending || users.length === 0}
          onChange={(event) => setUserId(event.target.value)}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="">Selecciona un usuario…</option>
          {users.map((user) => (
            <option key={user.userId} value={user.userId}>
              {user.label}
            </option>
          ))}
        </select>
        {users.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No hay usuarios miembros del comité disponibles.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="assign-role" className="text-sm font-medium">
          Rol
          <span className="ml-0.5 text-red-600">*</span>
        </label>
        <select
          id="assign-role"
          value={roleKey}
          disabled={isPending}
          onChange={(event) => setRoleKey(event.target.value as RoleKey | '')}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="">Selecciona un rol…</option>
          {PREDEFINED_ROLE_KEYS.map((key) => (
            <option key={key} value={key}>
              {ROLE_LABELS[key]}
            </option>
          ))}
        </select>
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
        disabled={!canSubmit}
        className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Asignando…' : 'Asignar rol'}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar asignación de rol"
        description={`Se asignará el rol "${selectedRoleLabel}" a ${selectedUserLabel}. Esta acción modifica los permisos del usuario en el comité.`}
        confirmLabel="Asignar"
        pending={isPending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </form>
  );
}
