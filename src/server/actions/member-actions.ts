'use server';

import { revalidatePath } from 'next/cache';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err } from '@/domain/types';

import { createMemberService, type MemberInput, type AssignableUser } from '@/server/member-service';
import { resolveActionCtx } from '@/server/actions/resolve-ctx';

/**
 * Server Actions de miembros (design.md > MemberService).
 *
 * Envuelven `MemberService` resolviendo el `Ctx` autenticado a partir de las
 * cabeceras de confianza que fija el middleware (`x-sac-user-id`,
 * `x-sac-committee-id`, `x-sac-permissions`) y revalidan las rutas afectadas
 * tras una operación exitosa.
 *
 * SEGURIDAD: `'use server'` marca estas funciones como Server Actions; jamás se
 * ejecutan en el cliente. La verificación de comité/permiso la realiza el
 * servicio a partir del `Ctx` reconstruido de cabeceras de confianza.
 */

/** Rutas cuya caché se invalida tras cambios en miembros/usuarios. */
const MEMBER_PATHS = ['/miembros', '/configuracion'] as const;

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

/** Revalida las rutas de miembros tras una operación exitosa. */
function revalidateMemberPaths(): void {
  for (const path of MEMBER_PATHS) {
    revalidatePath(path);
  }
}

/**
 * Server Action: registra un miembro del comité activo (R7.1–R7.5, R8.1).
 * Revalida las rutas de miembros tras el éxito.
 */
export async function registerMemberAction(
  data: MemberInput,
): Promise<Result<{ memberId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return unauthenticated();
  }
  const service = createMemberService();
  const result = await service.register(ctx, data);
  if (result.ok) {
    revalidateMemberPaths();
  }
  return result;
}

/**
 * Server Action: vincula un usuario con un miembro dentro del comité activo,
 * permitiendo a lo sumo un miembro por usuario (R8.2).
 */
export async function linkMemberUserAction(
  memberId: UUID,
  userId: UUID,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return unauthenticated();
  }
  const service = createMemberService();
  const result = await service.linkUser(ctx, memberId, userId);
  if (result.ok) {
    revalidateMemberPaths();
  }
  return result;
}

/**
 * Server Action: desvincula al usuario actualmente asignado al miembro
 * indicado (users.manage). Idempotente si no hay ningún usuario vinculado.
 */
export async function unlinkMemberUserAction(memberId: UUID): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const result = await createMemberService().unlinkUser(ctx, memberId);
  if (result.ok) revalidateMemberPaths();
  return result;
}

/**
 * Server Action: lista los usuarios elegibles para vincular al miembro
 * indicado (sin miembro asignado, más el que ya lo esté). Requiere `users.manage`.
 */
export async function listAssignableUsersAction(
  memberId: UUID,
): Promise<Result<AssignableUser[]>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  return createMemberService().listAssignableUsers(ctx, memberId);
}

/** Server Action: edita los datos básicos de un miembro (members.update). */
export async function updateMemberAction(
  memberId: UUID,
  data: MemberInput,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const result = await createMemberService().update(ctx, memberId, data);
  if (result.ok) revalidateMemberPaths();
  return result;
}

/** Server Action: cambia el estado de un miembro (activo/inactivo/baja). */
export async function setMemberStatusAction(
  memberId: UUID,
  status: string,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const result = await createMemberService().setStatus(ctx, memberId, status);
  if (result.ok) revalidateMemberPaths();
  return result;
}

/** Server Action: elimina un miembro (bloqueado si tiene aportaciones/usuario). */
export async function deleteMemberAction(memberId: UUID): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const result = await createMemberService().remove(ctx, memberId);
  if (result.ok) revalidateMemberPaths();
  return result;
}
