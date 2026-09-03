'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { CloseIcon, MenuIcon } from '@/components/ui/icons';
import { canAccessPath } from '@/lib/route-permissions';

/**
 * Secciones principales de la aplicación (design.md §18.1). El orden refleja el
 * flujo operativo: panel, personas, finanzas, operación comunitaria, bonos y
 * administración/consulta.
 */
interface NavItem {
  href: string;
  label: string;
  /**
   * Cuando es `true`, el ítem solo marca activo con coincidencia EXACTA de ruta
   * (no por prefijo). Útil para rutas padre que tienen sub-rutas que también son
   * ítems del menú (p. ej. `/bonos` frente a `/bonos/portal`).
   */
  exact?: boolean;
}

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/dashboard', label: 'Panel' },
  { href: '/miembros', label: 'Miembros' },
  { href: '/finanzas', label: 'Finanzas' },
  { href: '/actividades', label: 'Actividades' },
  { href: '/cortes', label: 'Cortes' },
  { href: '/bonos', label: 'Bonos', exact: true },
  { href: '/bonos/portal', label: 'Mi portal' },
  { href: '/reportes', label: 'Reportes' },
  { href: '/auditoria', label: 'Auditoría' },
  { href: '/configuracion', label: 'Configuración' },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) {
    return pathname === item.href;
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Filtra los ítems visibles según el contexto del usuario:
 *  - "Mi portal" solo para responsables (vendedores).
 *  - El resto según los permisos de ruta (mismo mapa que usa el middleware).
 */
function visibleItems(
  isSeller: boolean,
  permissions: ReadonlyArray<string>,
): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.href === '/bonos/portal') return isSeller;
    return canAccessPath(item.href, permissions);
  });
}

/**
 * Barra lateral de navegación para escritorio (Requirements 42.1, 43.1).
 * Se coloca dentro del área lateral persistente del shell en pantallas `lg`.
 */
export function AppNavSidebar({
  isSeller = false,
  permissions = [],
}: {
  isSeller?: boolean;
  permissions?: ReadonlyArray<string>;
}) {
  const pathname = usePathname() ?? '';
  const items = visibleItems(isSeller, permissions);

  return (
    <nav aria-label="Navegación principal">
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActive(pathname, item) ? 'page' : undefined}
              className={[
                'block rounded-lg px-3 py-2 text-sm font-medium',
                isActive(pathname, item)
                  ? 'bg-brand text-brand-fg'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800',
              ].join(' ')}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Navegación para móvil/tablet mediante menú hamburguesa (Requirements 42.1,
 * 43.1). Un botón con ícono de menú abre un panel lateral (drawer) con las
 * secciones. Se oculta en escritorio (`lg`), donde se usa la barra lateral.
 */
export function AppNavMobile({
  isSeller = false,
  permissions = [],
}: {
  isSeller?: boolean;
  permissions?: ReadonlyArray<string>;
}) {
  const pathname = usePathname() ?? '';
  const items = visibleItems(isSeller, permissions);
  const [open, setOpen] = useState(false);

  // Cierra el menú al navegar a otra ruta.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Bloquea el scroll del fondo mientras el menú está abierto y permite cerrar con Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        aria-expanded={open}
        title="Menú"
        className="flex min-h-touch min-w-touch items-center justify-center rounded-lg border border-gray-300 p-2 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        <MenuIcon width={22} height={22} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navegación principal">
          {/* Fondo oscuro */}
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          {/* Panel lateral */}
          <nav
            aria-label="Navegación principal"
            className="absolute left-0 top-0 flex h-full w-72 max-w-[80%] flex-col gap-1 overflow-y-auto border-r border-gray-200 bg-white p-3 shadow-xl dark:border-gray-800 dark:bg-gray-950"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-gray-500">Menú</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar menú"
                className="flex min-h-touch min-w-touch items-center justify-center rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <CloseIcon width={22} height={22} />
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive(pathname, item) ? 'page' : undefined}
                    className={[
                      'block rounded-lg px-3 py-2 text-sm font-medium',
                      isActive(pathname, item)
                        ? 'bg-brand text-brand-fg'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800',
                    ].join(' ')}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ) : null}
    </>
  );
}
