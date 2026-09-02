'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { UUID } from '@/domain/types';
import type {
  SellerWithAssignments,
  UnassignedNumber,
} from '@/server/bonus-campaign-service';
import {
  createSellerAction,
  deleteSellerAction,
  paySellerMonthAction,
  setSellerNumbersAction,
  updateSellerAction,
} from '@/server/actions/bonus-actions';
import { CheckIcon, CloseIcon, EditIcon, PayIcon, TrashIcon } from '@/components/ui/icons';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Gestión de responsables (vendedores) de la campaña.
 *
 * Muestra una tabla con: Nombre, Teléfono, Números registrados y Total (el
 * total se calcula solo a partir de los números asignados). Debajo, un
 * formulario de alta con nombre, teléfono opcional y un selector múltiple
 * (combobox) con los números aún NO asignados de la campaña; el usuario puede
 * elegir varios y se asignan al responsable al momento del alta.
 */
export function SellerManager({
  campaignId,
  sellers,
  unassignedNumbers,
  canManage = false,
}: {
  campaignId: UUID;
  sellers: SellerWithAssignments[];
  unassignedNumbers: UnassignedNumber[];
  /** bonuses.manage/committee.manage: alta, edición, pago y asignación. */
  canManage?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Mes de pago seleccionado por responsable (1–12); por defecto el mes actual.
  const currentMonth = new Date().getMonth() + 1;
  const [payMonth, setPayMonth] = useState<Record<string, number>>({});
  const [payMsg, setPayMsg] = useState<string | null>(null);

  function paySeller(s: SellerWithAssignments) {
    const month = payMonth[s.id] ?? currentMonth;
    setRowError(null);
    setPayMsg(null);
    startTransition(async () => {
      const result = await paySellerMonthAction(s.id as UUID, campaignId, month);
      if (!result.ok) { setRowError(result.error.message); return; }
      setPayMsg(
        `Pago registrado: ${s.displayName} · ${MONTH_NAMES[month - 1]} · ${result.value.count} número(s) · $${result.value.amount}.`,
      );
      router.refresh();
    });
  }

  // Estado de edición inline por responsable.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  // Números seleccionados durante la edición (ids de bonus_number).
  const [editNumbers, setEditNumbers] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<string | null>(null);

  function startEdit(s: SellerWithAssignments) {
    setRowError(null);
    setEditingId(s.id);
    setEditName(s.displayName);
    setEditPhone(s.phone ?? '');
    setEditNumbers(new Set(s.assigned.map((a) => a.bonusNumberId)));
  }

  function cancelEdit() {
    setEditingId(null);
    setRowError(null);
  }

  function toggleEditNumber(id: string) {
    setEditNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function saveEdit(s: SellerWithAssignments) {
    setRowError(null);
    const originalNumbers = new Set(s.assigned.map((a) => a.bonusNumberId));
    const numbersChanged =
      originalNumbers.size !== editNumbers.size ||
      [...editNumbers].some((id) => !originalNumbers.has(id));

    startTransition(async () => {
      const result = await updateSellerAction(s.id as UUID, {
        displayName: editName,
        phone: editPhone.trim() || null,
      });
      if (!result.ok) { setRowError(result.error.message); return; }

      if (numbersChanged) {
        const numResult = await setSellerNumbersAction(
          s.id as UUID,
          campaignId,
          Array.from(editNumbers) as UUID[],
        );
        if (!numResult.ok) { setRowError(numResult.error.message); return; }
      }

      setEditingId(null);
      router.refresh();
    });
  }

  function removeSeller(s: SellerWithAssignments) {
    const msg = s.totalNumbers > 0
      ? `¿Eliminar a "${s.displayName}"? Se liberarán sus ${s.totalNumbers} número(s) asignado(s).`
      : `¿Eliminar a "${s.displayName}"?`;
    if (!window.confirm(msg)) return;
    setRowError(null);
    startTransition(async () => {
      const result = await deleteSellerAction(s.id as UUID);
      if (!result.ok) { setRowError(result.error.message); return; }
      router.refresh();
    });
  }

  function toggleNumber(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createSellerAction({
        displayName: name,
        phone: phone.trim() || null,
        bonusNumberIds: Array.from(selected) as UUID[],
      });
      if (!result.ok) { setError(result.error.message); return; }
      setName('');
      setPhone('');
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Responsables</h2>

      {/* Tabla de responsables */}
      {rowError ? <p role="alert" className="text-sm text-red-600">{rowError}</p> : null}
      {payMsg ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{payMsg}</p> : null}
      {sellers.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Aún no hay responsables registrados.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left dark:border-gray-800">
                <th className="px-2 py-2 font-semibold">Nombre</th>
                <th className="px-2 py-2 font-semibold">Teléfono</th>
                <th className="px-2 py-2 font-semibold">Números registrados</th>
                <th className="px-2 py-2 font-semibold">Total</th>
                {canManage ? <th className="px-2 py-2 font-semibold">Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => {
                const isEditing = editingId === s.id;
                return (
                  <tr key={s.id} className="border-b border-gray-100 align-top dark:border-gray-900">
                    <td className="px-2 py-2 font-medium">
                      {isEditing ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          minLength={2}
                          maxLength={150}
                          disabled={isPending}
                          className="min-h-touch w-full max-w-[180px] rounded-lg border border-gray-300 bg-white px-2 py-1 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
                        />
                      ) : (
                        s.displayName
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {isEditing ? (
                        <input
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          type="tel"
                          inputMode="tel"
                          maxLength={30}
                          placeholder="Opcional"
                          disabled={isPending}
                          className="min-h-touch w-full max-w-[140px] rounded-lg border border-gray-300 bg-white px-2 py-1 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
                        />
                      ) : (
                        s.phone ?? '—'
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {isEditing ? (
                        <EditNumbersPicker
                          options={[...s.assigned, ...unassignedNumbers]
                            .sort((a, b) => a.number - b.number)}
                          selected={editNumbers}
                          onToggle={toggleEditNumber}
                          disabled={isPending}
                        />
                      ) : s.assignedNumbers.length > 0 ? (
                        <span className="tabular-nums">{s.assignedNumbers.join(', ')}</span>
                      ) : (
                        <span className="text-gray-400">Sin números</span>
                      )}
                    </td>
                    <td className="px-2 py-2 font-semibold tabular-nums">
                      {isEditing ? editNumbers.size : s.totalNumbers}
                    </td>
                    {canManage ? (
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEdit(s)}
                              disabled={isPending || editName.trim().length < 2}
                              aria-label="Guardar"
                              title="Guardar"
                              className="rounded-lg border border-green-500 p-1.5 text-green-700 hover:bg-green-50 disabled:opacity-60 dark:text-green-300 dark:hover:bg-green-950"
                            >
                              <CheckIcon />
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={isPending}
                              aria-label="Cancelar"
                              title="Cancelar"
                              className="rounded-lg border border-gray-300 p-1.5 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800"
                            >
                              <CloseIcon />
                            </button>
                          </>
                        ) : (
                          <>
                            {/* Combo de mes + botón de pago mensual */}
                            <select
                              value={payMonth[s.id] ?? currentMonth}
                              onChange={(e) => setPayMonth((m) => ({ ...m, [s.id]: Number(e.target.value) }))}
                              disabled={isPending}
                              aria-label="Mes a pagar"
                              className="min-h-touch rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
                            >
                              {MONTH_NAMES.map((label, i) => (
                                <option key={label} value={i + 1}>{label}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => paySeller(s)}
                              disabled={isPending || s.totalNumbers === 0}
                              aria-label="Registrar pago del mes"
                              title="Registrar pago del mes"
                              className="rounded-lg border border-brand p-1.5 text-brand hover:bg-brand/10 disabled:opacity-60"
                            >
                              <PayIcon />
                            </button>
                            <button
                              type="button"
                              onClick={() => startEdit(s)}
                              disabled={isPending}
                              aria-label="Editar"
                              title="Editar"
                              className="rounded-lg border border-gray-300 p-1.5 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800"
                            >
                              <EditIcon />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeSeller(s)}
                              disabled={isPending}
                              aria-label="Eliminar"
                              title="Eliminar"
                              className="rounded-lg border border-red-300 p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
                            >
                              <TrashIcon />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Formulario de alta (solo con permiso de gestión) */}
      {canManage ? (
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 border-t border-gray-100 pt-4 dark:border-gray-900">
        <h3 className="text-sm font-medium">Agregar responsable</h3>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Nombre
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={150}
              placeholder="Ej. Juan Pérez"
              disabled={isPending}
              className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Teléfono <span className="font-normal text-gray-400">(opcional)</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              inputMode="tel"
              maxLength={30}
              placeholder="Ej. 55 1234 5678"
              disabled={isPending}
              className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
        </div>

        {/* Combobox múltiple de números NO asignados */}
        <div className="flex flex-col gap-1 text-sm font-medium">
          <span>
            Números a asignar{' '}
            <span className="font-normal text-gray-400">
              ({selected.size} seleccionado{selected.size === 1 ? '' : 's'} · {unassignedNumbers.length} disponible{unassignedNumbers.length === 1 ? '' : 's'})
            </span>
          </span>
          {unassignedNumbers.length === 0 ? (
            <p className="text-sm font-normal text-gray-500 dark:text-gray-400">
              No hay números disponibles para asignar.
            </p>
          ) : (
            <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto rounded-lg border border-gray-300 p-2 dark:border-gray-700">
              {unassignedNumbers.map((n) => {
                const isSelected = selected.has(n.bonusNumberId);
                return (
                  <button
                    key={n.bonusNumberId}
                    type="button"
                    onClick={() => toggleNumber(n.bonusNumberId)}
                    disabled={isPending}
                    aria-pressed={isSelected}
                    className={[
                      'min-w-[44px] rounded-lg px-2 py-1 text-sm font-medium tabular-nums disabled:opacity-60',
                      isSelected
                        ? 'bg-brand text-brand-fg'
                        : 'border border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800',
                    ].join(' ')}
                  >
                    {n.number}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={isPending || name.trim().length < 2}
          className="min-h-touch w-fit rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? 'Guardando…' : 'Agregar responsable'}
        </button>
      </form>
      ) : null}
    </div>
  );
}

/**
 * Selector múltiple de números para el modo edición del responsable.
 * Muestra los números que puede tener asignados: los suyos actuales (ya
 * seleccionados) más los que están libres en la campaña.
 */
function EditNumbersPicker({
  options,
  selected,
  onToggle,
  disabled,
}: {
  options: { bonusNumberId: UUID; number: number }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  if (options.length === 0) {
    return <span className="text-gray-400">Sin números disponibles</span>;
  }
  return (
    <div className="flex max-h-40 max-w-[320px] flex-wrap gap-1 overflow-y-auto rounded-lg border border-gray-300 p-2 dark:border-gray-700">
      {options.map((n) => {
        const isSelected = selected.has(n.bonusNumberId);
        return (
          <button
            key={n.bonusNumberId}
            type="button"
            onClick={() => onToggle(n.bonusNumberId)}
            disabled={disabled}
            aria-pressed={isSelected}
            className={[
              'min-w-[40px] rounded-lg px-2 py-1 text-xs font-medium tabular-nums disabled:opacity-60',
              isSelected
                ? 'bg-brand text-brand-fg'
                : 'border border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800',
            ].join(' ')}
          >
            {n.number}
          </button>
        );
      })}
    </div>
  );
}
