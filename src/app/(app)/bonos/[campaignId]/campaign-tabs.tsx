'use client';

import { useState, type ReactNode } from 'react';

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Contenedor de pestañas para la página de detalle de campaña.
 *
 * Recibe las secciones ya renderizadas (server components) como contenido de
 * cada pestaña y alterna cuál se muestra. Mobile-first: la barra de pestañas
 * hace scroll horizontal en pantallas chicas.
 */
export function CampaignTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Secciones de la campaña" className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              className={[
                'shrink-0 border-b-2 px-4 py-2 text-sm font-medium',
                isActive
                  ? 'border-brand text-brand'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={t.id !== active}>
          {t.id === active ? t.content : null}
        </div>
      ))}
    </div>
  );
}
