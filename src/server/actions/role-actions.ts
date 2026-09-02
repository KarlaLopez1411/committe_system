'use server';

import { revalidatePath } from 'next/cache';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err } from '@/domain/types';

import { resolveActionCtx } from '@/server/actions/resolve-ctx';
import {
  createRoleService,
  type CommitteeUserRow,
  type RoleOption,
} from '@/server/role-service';

/**
 * Server Actions de roles (design.md > Authorization / RoleService).
 *
 * Envuelven `RoleService` resolviendo el `Ctx` autenticado a partir de las
 * cabeceras de confianza que fija el middleware (`x-sac-user-id`,
 * `x-sac-committee-id`, `x-sac-permissions`, `x-sac-is-superadmin`) y revalidan
 * las rutas afectadas tras una operación exitosa.
 *
 * SEGURIDAD: `'use server'` marca estas funciones como Server Actions; jamás se
 * ejecutan en el cliente. La verificación de comité/permiso la realiza el
 * servicio a partir del `Ctx` reconstruido de cabeceras de confianza.
 */

/** Rutas cuya caché se invalida tras cambios de asignación de roles. */
const ROLE_PATHS = ['/usuarios', '/configuracion'] as const;

/**
 * Reconstruye el `Ctx` autenticado desde las cabeceras de confianza fijadas por
 * el middleware. Devuelve `null` si no hay usuario o comité activo resueltos.
 */
async function resolveCtx(): Promise<Ctx | null> {
  return resolveActionCtx();
}

/** Error uniforme cuando no hay contexto autenticado resuelto. */
function unauthenticated<T>(): Result<T> {
  return err('auth/unauthenticated', 'No hay una sesión de comité activa.');
}

/** Revalida las rutas de usuarios/configuración tras una operación exitosa. */
function revalidateRolePaths(): void {
  for (const path of ROLE_PATHS) {
    revalidatePath(path);
  }
}

/**
 * Server Action: asigna un rol predefinido a un usuario miembro activo del
 * comité activo (R5.1–R5.4). Revalida las rutas de usuarios tras el éxito.
 */
export async function assignRoleAction(
  targetUserId: UUID,
  roleKey: string,
): Promise<Result<{ userRoleId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return unauthenticated();
  }
  const service = createRoleService();
  const result = await service.assignRole(ctx, targetUserId, roleKey);
  if (result.ok) {
    revalidateRolePaths();
  }
  return result;
}

/** Server Action: retira un rol de un usuario en el comité activo (R5.x). */
export async function removeRoleAction(
  targetUserId: UUID,
  roleKey: string,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const result = await createRoleService().removeRole(ctx, targetUserId, roleKey);
  if (result.ok) revalidateRolePaths();
  return result;
}

/** Server Action: lista los usuarios del comité activo con sus roles. */
export async function listCommitteeUsersAction(): Promise<Result<CommitteeUserRow[]>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  return createRoleService().listCommitteeUsersWithRoles(ctx);
}

/** Server Action: catálogo de roles asignables. */
export async function listRolesAction(): Promise<Result<RoleOption[]>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  return createRoleService().listRoles(ctx);
}
