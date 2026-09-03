'use client';

import { useState, useTransition } from 'react';
import type { UUID } from '@/domain/types';
import {
  approvePasswordChangeAction,
  rejectPasswordChangeAction,
} from '@/server/actions/password-change-actions';

interface PasswordChangeRequestProps {
  id: UUID;
  userName: string | null;
  reason?: string;
  requestedAt: string;
  onSuccess?: () => void;
}

export function PasswordChangeRequestsTable({
  requests,
  onRefresh,
}: {
  requests: Array<{
    id: UUID;
    userName: string | null;
    reason?: string;
    requestedAt: string;
  }>;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold">Solicitudes Pendientes</h3>
      {requests.length === 0 ? (
        <p className="text-sm text-gray-500">No hay solicitudes pendientes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Usuario</th>
                <th className="text-left px-4 py-2 font-medium">Razón</th>
                <th className="text-left px-4 py-2 font-medium">Solicitado</th>
                <th className="text-right px-4 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {requests.map((req) => (
                <PasswordChangeRequestRow
                  key={req.id}
                  {...req}
                  onSuccess={onRefresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PasswordChangeRequestRow({
  id,
  userName,
  reason,
  requestedAt,
  onSuccess,
}: PasswordChangeRequestProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showTempPassword, setShowTempPassword] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const handleApprove = async () => {
    setError(null);
    startTransition(async () => {
      const result = await approvePasswordChangeAction(id);
      if (result.ok) {
        setTempPassword(result.value.temporaryPassword);
        setShowTempPassword(true);
        // NO recargar automáticamente: dejar que admin copie la contraseña primero
      } else {
        setError(result.error.message);
      }
    });
  };

  const handleReject = async () => {
    if (!window.confirm('¿Rechazar esta solicitud?')) return;
    setError(null);
    startTransition(async () => {
      const result = await rejectPasswordChangeAction(id);
      if (result.ok) {
        onSuccess?.();
      } else {
        setError(result.error.message);
      }
    });
  };

  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
        <td className="px-4 py-3">{userName || '—'}</td>
        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
          {reason ? reason.substring(0, 50) + (reason.length > 50 ? '...' : '') : '—'}
        </td>
        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
          {new Date(requestedAt).toLocaleDateString()}
        </td>
        <td className="px-4 py-3 text-right flex justify-end gap-2">
          <button
            onClick={handleApprove}
            disabled={isPending || showTempPassword}
            className="px-3 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200 disabled:opacity-60 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60"
          >
            {isPending ? 'Procesando...' : 'Aprobar'}
          </button>
          <button
            onClick={handleReject}
            disabled={isPending || showTempPassword}
            className="px-3 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200 disabled:opacity-60 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60"
          >
            Rechazar
          </button>
        </td>
      </tr>
      {showTempPassword && tempPassword && (
        <tr className="bg-blue-50 dark:bg-blue-900/20">
          <td colSpan={4} className="px-4 py-4">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold">Contraseña temporal:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tempPassword}
                  readOnly
                  className="flex-1 px-3 py-2 bg-white border border-blue-300 rounded font-mono text-sm dark:bg-gray-800 dark:border-blue-700"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(tempPassword);
                  }}
                  className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                >
                  Copiar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowTempPassword(false);
                    onSuccess?.();
                  }}
                  className="px-3 py-2 bg-gray-600 text-white text-sm rounded hover:bg-gray-700"
                >
                  Listo
                </button>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Comparte esta contraseña al usuario. Deberá cambiarla al ingresar.
              </p>
            </div>
          </td>
        </tr>
      )}
      {error && (
        <tr className="bg-red-50 dark:bg-red-900/20">
          <td colSpan={4} className="px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}
