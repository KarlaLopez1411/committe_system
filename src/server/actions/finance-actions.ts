'use server';

import { revalidatePath } from 'next/cache';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err } from '@/domain/types';

import { resolveActionCtx } from '@/server/actions/resolve-ctx';
import {
  createFinanceService,
  type AccountInput,
  type IncomeInput,
  type ExpenseInput,
  type TransferInput,
} from '@/server/finance-service';

/**
 * Server Actions de finanzas (design.md > FinanceService).
 *
 * Envuelven `FinanceService` resolviendo el `Ctx` autenticado a partir de las
 * cabeceras de confianza que fija el middleware (`x-sac-user-id`,
 * `x-sac-committee-id`, `x-sac-permissions`, `x-sac-is-superadmin`) y revalidan
 * las rutas afectadas tras una operación exitosa.
 *
 * ESTRUCTURA: el archivo se organiza en SECCIONES claramente delimitadas para
 * que las tareas siguientes (categorías 6.2, ledger 8.1, movimientos 9.x)
 * puedan extenderlo sin conflicto. La tarea actual (6.1) implementa ÚNICAMENTE
 * las acciones de cuentas financieras.
 *
 * SEGURIDAD: `'use server'` marca estas funciones como Server Actions; jamás se
 * ejecutan en el cliente. La verificación de comité/permiso la realiza el
 * servicio a partir del `Ctx` reconstruido de cabeceras de confianza.
 */

// ── Utilidades compartidas ────────────────────────────────────────────────────

/** Rutas cuya caché se invalida tras cambios de cuentas. */
const ACCOUNT_PATHS = ['/finanzas/cuentas', '/finanzas'] as const;

/** Rutas cuya caché se invalida tras cambios de categorías. */
const CATEGORY_PATHS = ['/finanzas/categorias', '/configuracion', '/finanzas'] as const;

/** Rutas cuya caché se invalida tras nuevas transacciones. */
const TRANSACTION_PATHS = ['/finanzas/ingresos', '/finanzas/egresos', '/finanzas'] as const;

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

/** Revalida las rutas de cuentas tras una operación exitosa. */
function revalidateAccountPaths(): void {
  for (const path of ACCOUNT_PATHS) {
    revalidatePath(path);
  }
}

/** Revalida las rutas de categorías tras una operación exitosa. */
function revalidateCategoryPaths(): void {
  for (const path of CATEGORY_PATHS) {
    revalidatePath(path);
  }
}

/** Revalida las rutas de transacciones tras una operación exitosa. */
function revalidateTransactionPaths(): void {
  for (const path of TRANSACTION_PATHS) {
    revalidatePath(path);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Cuentas financieras (Requirements 9.1, 9.2, 9.3)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Server Action: crea una cuenta financiera (R9.1, R9.2). Revalida las rutas de
 * cuentas tras el éxito.
 */
export async function createAccountAction(
  data: AccountInput,
): Promise<Result<{ accountId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return unauthenticated();
  }
  const service = createFinanceService();
  const result = await service.createAccount(ctx, data);
  if (result.ok) {
    revalidateAccountPaths();
  }
  return result;
}

/**
 * Server Action: desactiva una cuenta financiera conservando su historial de
 * ledger (R9.3). Revalida las rutas de cuentas tras el éxito.
 */
export async function deactivateAccountAction(
  accountId: UUID,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return unauthenticated();
  }
  const service = createFinanceService();
  const result = await service.deactivateAccount(ctx, accountId);
  if (result.ok) {
    revalidateAccountPaths();
  }
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Categorías de transacción (Requirements 13.1, 13.3, 13.4, 13.5)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Server Action: crea una categoría de transacción (R13.1, R13.3, R13.5).
 * Revalida las rutas de categorías tras el éxito.
 */
export async function createCategoryAction(
  name: string,
): Promise<Result<{ categoryId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return unauthenticated();
  }
  const service = createFinanceService();
  const result = await service.createCategory(ctx, name);
  if (result.ok) {
    revalidateCategoryPaths();
  }
  return result;
}

/**
 * Server Action: renombra una categoría de transacción (R13.1, R13.3, R13.5).
 * Revalida las rutas de categorías tras el éxito.
 */
export async function renameCategoryAction(
  id: UUID,
  name: string,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return unauthenticated();
  }
  const service = createFinanceService();
  const result = await service.renameCategory(ctx, id, name);
  if (result.ok) {
    revalidateCategoryPaths();
  }
  return result;
}

/**
 * Server Action: elimina una categoría de transacción, rechazando la operación
 * si tiene ingresos asociados (R13.1, R13.4). Revalida las rutas de categorías
 * tras el éxito.
 */
export async function deleteCategoryAction(
  id: UUID,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) {
    return unauthenticated();
  }
  const service = createFinanceService();
  const result = await service.deleteCategory(ctx, id);
  if (result.ok) {
    revalidateCategoryPaths();
  }
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Ingresos (Requirements 12.1, 12.3, 42.2, 42.3)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Server Action: registra un ingreso financiero (R12.1, R12.3). Revalida las
 * rutas de transacciones tras el éxito.
 */
export async function registerIncomeAction(
  data: IncomeInput,
): Promise<Result<{ transactionId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const service = createFinanceService();
  const result = await service.registerIncome(ctx, data);
  if (result.ok) revalidateTransactionPaths();
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Egresos (Requirements 14.1, 14.3, 42.2, 42.3)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Server Action: registra un egreso financiero (R14.1, R14.3). Revalida las
 * rutas de transacciones tras el éxito.
 */
export async function registerExpenseAction(
  data: ExpenseInput,
): Promise<Result<{ transactionId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const service = createFinanceService();
  const result = await service.registerExpense(ctx, data);
  if (result.ok) revalidateTransactionPaths();
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Transferencias (Requirements 11.1, 42.3)
// ═════════════════════════════════════════════════════════════════════════════

export async function transferAction(
  data: TransferInput,
): Promise<Result<{ transactionId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const service = createFinanceService();
  const result = await service.transfer(ctx, data);
  if (result.ok) revalidateTransactionPaths();
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Aprobación y anulación (Requirements 15.1, 15.3)
// ═════════════════════════════════════════════════════════════════════════════

export async function approveTransactionAction(
  transactionId: UUID,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  try {
    const service = createFinanceService();
    const result = await service.approve(ctx, transactionId);
    if (result.ok) revalidateTransactionPaths();
    return result;
  } catch (e) {
    return err('transaction/approve-failed', `No se pudo aprobar la transacción: ${e instanceof Error ? e.message : 'error inesperado'}.`);
  }
}

export async function voidTransactionAction(
  transactionId: UUID,
  reason?: string | null,
): Promise<Result<{ reversalId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  try {
    const service = createFinanceService();
    const result = await service.void(ctx, transactionId, reason);
    if (result.ok) revalidateTransactionPaths();
    return result;
  } catch (e) {
    return err('transaction/void-failed', `No se pudo anular la transacción: ${e instanceof Error ? e.message : 'error inesperado'}.`);
  }
}

/**
 * Cancela (descarta) una transacción en borrador: la elimina y quita su apunte
 * del ledger, de modo que deja de afectar el saldo. Solo aplica a 'draft'.
 */
export async function cancelDraftTransactionAction(
  transactionId: UUID,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  try {
    const service = createFinanceService();
    const result = await service.cancelDraft(ctx, transactionId);
    if (result.ok) revalidateTransactionPaths();
    return result;
  } catch (e) {
    return err('transaction/cancel-failed', `No se pudo cancelar la transacción: ${e instanceof Error ? e.message : 'error inesperado'}.`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Adjuntos y Signed URL (Requirements 16.1, 16.2, 16.3)
// ═════════════════════════════════════════════════════════════════════════════

export async function attachAction(
  transactionId: UUID,
  storagePath: string,
  kind?: string | null,
): Promise<Result<{ attachmentId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const service = createFinanceService();
  return service.attach(ctx, transactionId, storagePath, kind);
}

export async function getSignedUrlAction(
  attachmentId: UUID,
): Promise<Result<string>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const service = createFinanceService();
  return service.getSignedUrl(ctx, attachmentId);
}
