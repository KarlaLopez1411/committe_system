'use client';

import { useState } from 'react';

/**
 * Tarjeta que muestra el código del comité para compartir con nuevos miembros.
 * Incluye un botón para copiarlo al portapapeles.
 */
export function CommitteeCodeCard({ code }: { code: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!code) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Este comité aún no tiene código de invitación.
      </div>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignora si el navegador no permite portapapeles */
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Código del comité</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Comparte este código para que nuevas personas se unan al comité desde la pantalla de registro.
      </p>
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-gray-100 px-4 py-2 font-mono text-xl font-bold tracking-widest dark:bg-gray-800">
          {code}
        </span>
        <button
          type="button"
          onClick={copy}
          className="min-h-touch rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {copied ? '¡Copiado!' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}
