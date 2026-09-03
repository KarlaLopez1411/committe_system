/**
 * Mapa declarativo de permiso mínimo requerido por ruta.
 *
 * Es la única fuente de verdad para:
 *  - el middleware (bloquea la navegación redirigiendo si falta el permiso),
 *  - la barra de navegación (oculta los enlaces sin permiso).
 *
 * No importa nada `server-only` para poder usarse en middleware (edge) y en
 * componentes cliente. Los permisos coinciden con los checks de los servicios.
 *
 * Reglas:
 *  - Se elige la entrada cuyo `prefix` coincide de forma más específica (más
 *    larga) con la ruta.
 *  - `permission: null` → ruta permitida para cualquier usuario autenticado.
 */
export interface RoutePermission {
  /** Prefijo de ruta (coincide exacto o como `${prefix}/...`). */
  prefix: string;
  /** Permiso mínimo; `null` = sin requisito adicional. */
  permission: string | null;
}

/** Ordenadas por especificidad descendente (prefijos más largos primero). */
export const ROUTE_PERMISSIONS: ReadonlyArray<RoutePermission> = [
  { prefix: '/dashboard', permission: null },
  { prefix: '/miembros', permission: 'members.read' },
  { prefix: '/finanzas', permission: 'transactions.read' },
  { prefix: '/actividades', permission: 'members.read' },
  { prefix: '/cortes', permission: 'transactions.read' },
  { prefix: '/bonos/portal', permission: 'bonuses.read' },
  { prefix: '/bonos', permission: 'bonuses.read' },
  { prefix: '/reportes', permission: 'reports.read' },
  { prefix: '/auditoria', permission: 'audit.read' },
  // Configuración: ver es abierto; la edición y la gestión de usuarios se
  // controlan dentro de la página (committee.manage / users.manage).
  { prefix: '/configuracion', permission: null },
];

/** Devuelve el permiso requerido por la ruta, o `null` si no requiere ninguno. */
export function requiredPermissionForPath(pathname: string): string | null {
  let best: RoutePermission | null = null;
  for (const entry of ROUTE_PERMISSIONS) {
    const matches = pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`);
    if (matches && (!best || entry.prefix.length > best.prefix.length)) {
      best = entry;
    }
  }
  return best ? best.permission : null;
}

/**
 * Indica si un conjunto de permisos (o superadmin) puede acceder a la ruta.
 * Un `permission` requerido `null` siempre permite.
 */
export function canAccessPath(
  pathname: string,
  permissions: ReadonlyArray<string>,
  isSuperAdmin = false,
): boolean {
  if (isSuperAdmin) return true;
  const required = requiredPermissionForPath(pathname);
  if (!required) return true;
  return permissions.includes(required);
}
