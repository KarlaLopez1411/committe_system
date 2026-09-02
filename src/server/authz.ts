import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, UUID } from '@/domain/types';

import { createSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * Capa de autorización (RBAC) del servidor (Requirements 2.3, 2.5, 5.5, 5.6,
 * 6.2, 6.3).
 *
 * Implementa la sección "Auth / Authorization" de design.md:
 *  - `effectivePermissions`: unión de permisos de los roles del usuario en el
 *    comité (R6.3).
 *  - `can`: verificación de un permiso concreto sobre el `Ctx` (R6.2), con
 *    superadministrador siempre autorizado (R2.6).
 *  - `hasCommitteeAccess` / `assertCommitteeAccess`: aislamiento por comité
 *    (R2.3, R2.6), con auditoría de intentos denegados (R2.5).
 *
 * SEGURIDAD (Requirements 40.2, 40.3): `server-only` impide que este módulo
 * llegue al bundle del navegador. La auditoría de accesos denegados usa el
 * cliente admin (`service_role`) para poder escribir en `audit_logs` con
 * independencia de las políticas RLS del usuario.
 */

/** Código de error estable para fallos de autorización. */
export const AUTHZ_ERROR_CODE = 'AUTHZ_FORBIDDEN' as const;

/** Error de autorización con código estable para consumo programático. */
export class AuthorizationError extends Error {
  readonly code = AUTHZ_ERROR_CODE;
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Deriva los permisos efectivos de un usuario en un comité como la UNIÓN
 * deduplicada y ordenada de los permisos de todos los roles asignados en ese
 * comité (Requirements 6.3).
 *
 * Recorre `user_roles → roles → role_permissions → permissions` usando el
 * cliente Supabase provisto. Lanza si la consulta falla (fail-closed: sin
 * permisos comprobables no se autoriza ninguna operación).
 */
export async function effectivePermissions(
  userId: UUID,
  committeeId: UUID,
  client: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await client
    .from('user_roles')
    .select('roles(role_permissions(permissions(key)))')
    .eq('user_id', userId)
    .eq('committee_id', committeeId);

  if (error) {
    throw new Error(`No se pudieron resolver los permisos efectivos: ${error.message}`);
  }

  const permissions = new Set<string>();

  // La forma exacta del anidamiento depende del planificador de PostgREST
  // (objeto único o arreglo en cada nivel); se recorre de forma defensiva.
  for (const row of (data ?? []) as unknown[]) {
    const roles = toArray((row as Record<string, unknown>).roles);
    for (const role of roles) {
      const rolePerms = toArray(
        (role as Record<string, unknown>).role_permissions,
      );
      for (const rp of rolePerms) {
        const perms = toArray((rp as Record<string, unknown>).permissions);
        for (const perm of perms) {
          const key = (perm as Record<string, unknown>).key;
          if (typeof key === 'string') {
            permissions.add(key);
          }
        }
      }
    }
  }

  return [...permissions].sort();
}

/**
 * Indica si el contexto autenticado posee un permiso concreto (Requirements
 * 6.2). El superadministrador se considera autorizado para todo (R2.6). El rol
 * auditor no requiere un caso especial: su denegación de escritura surge de la
 * ausencia del permiso correspondiente (R5.5, R5.6).
 */
export function can(ctx: Ctx, permission: string): boolean {
  return ctx.isSuperAdmin || ctx.permissions.includes(permission);
}

/**
 * Indica si el contexto puede acceder al `committeeId` indicado: solo su comité
 * activo, salvo superadministrador (Requirements 2.3, 2.6).
 */
export function hasCommitteeAccess(ctx: Ctx, committeeId: UUID): boolean {
  return ctx.isSuperAdmin || ctx.committeeId === committeeId;
}

/** Dependencias inyectables para la escritura de auditoría de denegaciones. */
export interface AuditDeps {
  client?: SupabaseClient;
}

/**
 * Registra en `audit_logs` un intento de acceso/escritura denegado sobre un
 * comité sin membresía activa (Requirements 2.5). No propaga errores de
 * auditoría: los registra por consola para no enmascarar el fallo de
 * autorización original.
 */
export async function recordDeniedAccess(
  ctx: Ctx,
  targetCommitteeId: UUID,
  deps: AuditDeps = {},
): Promise<void> {
  const client = deps.client ?? createSupabaseAdminClient();
  try {
    const { error } = await client.from('audit_logs').insert({
      committee_id: targetCommitteeId,
      user_id: ctx.userId,
      entity_type: 'committee',
      entity_id: targetCommitteeId,
      action: 'access.denied',
      new_values: null,
      old_values: null,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudo auditar el acceso denegado:', error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('No se pudo auditar el acceso denegado:', e);
  }
}

/**
 * Verifica el acceso al comité y, si se deniega, AUDITA el intento y lanza
 * `AuthorizationError` (Requirements 2.3, 2.5, 2.6). El superadministrador nunca
 * genera auditoría de denegación.
 */
export async function assertCommitteeAccess(
  ctx: Ctx,
  committeeId: UUID,
  deps: AuditDeps = {},
): Promise<void> {
  if (hasCommitteeAccess(ctx, committeeId)) {
    return;
  }
  await recordDeniedAccess(ctx, committeeId, deps);
  throw new AuthorizationError(
    'Acceso no autorizado al comité solicitado.',
  );
}

/**
 * Normaliza un valor que puede ser objeto único, arreglo o `null`/`undefined`
 * en un arreglo homogéneo para poder recorrerlo con seguridad.
 */
function toArray(value: unknown): unknown[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
