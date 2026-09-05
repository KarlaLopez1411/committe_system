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

/**
 * Versión de guest: usuario no autenticado en /recuperar solicita cambio.
 * Requiere email, intenta buscar al usuario y registrar solicitud en su comité.
 */
export async function requestPasswordChangeAsGuestAction(
  email: string,
  reason?: string,
): Promise<Result<{ requestId: UUID }>> {
  console.log('[DEBUG] requestPasswordChangeAsGuestAction called with:', { email });

  if (!email || !email.includes('@')) {
    console.log('[DEBUG] Invalid email format');
    return err('auth/invalid-email', 'El correo no es válido.');
  }

  const supabase = await (await import('@/lib/supabase/server')).createSupabaseServerClient();

  try {
    // Buscar usuario por email usando RPC de Supabase
    // Este RPC debe retornar el user_id asociado a un email
    console.log('[DEBUG] Calling Supabase RPC to find user by email');

    const { data: userIdResult, error: rpcError } = await supabase.rpc('get_user_id_by_email', {
      email_input: email.toLowerCase().trim(),
    });

    if (rpcError) {
      console.error('[ERROR] RPC call failed:', rpcError);
      // Fallback: intentar búsqueda directa en auth si el RPC no existe
      console.log('[DEBUG] RPC not available, trying direct auth lookup with pagination');

      let user = null;
      for (let i = 0; i < 10; i++) {
        console.log(`[DEBUG] Searching auth page ${i}`);
        const { data: { users }, error: authError } = await supabase.auth.admin.listUsers({
          page: i,
          perPage: 100,
        });

        if (authError) {
          console.error(`[ERROR] Auth lookup failed on page ${i}:`, authError);
          return err('auth/lookup-failed', 'Si el correo está registrado, recibirás instrucciones.');
        }

        if (!users || users.length === 0) break;

        user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (user) {
          console.log('[DEBUG] User found via auth:', { userId: user.id });

          // Buscar comités del usuario
          const { data: memberships, error: memberError } = await supabase
            .from('committee_users')
            .select('committee_id')
            .eq('user_id', user.id)
            .eq('status', 'active');

          if (memberError || !memberships || memberships.length === 0) {
            console.log('[DEBUG] User has no active committees');
            return err('auth/no-committees', 'Si el correo está registrado, recibirás instrucciones.');
          }

          if (memberships.length === 1) {
            const committeeId = (memberships[0] as { committee_id: UUID }).committee_id;
            return createPasswordRequest(supabase, user.id, committeeId, reason);
          }

          console.log('[DEBUG] User has multiple committees');
          return err('auth/multiple-committees', 'Si el correo está registrado, recibirás instrucciones.');
        }
      }

      console.log('[DEBUG] User not found');
      return err('auth/user-not-found', 'Si el correo está registrado, recibirás instrucciones.');
    }

    const userId = userIdResult as UUID | null;
    if (!userId) {
      console.log('[DEBUG] RPC returned no user_id for email:', email);
      return err('auth/user-not-found', 'Si el correo está registrado, recibirás instrucciones.');
    }

    console.log('[DEBUG] User found via RPC:', { userId });

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

    // Si el usuario solo pertenece a un comité, registrar solicitud
    if (memberships.length === 1) {
      const committeeId = (memberships[0] as { committee_id: UUID }).committee_id;
      return createPasswordRequest(supabase, userId, committeeId, reason);
    }

    console.log('[DEBUG] User has multiple committees');
    return err('auth/multiple-committees', 'Si el correo está registrado, recibirás instrucciones.');
  } catch (e) {
    console.error('[ERROR] Exception in requestPasswordChangeAsGuestAction:', e);
    return err('auth/lookup-failed', 'Si el correo está registrado, recibirás instrucciones.');
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
