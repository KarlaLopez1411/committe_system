import type { ReactNode } from 'react';

import { AppLogo } from '@/components/ui/app-logo';

/**
 * Layout de las pantallas de autenticación (login, registro, recuperación,
 * selección de comité). Centrado y mobile-first: una sola columna cómoda en
 * teléfonos que se limita en ancho en pantallas grandes (Requirements 42.1, 43.1).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-screen-sm flex-col justify-center gap-8 px-4 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <AppLogo size={432} className="h-auto max-w-full" />
      </header>
      {children}
    </main>
  );
}
