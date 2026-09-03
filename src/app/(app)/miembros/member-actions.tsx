'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { UUID } from '@/domain/types';
import {
  updateMemberAction,
  deleteMemberAction,
  linkMemberUserAction,
  unlinkMemberUserAction,
  listAssignableUsersAction,
} from '@/server/actions/member-actions';
import type { AssignableUser } from '@/server/member-service';
import { EditIcon, TrashIcon } from '@/components/ui/icons';

import type { MemberRow } from './miembros-tabs';

const STATUS_OPTIONS = [
  { value: 'activo', label: 'Activo' },
  { value: 'inactivo', label: 'Inactivo' },
  { value: 'baja', label: 'Baja' },
] as const;

/**
 * Controles de gestión de un miembro: cambiar estado (activo/inactivo/baja),
 * editar datos básicos (modal) y eliminar. Solo se muestran a usuarios con el
 * permiso `members.update` (el gating lo aplica el llamador vía `canManage`).
 */
export function MemberActions({
  member,
  linkedUserId,
  canManageUsers,
}: {
  member: MemberRow;
  /** userId ya vinculado al miembro (si existe). */
  linkedUserId: string | null;
  /** users.manage: habilita el picker "Usuario vinculado" en el modal. */
  canManageUsers: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) { setError(result.error?.message ?? 'Ocurrió un error.'); return; }
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`¿Eliminar a "${member.full_name}"? Esta acción no se puede deshacer.`)) return;
    run(() => deleteMemberAction(member.id as UUID));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setError(null); setEditing(true); }}
          disabled={isPending}
          aria-label="Editar miembro"
          title="Editar"
          className="rounded-lg border border-gray-300 p-1.5 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          <EditIcon />
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={isPending}
          aria-label="Eliminar miembro"
          title="Eliminar"
          className="rounded-lg border border-red-300 p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
        >
          <TrashIcon />
        </button>
      </div>
      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}

      {editing ? (
        <EditMemberModal
          member={member}
          linkedUserId={linkedUserId}
          canManageUsers={canManageUsers}
          pending={isPending}
          onClose={() => setEditing(false)}
          onSave={async ({ data, selectedUserId }) => {
            setError(null);
            startTransition(async () => {
              const result = await updateMemberAction(member.id as UUID, data);
              if (!result.ok) { setError(result.error.message); return; }

              // Sincroniza el vínculo con usuario si el permiso está habilitado
              // y el valor cambió. Se ejecuta después del update para no perder
              // los cambios del formulario si el vínculo falla.
              if (canManageUsers && selectedUserId !== linkedUserId) {
                if (selectedUserId === null) {
                  const r = await unlinkMemberUserAction(member.id as UUID);
                  if (!r.ok) { setError(r.error.message); return; }
                } else if (linkedUserId && selectedUserId !== linkedUserId) {
                  // Cambiar de un usuario a otro: primero desvincular, luego vincular.
                  const r1 = await unlinkMemberUserAction(member.id as UUID);
                  if (!r1.ok) { setError(r1.error.message); return; }
                  const r2 = await linkMemberUserAction(member.id as UUID, selectedUserId as UUID);
                  if (!r2.ok) { setError(r2.error.message); return; }
                } else {
                  const r = await linkMemberUserAction(member.id as UUID, selectedUserId as UUID);
                  if (!r.ok) { setError(r.error.message); return; }
                }
              }

              setEditing(false);
              router.refresh();
            });
          }}
        />
      ) : null}
    </div>
  );
}

interface EditData {
  fullName: string;
  phone: string | null;
  position: string | null;
  notes: string | null;
  status: string;
  monthlyCommitment: boolean;
  monthlyAmount: string;
}

function EditMemberModal({
  member,
  linkedUserId,
  canManageUsers,
  pending,
  onClose,
  onSave,
}: {
  member: MemberRow;
  linkedUserId: string | null;
  canManageUsers: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (payload: { data: EditData; selectedUserId: string | null }) => void;
}) {
  const [fullName, setFullName] = useState(member.full_name);
  const [phone, setPhone] = useState(member.phone ?? '');
  const [position, setPosition] = useState(member.position ?? '');
  const [notes, setNotes] = useState(member.notes ?? '');
  const [status, setStatus] = useState(member.status);
  const [commitment, setCommitment] = useState(Boolean(member.monthly_commitment));
  const [amount, setAmount] = useState(String(member.monthly_amount ?? '100'));
  const [selectedUserId, setSelectedUserId] = useState<string | null>(linkedUserId);
  const [assignable, setAssignable] = useState<AssignableUser[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Carga la lista de usuarios elegibles solo si el permiso está habilitado.
  useEffect(() => {
    if (!canManageUsers) return;
    let cancelled = false;
    setLoadingUsers(true);
    setUsersError(null);
    listAssignableUsersAction(member.id as UUID).then((r) => {
      if (cancelled) return;
      if (r.ok) setAssignable(r.value);
      else setUsersError(r.error.message);
      setLoadingUsers(false);
    });
    return () => { cancelled = true; };
  }, [canManageUsers, member.id]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSave({
      data: {
        fullName,
        phone: phone.trim() || null,
        position: position.trim() || null,
        notes: notes.trim() || null,
        status,
        monthlyCommitment: commitment,
        monthlyAmount: amount,
      },
      selectedUserId,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-member-title"
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl dark:bg-gray-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="edit-member-title" className="text-lg font-semibold">Editar miembro</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg px-2 py-1 text-xl leading-none text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Nombre
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required minLength={1} maxLength={150} disabled={pending}
              className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Teléfono <span className="font-normal text-gray-400">(opcional)</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel" inputMode="tel" maxLength={30} disabled={pending}
                className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Cargo <span className="font-normal text-gray-400">(opcional)</span>
              <input
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                maxLength={100} disabled={pending}
                className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Estado
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={pending}
              className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>

          {canManageUsers ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Usuario vinculado <span className="font-normal text-gray-400">(opcional)</span>
              <select
                value={selectedUserId ?? ''}
                onChange={(e) => setSelectedUserId(e.target.value ? e.target.value : null)}
                disabled={pending || loadingUsers}
                className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="">Click para ligar usuario</option>
                {(assignable ?? []).map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {(u.fullName ?? u.email ?? u.userId) + (u.email && u.fullName ? ` — ${u.email}` : '')}
                  </option>
                ))}
              </select>
              {loadingUsers ? (
                <span className="text-xs text-gray-500">Cargando usuarios…</span>
              ) : null}
              {usersError ? (
                <span role="alert" className="text-xs text-red-600">{usersError}</span>
              ) : null}
              {!loadingUsers && !usersError && (assignable?.length ?? 0) === 0 ? (
                <span className="text-xs text-gray-500">No hay usuarios disponibles para vincular.</span>
              ) : null}
            </label>
          ) : null}

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={commitment}
              onChange={(e) => setCommitment(e.target.checked)}
              disabled={pending}
              className="h-4 w-4"
            />
            Compromiso de aportación mensual
          </label>

          {commitment ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Monto mensual
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number" min="0.01" step="0.01" disabled={pending}
                className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-sm font-medium">
            Notas <span className="font-normal text-gray-400">(opcional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500} rows={2} disabled={pending}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="min-h-touch rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-60 dark:border-gray-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || fullName.trim().length === 0}
              className="min-h-touch rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:opacity-90 disabled:opacity-60"
            >
              {pending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
