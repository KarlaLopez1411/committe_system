'use client';

import { useState } from 'react';
import { generateRecoveryLink } from '@/server/actions/password-change-actions';

interface RecoveryLinkGeneratorProps {
  userEmail: string;
  userName: string;
}

export function RecoveryLinkGenerator({ userEmail, userName }: RecoveryLinkGeneratorProps) {
  const [showLink, setShowLink] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerateLink = () => {
    const generatedLink = generateRecoveryLink(userEmail);
    setLink(generatedLink);
    setShowLink(true);
  };

  const handleCopyLink = () => {
    if (link) {
      navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {!showLink ? (
        <button
          onClick={handleGenerateLink}
          className="px-3 py-1 text-xs bg-purple-100 text-purple-800 rounded hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-900/60"
          title={`Generar link de recuperación para ${userName}`}
        >
          📧 Generar link
        </button>
      ) : (
        <div className="flex flex-col gap-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded border border-purple-200 dark:border-purple-800">
          <p className="text-xs font-semibold text-purple-900 dark:text-purple-200">
            Link de recuperación para {userName}:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={link || ''}
              readOnly
              className={`flex-1 px-2 py-1 text-xs font-mono bg-white border rounded dark:bg-gray-800 transition-colors ${
                copied
                  ? 'border-green-500 bg-green-50 dark:border-green-500 dark:bg-green-900/20'
                  : 'border-purple-300 dark:border-purple-700'
              }`}
            />
            <button
              onClick={handleCopyLink}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                copied
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-purple-600 text-white hover:bg-purple-700'
              }`}
            >
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            ℹ️ Comparte este link con el usuario. El email estará pre-llenado cuando lo abra.
          </p>
          <button
            onClick={() => setShowLink(false)}
            className="px-2 py-1 text-xs bg-gray-300 text-gray-800 rounded hover:bg-gray-400 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}
