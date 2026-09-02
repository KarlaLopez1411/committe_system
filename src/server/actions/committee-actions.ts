'use server';

import { revalidatePath } from 'next/cache';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err } from '@/domain/types';

import { resolveActionCtx } from '@/server/actions/resolve-ctx';
import {
  createCommitteeService,
  type CommitteeConfigPatch,
  type CommitteeInput,
  type CommitteeStatus,
} from '@/server/committee-service';

/**
 * Server Actions de comité (design.md > CommitteeService).
 *
 * Envuelven `CommitteeService` resolviendo el `Ctx` autenticado a partir de las
 * cabeceras de confianza que fija el middleware (`x-sac-user-id`,
 * `x-sac-committee-id`, `x-sac-permissions`) y revalidan las rutas afectadas
 * tras una operación exitosa.
 *
 * SEGURIDAD: `'use server'` marca estas funciones como Server Actions; jamás se
 * ejecutan en el cliente. La verificación de comité/permiso la realiza el
 * servicio a partir del `Ctx` reconstruido de cabeceras de confianza.
 */

/** Rutas cuya caché se invalida tras cambios de comité/configuración. */
const COMMITTEE_PATHS = ['/comite', '/configuracion'] as const;

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

/** Revalida las rutas de comité/configuración tras una operación exitosa. */
function revalidateCommitteePaths(): void {
  for (const path of COMMITTEE_PATHS) {
    revalidatePath(path);
  }
}

/**
 * Server Action: crea un comité (R1.1–R1.3, R13.2). Revalida las rutas de
 * comité tras el éxito.
 */
export async function createCommitteeAction(
  data: CommitteeInput,
): Promise<Result<{ committeeId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return unauthenticated();
  }
  const service = createCommitteeService();
  const result = await service.create(ctx, data);
  if (result.ok) {
    revalidateCommitteePaths();
  }
  return result;
}

/**
 * Server Action: cambia el estado de un comité y audita el cambio (R1.4).
 */
export async function updateCommitteeStatusAction(
  id: UUID,
  status: CommitteeStatus,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return unauthenticated();
  }
  const service = createCommitteeService();
  const result = await service.updateStatus(ctx, id, status);
  if (result.ok) {
    revalidateCommitteePaths();
  }
  return result;
}

/**
 * Server Action: aplica un parche de configuración al comité del administrador
 * (R3.1–R3.4) y audita el cambio.
 */
export async function updateCommitteeConfigAction(
  id: UUID,
  patch: CommitteeConfigPatch,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return unauthenticated();
  }
  const service = createCommitteeService();
  const result = await service.updateConfig(ctx, id, patch);
  if (result.ok) {
    revalidateCommitteePaths();
  }
  return result;
}
