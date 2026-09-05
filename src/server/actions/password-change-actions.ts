'use server';

import { revalidatePath } from 'next/cache';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err } from '@/domain/types';

import { createPasswordChangeService } from '@/server/password-change-service';
import { generateRecoveryToken, decryptRecoveryToken } from '@/server/password-recovery-tokens';
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

/**
 * Versión de guest: usuario no autenticado en /recuperar solicita cambio.
 * Puede recibir:
 * - email: correo directo (búsqueda en auth.users via RPC)
 * - token: token encriptado que contiene el email (no requiere auth.users)
 */
export async function requestPasswordChangeAsGuestAction(
  emailOrToken: string,
  reason?: string,
): Promise<Result<{ requestId: UUID }>> {
  console.log('[DEBUG] requestPasswordChangeAsGuestAction called');

  if (!emailOrToken) {
    return err('auth/invalid-input', 'Debe proporcionar email o token válido.');
  }

  // Intentar desencriptar si es token, sino usar como email
  let email = emailOrToken;
  const decrypted = decryptRecoveryToken(emailOrToken);
  if (decrypted) {
    email = decrypted;
    console.log('[DEBUG] Token desencriptado, email extraído');
  }

  if (!email || !email.includes('@')) {
    console.log('[DEBUG] Invalid email format');
    return err('auth/invalid-email', 'El correo no es válido.');
  }

  console.log('[DEBUG] Processing request for email:', email);

  const supabase = await (await import('@/lib/supabase/server')).createSupabaseServerClient();

  try {
    // Buscar usuario por email usando RPC si está disponible
    console.log('[DEBUG] Attempting to find user via RPC');

    const { data: userId, error: rpcError } = await supabase.rpc('find_user_by_email', {
      p_email: email.toLowerCase().trim(),
    });

    if (rpcError) {
      console.error('[ERROR] RPC find_user_by_email failed:', rpcError);
      // Si viene con token, es porque admin lo generó, pero no podemos procesar sin RPC
      if (decrypted) {
        return err(
          'auth/lookup-failed',
          'No se pudo procesar la solicitud. Por favor contacta al administrador.',
        );
      }
      // Si es email directo, mostrar mensaje genérico
      return err('auth/lookup-failed', 'Si el correo está registrado, recibirás instrucciones.');
    }

    if (!userId) {
      console.log('[DEBUG] No user found with email:', email);
      return err('auth/user-not-found', 'Si el correo está registrado, recibirás instrucciones.');
    }

    console.log('[DEBUG] User found:', { userId });

    // Buscar comités del usuario
    const { data: memberships, error: memberError } = await supabase
      .from('committee_users')
      .select('committee_id')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (memberError || !memberships || memberships.length === 0) {
      console.log('[DEBUG] User has no active committees');
      return err('auth/no-committees', 'Si el correo está registrado, recibirás instrucciones.');
    }

    console.log('[DEBUG] User has', memberships.length, 'committee(s)');

    if (memberships.length === 1) {
      const committeeId = (memberships[0] as { committee_id: UUID }).committee_id;
      return createPasswordRequest(supabase, userId, committeeId, reason);
    }

    console.log('[DEBUG] User has multiple committees');
    return err('auth/multiple-committees', 'Si el correo está registrado, recibirás instrucciones.');
  } catch (e) {
    console.error('[ERROR] Exception in requestPasswordChangeAsGuestAction:', e);
    return err(
      'auth/lookup-failed',
      'Error al procesar la solicitud. Por favor intenta de nuevo o contacta al administrador.',
    );
  }
}

/**
 * Helper para crear solicitud de cambio de contraseña.
 */
async function createPasswordRequest(
  supabase: any,
  userId: UUID,
  committeeId: UUID,
  reason?: string,
): Promise<Result<{ requestId: UUID }>> {
  console.log('[DEBUG] Creating password request for user:', userId, 'committee:', committeeId);

  const { data: created, error: insertError } = await supabase
    .from('password_change_requests')
    .insert({
      user_id: userId,
      committee_id: committeeId,
      status: 'pending',
      reason: reason?.trim() || null,
      requested_by: null,
      requested_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[ERROR] Failed to create request:', insertError);
    return err(
      'password_change/request-failed',
      insertError.message.includes('unique')
        ? 'Ya hay una solicitud pendiente para este usuario.'
        : 'Si el correo está registrado, recibirás instrucciones.',
    );
  }

  if (!created) {
    console.error('[ERROR] Insert succeeded but no result returned');
    return err('password_change/no-result', 'Si el correo está registrado, recibirás instrucciones.');
  }

  console.log('[DEBUG] Request created successfully:', (created as { id: UUID }).id);
  revalidatePasswordPaths();
  return { ok: true, value: { requestId: (created as { id: UUID }).id } };
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

export function generateRecoveryLink(email: string): string {
  const token = generateRecoveryToken(email);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${baseUrl}/recuperar?token=${encodeURIComponent(token)}`;
}
