import type { ReactNode } from 'react';

import { AppNavMobile, AppNavSidebar } from '@/components/app-nav';
import { AppLogo } from '@/components/ui/app-logo';
import { LogoutIcon } from '@/components/ui/icons';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActionCtx } from '@/server/actions/resolve-ctx';

import { signOutAction } from '../(auth)/actions';

/**
 * Indica si el usuario autenticado tiene un perfil de responsable (vendedor)
 * ligado a su cuenta en el comité activo. Solo entonces se muestra "Mi portal".
 */
async function resolveIsSeller(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    // Es "responsable" si tiene un perfil de vendedor (bonus_sellers) ligado a
    // su cuenta. Este es exactamente el requisito para que `/bonos/portal`
    // resuelva sus asignaciones, por lo que el menú coincide con lo que la
    // página del portal puede mostrar. (Un admin sin perfil de vendedor NO ve
    // la pestaña, aunque tenga el rol bonus_seller por ser creador del comité.)
    const { data: sellerRow } = await supabase
      .from('bonus_sellers')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    return Boolean(sellerRow);
  } catch {
    return false;
  }
}

/**
 * Shell de la aplicación autenticada (Requirements 42.1, 43.1).
 *
 * Layout responsivo mobile-first:
 *  - En teléfonos/tablet: encabezado superior fijo con menú hamburguesa
 *    (`AppNavMobile`) que abre un panel lateral con las secciones.
 *  - En escritorio (`lg`): barra lateral de navegación persistente a la
 *    izquierda (`AppNavSidebar`) y contenido a la derecha.
 *
 * El encabezado incluye la acción de cierre de sesión (R4.6). Las secciones se
 * enrutan bajo este grupo de rutas `(app)` y comparten este shell.
 */
export default async function AppShellLayout({ children }: { children: ReactNode }) {
  const isSeller = await resolveIsSeller();
  const ctx = await resolveActionCtx();
  const permissions = ctx?.permissions ?? [];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      {/* Barra lateral (solo escritorio) */}
      <aside className="hidden border-r border-gray-200 p-4 dark:border-gray-800 lg:block">
        <div className="mb-6 flex items-center justify-center">
          <AppLogo size={240} className="h-auto max-w-full" />
        </div>
        <AppNavSidebar isSeller={isSeller} permissions={permissions} />
      </aside>

      <div className="flex min-h-screen flex-col">
        {/* Encabezado superior */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center gap-2 lg:hidden">
            {/* Menú hamburguesa (tablet y menor) */}
            <AppNavMobile isSeller={isSeller} permissions={permissions} />
            {/* Logo específico para móvil (sin el texto "SAC"). */}
            <AppLogo src="/logo-mobile.png" size={160} className="h-auto max-w-[160px]" />
          </div>
          <span className="hidden font-semibold lg:inline">
            Sistema de Administración Comunitaria
          </span>
          <form action={signOutAction}>
            <button
              type="submit"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="flex min-h-touch min-w-touch items-center justify-center rounded-lg border border-gray-300 p-2 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              <LogoutIcon width={22} height={22} />
            </button>
          </form>
        </header>

        {/* Contenido principal. */}
        <main className="flex-1 px-4 py-4 pb-6">{children}</main>
      </div>
    </div>
  );
}
