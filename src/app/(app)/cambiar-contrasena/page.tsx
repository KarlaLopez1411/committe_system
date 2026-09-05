'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changePasswordAction } from '@/server/actions/password-change-actions';

export default function ForcePasswordChangePage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    startTransition(async () => {
      const result = await changePasswordAction(password);
      if (result.ok) {
        router.push('/');
      } else {
        setError(result.error.message);
      }
    });
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 px-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Cambio Obligatorio de Contraseña
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
            Tu administrador te ha solicitado cambiar tu contraseña. Por favor,
            ingresa una nueva contraseña segura.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Nueva contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
              required
              minLength={12}
              placeholder="Mín. 12 caracteres"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">
              Debe contener mayúsculas, minúsculas, números y símbolos.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Confirmar contraseña
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={isPending}
              required
              minLength={12}
              placeholder="Confirma tu contraseña"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          {error && (
            <div role="alert" className="px-3 py-2 bg-red-50 text-red-700 text-sm rounded-lg dark:bg-red-900/40 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending || !password || !confirm}
            className="w-full mt-4 px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition"
          >
            {isPending ? 'Cambiando contraseña…' : 'Cambiar Contraseña'}
          </button>
        </form>

        <p className="mt-6 text-xs text-gray-500 dark:text-gray-400 text-center">
          No puedes salir de esta página hasta cambiar tu contraseña.
        </p>
      </div>
    </div>
  );
}
