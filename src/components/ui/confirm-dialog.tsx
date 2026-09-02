'use client';

import { useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  /** Controla la visibilidad del diálogo. */
  open: boolean;
  /** Título breve de la acción a confirmar. */
  title: string;
  /** Descripción del efecto de la acción (idealmente sus consecuencias). */
  description: string;
  /** Texto del botón de confirmación. Por defecto "Confirmar". */
  confirmLabel?: string;
  /** Texto del botón de cancelación. Por defecto "Cancelar". */
  cancelLabel?: string;
  /**
   * Marca la acción como destructiva para resaltar visualmente el botón de
   * confirmación (rojo). Útil para eliminaciones/anulaciones.
   */
  destructive?: boolean;
  /** Indica que la acción está en curso (deshabilita botones). */
  pending?: boolean;
  /** Callback al confirmar explícitamente. */
  onConfirm: () => void;
  /** Callback al cancelar o cerrar el diálogo. */
  onCancel: () => void;
}

/**
 * Diálogo de confirmación explícita para acciones críticas (Requirement 42.3).
 *
 * Bloquea la ejecución de la acción hasta que el usuario confirme de forma
 * explícita mediante el botón de confirmación. Es accesible (rol `dialog`,
 * `aria-modal`, foco inicial en cancelar, cierre con Escape) y mobile-first:
 * ocupa el ancho disponible en pantallas pequeñas con botones de toque cómodo.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    // Enfoca el botón menos destructivo por defecto.
    cancelRef.current?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) {
        onCancel();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, pending, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={() => {
        if (!pending) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl dark:bg-gray-900 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p
          id="confirm-dialog-description"
          className="mt-2 text-sm text-gray-600 dark:text-gray-300"
        >
          {description}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="min-h-touch rounded-lg border border-gray-300 px-4 py-2 text-base font-medium disabled:opacity-60 dark:border-gray-700"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={[
              'min-h-touch rounded-lg px-4 py-2 text-base font-medium text-white disabled:opacity-60',
              destructive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-brand hover:opacity-90',
            ].join(' ')}
          >
            {pending ? 'Procesando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
