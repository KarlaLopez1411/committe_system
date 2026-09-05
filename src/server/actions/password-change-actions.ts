'use server';

import { revalidatePath } from 'next/cache';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err } from '@/domain/types';

import { createPasswordChangeService } from '@/server/password-change-service';
import { resolveActionCtx } from '@/server/actions/resolve-ctx';

const PASSWORD_PATHS = ['/configuracion'] as const;

async function resolveCtx(): Promise<Ctx | null> {
  return resolveActionCtx();
}

function unauthenticated<T>(): Result<T> {
  return err('auth/unauthenticated', 'No hay una sesión de comité activa.');
}

function revalidatePasswordPaths(): void {
  for (const path of PASSWORD_PATHS) {
    revalidatePath(path);
  }
}

export async function requestPasswordChangeAction(
  userId?: UUID,
  reason?: string,
): Promise<Result<{ requestId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  // Si no se proporciona userId, usar el usuario actual (auto-request)
  const targetUserId = userId ?? ctx.userId;
  const result = await createPasswordChangeService().requestChange(ctx, targetUserId, reason);
  if (result.ok) revalidatePasswordPaths();
  return result;
}

export async function approvePasswordChangeAction(
  requestId: UUID,
): Promise<Result<{ temporaryPassword: string }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const result = await createPasswordChangeService().approveChange(ctx, requestId);
  if (result.ok) revalidatePasswordPaths();
  return result;
}

export async function rejectPasswordChangeAction(
  requestId: UUID,
  reason?: string,
): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  const result = await createPasswordChangeService().rejectChange(ctx, requestId, reason);
  if (result.ok) revalidatePasswordPaths();
  return result;
}

export async function listAllPasswordChangesAction(): Promise<
  Result<Array<{
    id: UUID;
    userId: UUID;
    userName: string | null;
    status: string;
    reason?: string;
    requestedAt: string;
    approvedAt?: string;
    rejectedAt?: string;
    rejectedReason?: string;
  }>>
> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  return createPasswordChangeService().listAllRequests(ctx);
}

export async function listPendingPasswordChangesAction(): Promise<
  Result<Array<{
    id: UUID;
    userId: UUID;
    userName: string | null;
    status: string;
    reason?: string;
    requestedAt: string;
  }>>
> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  return createPasswordChangeService().listPendingRequests(ctx);
}

export async function changePasswordAction(newPassword: string): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauthenticated();
  return createPasswordChangeService().changePassword(ctx, newPassword);
}
