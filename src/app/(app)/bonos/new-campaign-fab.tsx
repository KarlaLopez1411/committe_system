'use client';

import { useEffect, useState } from 'react';

import { CampaignForm } from './campaign-form';

/**
 * Botón flotante (FAB) para crear una campaña de bonos.
 *
 * Reemplaza el formulario inline de la tab de bonos: al hacer clic abre un
 * formulario en un modal (popup). El modal es accesible (rol `dialog`,
 * `aria-modal`, cierre con Escape y clic en el fondo) y mobile-first.
 */
export function NewCampaignFab() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <>
      {/* FAB fijo, por encima de la barra inferior de navegación en móvil. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Agregar campaña"
        className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-3xl leading-none text-brand-fg shadow-lg hover:opacity-90 lg:bottom-8 lg:right-8"
      >
        <span aria-hidden="true" className="-mt-1">+</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-campaign-title"
            className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl dark:bg-gray-900 sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 id="new-campaign-title" className="text-lg font-semibold">Nueva campaña</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="rounded-lg px-2 py-1 text-xl leading-none text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                ×
              </button>
            </div>
            <CampaignForm onCreated={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
