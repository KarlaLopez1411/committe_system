'use client';

import Link from 'next/link';
import { useState } from 'react';

import { requestPasswordChangeAsGuestAction } from '@/server/actions/password-change-actions';

interface RequestChangeState {
  error?: string;
  message?: string;
}

const initialState: RequestChangeState = {};

/**
 * Pantalla de solicitud de cambio de contraseña (reemplazo de recuperación vía email).
 *
 * El usuario (autenticado o no) solicita un cambio de contraseña. El admin lo aprueba desde
 * /configuracion y genera una contraseña temporal que comparte manualmente.
 */
export default function RecoverPasswordPage() {
  const [state, setStateLocal] = useState<RequestChangeState>(initialState);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const emailTrimmed = email.trim();

    setStateLocal({ error: undefined, message: undefined });

    // Validar email
    if (!emailTrimmed || !emailTrimmed.includes('@')) {
      setStateLocal({ error: 'Por favor ingresa un correo válido.' });
      return;
    }

    setPending(true);

    try {
      console.log('[CLIENT] Submitting password change request with email:', emailTrimmed);

      // Siempre usar guest action con email
      const result = await requestPasswordChangeAsGuestAction(emailTrimmed, reason || undefined);

      console.log('[CLIENT] Response:', result);

      if (result.ok) {
        setStateLocal({
          message: '✓ Solicitud enviada. El administrador la revisará y te proporcionará una nueva contraseña.',
        });
        setEmail('');
        setReason('');
      } else {
        setStateLocal({ error: result.error.message });
      }
    } catch (err) {
      console.error('[CLIENT] Exception:', err);
      setStateLocal({ error: 'Error al enviar la solicitud. Intenta de nuevo.' });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Solicitar cambio de contraseña</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Solicita un cambio de contraseña. El administrador lo revisará y te proporcionará una nueva contraseña.
        </p>
      </div>

      {state.message ? (
        <div>
          <p
            role="status"
            className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-200 mb-4"
          >
            {state.message}
          </p>
          <div className="text-center">
            <Link href="/login" className="font-medium text-brand hover:underline">
              Volver a iniciar sesión
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Correo electrónico *
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              placeholder="tu@correo.com"
              required
              className="px-3 py-2 border border-gray-300 rounded-lg text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Razón (opcional)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={pending}
              placeholder="¿Por qué necesitas cambiar tu contraseña?"
              className="px-3 py-2 border border-gray-300 rounded-lg text-base resize-none disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
              rows={3}
            />
          </label>

          {state.error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Enviando…' : 'Solicitar cambio'}
          </button>
        </form>
      )}

      <div className="text-center text-sm">
        <Link href="/login" className="font-medium text-brand hover:underline">
          Volver a iniciar sesión
        </Link>
      </div>
    </section>
  );
}
