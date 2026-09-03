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
  if (!email || !email.includes('@')) {
    return err('auth/invalid-email', 'El correo no es válido.');
  }

  const supabase = await (await import('@/lib/supabase/server')).createSupabaseServerClient();

  // Buscar usuario por email en auth
  const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
  if (authError || !users) {
    return err('auth/lookup-failed', 'No se pudo verificar el correo.');
  }

  const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    // Respuesta genérica para no revelar si el email existe
    return err('auth/user-not-found', 'Si el correo está registrado, recibirás instrucciones.');
  }

  // Buscar comités del usuario
  const { data: memberships, error: memberError } = await supabase
    .from('committee_users')
    .select('committee_id')
    .eq('user_id', user.id)
    .eq('status', 'active');

  if (memberError || !memberships || memberships.length === 0) {
    return err('auth/no-committees', 'Si el correo está registrado, recibirás instrucciones.');
  }

  // Si el usuario solo pertenece a un comité, registrar solicitud
  if (memberships.length === 1) {
    const committeeId = (memberships[0] as { committee_id: UUID }).committee_id;

    // Crear solicitud
    const { data: created, error: insertError } = await supabase
      .from('password_change_requests')
      .insert({
        user_id: user.id,
        committee_id: committeeId,
        status: 'pending',
        reason: reason?.trim() || null,
        requested_by: null, // Guest request, no admin
        requested_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) {
      return err(
        'password_change/request-failed',
        insertError.message.includes('unique')
          ? 'Ya hay una solicitud pendiente para este usuario.'
          : 'No se pudo crear la solicitud.',
      );
    }

    if (!created) {
      return err('password_change/no-result', 'No se pudo crear la solicitud.');
    }

    revalidatePasswordPaths();
    return { ok: true, value: { requestId: (created as { id: UUID }).id } };
  }

  // Si pertenece a múltiples comités, respuesta genérica (no revelar detalles)
  return err('auth/multiple-committees', 'Si el correo está registrado, recibirás instrucciones.');
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
