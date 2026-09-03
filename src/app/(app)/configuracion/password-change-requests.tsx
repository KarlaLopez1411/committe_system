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
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  requestedAt: string;
  approvedAt?: string;
  rejectedReason?: string;
  passwordChangedAt?: string;
  temporaryPasswordUsedAt?: string;
  temporaryPassword?: string;
  onSuccess?: () => void;
}

const ITEMS_PER_PAGE = 20;

export function PasswordChangeRequestsTable({
  requests,
  onRefresh,
}: {
  requests: Array<{
    id: UUID;
    userName: string | null;
    status: string;
    reason?: string;
    requestedAt: string;
    approvedAt?: string;
    rejectedReason?: string;
    passwordChangedAt?: string;
    temporaryPasswordUsedAt?: string;
    temporaryPassword?: string;
  }>;
  onRefresh?: () => void;
}) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(requests.length / ITEMS_PER_PAGE);
  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIdx = startIdx + ITEMS_PER_PAGE;
  const paginatedRequests = requests.slice(startIdx, endIdx);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Historial de Solicitudes</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {requests.length} solicitudes total
        </p>
      </div>

      {requests.length === 0 ? (
        <p className="text-sm text-gray-500">No hay solicitudes registradas.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Usuario</th>
                  <th className="text-left px-4 py-2 font-medium">Estado</th>
                  <th className="text-left px-4 py-2 font-medium">Razón</th>
                  <th className="text-left px-4 py-2 font-medium">Fecha</th>
                  <th className="text-right px-4 py-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {paginatedRequests.map((req) => (
                  <PasswordChangeRequestRow
                    key={req.id}
                    id={req.id}
                    userName={req.userName}
                    status={req.status as 'pending' | 'approved' | 'rejected'}
                    reason={req.reason}
                    requestedAt={req.requestedAt}
                    approvedAt={req.approvedAt}
                    rejectedReason={req.rejectedReason}
                    passwordChangedAt={req.passwordChangedAt}
                    temporaryPasswordUsedAt={req.temporaryPasswordUsedAt}
                    temporaryPassword={req.temporaryPassword}
                    onSuccess={onRefresh}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 items-center mt-4">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                Anterior
              </button>
              <div className="flex gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-2 py-1 text-sm rounded ${
                      currentPage === page
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PasswordChangeRequestRow({
  id,
  userName,
  status,
  reason,
  requestedAt,
  rejectedReason,
  passwordChangedAt,
  temporaryPasswordUsedAt,
  temporaryPassword,
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

  const statusColor = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  };

  const statusLabel = {
    pending: 'Pendiente',
    approved: 'Aprobado',
    rejected: 'Rechazado',
  };

  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
        <td className="px-4 py-3">{userName || '—'}</td>
        <td className="px-4 py-3">
          <span className={`px-2 py-1 rounded text-xs font-semibold ${statusColor[status]}`}>
            {statusLabel[status]}
          </span>
        </td>
        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
          {reason ? reason.substring(0, 50) + (reason.length > 50 ? '...' : '') : '—'}
        </td>
        <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">
          {new Date(requestedAt).toLocaleDateString()} {new Date(requestedAt).toLocaleTimeString()}
        </td>
        <td className="px-4 py-3 text-right">
          {status === 'pending' && (
            <div className="flex justify-end gap-2">
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
            </div>
          )}
          {status === 'approved' && (
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex flex-col gap-1">
                <p className="text-gray-600 dark:text-gray-400">
                  {temporaryPasswordUsedAt ? '✓ Usada' : '— Pendiente uso'}
                </p>
                {passwordChangedAt && (
                  <p className="text-green-600 dark:text-green-400">
                    ✓ Cambiada: {new Date(passwordChangedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              {temporaryPassword && (
                <button
                  type="button"
                  onClick={() => setShowTempPassword(true)}
                  className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60"
                >
                  Ver contraseña
                </button>
              )}
            </div>
          )}
          {status === 'rejected' && rejectedReason && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {rejectedReason.substring(0, 30)}...
            </p>
          )}
        </td>
      </tr>
      {showTempPassword && (tempPassword || temporaryPassword) && (
        <tr className="bg-blue-50 dark:bg-blue-900/20">
          <td colSpan={5} className="px-4 py-4">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold">Contraseña temporal:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tempPassword || temporaryPassword || ''}
                  readOnly
                  className="flex-1 px-3 py-2 bg-white border border-blue-300 rounded font-mono text-sm dark:bg-gray-800 dark:border-blue-700"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(tempPassword || temporaryPassword || '');
                  }}
                  className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                >
                  Copiar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowTempPassword(false);
                    if (!tempPassword) onSuccess?.();
                  }}
                  className="px-3 py-2 bg-gray-600 text-white text-sm rounded hover:bg-gray-700"
                >
                  Cerrar
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
          <td colSpan={5} className="px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}
