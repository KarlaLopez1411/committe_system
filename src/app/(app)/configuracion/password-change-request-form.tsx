'use client';

import { useState, useTransition } from 'react';
import { requestPasswordChangeAction } from '@/server/actions/password-change-actions';

export function PasswordChangeRequestForm() {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    startTransition(async () => {
      console.log('[DEBUG] Enviando solicitud de cambio de contraseña...');
      const result = await requestPasswordChangeAction(undefined, reason || undefined);
      console.log('[DEBUG] Respuesta:', result);
      if (result.ok) {
        setSuccess(true);
        setReason('');
      } else {
        setError(result.error.message);
      }
    });
  };

  if (success) {
    return (
      <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800 dark:bg-green-900/40 dark:text-green-300">
        <p className="font-semibold">Solicitud enviada</p>
        <p className="mt-1">Tu solicitud de cambio de contraseña ha sido registrada. Contacta al administrador para obtener tu nueva contraseña.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <h3 className="text-lg font-semibold">Solicitar Cambio de Contraseña</h3>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Solicita un cambio de contraseña. El administrador deberá aprobar tu solicitud y generará una nueva contraseña para ti.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Razón (opcional)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isPending}
            placeholder="Describe por qué necesitas cambiar tu contraseña..."
            className="px-3 py-2 border border-gray-300 rounded-lg text-base resize-none disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            rows={3}
          />
        </label>

        {error && (
          <div role="alert" className="px-3 py-2 bg-red-50 text-red-700 text-sm rounded-lg dark:bg-red-900/40 dark:text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition"
        >
          {isPending ? 'Enviando solicitud…' : 'Solicitar Cambio'}
        </button>
      </form>
    </div>
  );
}
