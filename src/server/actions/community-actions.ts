'use server';

import { revalidatePath } from 'next/cache';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err } from '@/domain/types';

import { resolveActionCtx } from '@/server/actions/resolve-ctx';
import { createContributionService, type ContributionInput, type ContributionBatchInput } from '@/server/contribution-service';
import { createActivityService, type ActivityInput, type ActivityStatus } from '@/server/activity-service';
import { createCashClosingService } from '@/server/cash-closing-service';

async function resolveCtx(): Promise<Ctx | null> {
  return resolveActionCtx();
}

function unauth<T>(): Result<T> {
  return err('auth/unauthenticated', 'No hay una sesión de comité activa.');
}

// ── Contributions ─────────────────────────────────────────────────────────────

export async function registerContributionAction(data: ContributionInput): Promise<Result<{ contributionId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createContributionService().register(ctx, data);
  if (result.ok) revalidatePath('/aportaciones');
  return result;
}

/** Registra la aportación de varios miembros a la vez y genera el ingreso a caja. */
export async function registerContributionsBatchAction(
  data: ContributionBatchInput,
): Promise<Result<{ count: number; total: string; transactionId: UUID | null }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createContributionService().registerBatch(ctx, data);
  if (result.ok) revalidatePath('/aportaciones');
  return result;
}

export async function confirmContributionAction(contributionId: UUID, transactionId: UUID): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createContributionService().confirmMonetary(ctx, contributionId, transactionId);
  if (result.ok) revalidatePath('/aportaciones');
  return result;
}

// ── Activities ────────────────────────────────────────────────────────────────

export async function createActivityAction(data: ActivityInput): Promise<Result<{ activityId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createActivityService().create(ctx, data);
  if (result.ok) revalidatePath('/actividades');
  return result;
}

export async function updateActivityStatusAction(activityId: UUID, status: ActivityStatus): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createActivityService().updateStatus(ctx, activityId, status);
  if (result.ok) revalidatePath('/actividades');
  return result;
}

export async function closeActivityAction(activityId: UUID): Promise<Result<{ summary: unknown }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createActivityService().closeCut(ctx, activityId);
  if (result.ok) revalidatePath('/actividades');
  return result;
}

// ── Cash Closings ─────────────────────────────────────────────────────────────

export async function openCashClosingAction(accountId: UUID, period: string): Promise<Result<{ closingId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createCashClosingService().open(ctx, accountId, period);
  if (result.ok) revalidatePath('/cortes');
  return result;
}

export async function captureRealBalanceAction(closingId: UUID, realBalance: string): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createCashClosingService().captureReal(ctx, closingId, realBalance);
  if (result.ok) revalidatePath('/cortes');
  return result;
}

export async function reviewCashClosingAction(closingId: UUID): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createCashClosingService().review(ctx, closingId);
  if (result.ok) revalidatePath('/cortes');
  return result;
}

export async function approveCashClosingAction(closingId: UUID): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createCashClosingService().approve(ctx, closingId);
  if (result.ok) revalidatePath('/cortes');
  return result;
}

export async function closeCashClosingAction(closingId: UUID): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createCashClosingService().close(ctx, closingId);
  if (result.ok) revalidatePath('/cortes');
  return result;
}
