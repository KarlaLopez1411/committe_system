'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Botón flotante (FAB) que abre contenido en un modal (pop-up).
 *
 * Reutilizable: recibe el contenido como render-prop `children(close)` para que
 * el formulario pueda cerrar el modal al terminar. Accesible (rol dialog,
 * aria-modal, cierre con Escape / clic en el fondo / botón ×) y mobile-first.
 */
export function FabModal({
  label,
  title,
  children,
}: {
  /** Texto accesible del FAB (aria-label) y título por defecto del modal. */
  label: string;
  /** Título mostrado en el encabezado del modal. */
  title?: string;
  /** Contenido del modal; recibe `close` para cerrarlo al terminar. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-3xl leading-none text-brand-fg shadow-lg hover:opacity-90 lg:bottom-8 lg:right-8"
      >
        <span aria-hidden="true" className="-mt-1">+</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title ?? label}
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-gray-900 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{title ?? label}</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Cerrar"
                className="rounded-lg px-2 py-1 text-xl leading-none text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                ×
              </button>
            </div>
            {children(close)}
          </div>
        </div>
      ) : null}
    </>
  );
}
