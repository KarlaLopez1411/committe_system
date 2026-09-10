'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { requestPasswordChangeAsGuestAction, decryptRecoveryTokenAction } from '@/server/actions/password-change-actions';

interface RequestChangeState {
  error?: string;
  message?: string;
}

const initialState: RequestChangeState = {};

/**
 * Pantalla de solicitud de cambio de contraseña.
 * Soporta dos flujos:
 * 1. Email directo: usuario ingresa su email
 * 2. Token: admin genera link con token encriptado (email pre-llenado)
 */
export function RecoverPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [state, setStateLocal] = useState<RequestChangeState>(initialState);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [isFromToken, setIsFromToken] = useState(false);

  // Si viene con token, desencriptar email automáticamente
  useEffect(() => {
    if (token) {
      decryptRecoveryTokenAction(token).then((decrypted) => {
        if (decrypted) {
          setEmail(decrypted);
          setIsFromToken(true);
          console.log('[CLIENT] Email pre-filled from token');
        }
      });
    }
  }, [token]);

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

      // Si viene con token, pasamos el token; sino, el email directo
      const input = token || emailTrimmed;
      const result = await requestPasswordChangeAsGuestAction(input);

      console.log('[CLIENT] Full response:', JSON.stringify(result, null, 2));

      if (result.ok) {
        setStateLocal({
          message: '✓ Solicitud enviada. El administrador la revisará y te proporcionará una nueva contraseña.',
        });
        setEmail('');
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
          El administrador revisará tu solicitud y te proporcionará una nueva contraseña.
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
            Correo electrónico {!isFromToken && '*'}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending || isFromToken}
              placeholder="tu@correo.com"
              required={!isFromToken}
              className="px-3 py-2 border border-gray-300 rounded-lg text-base disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
            />
            {isFromToken && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                ✓ Pre-llenado desde el link del administrador
              </p>
            )}
          </label>

          {state.error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || !email.trim()}
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
