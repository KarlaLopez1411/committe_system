import 'server-only';

import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { assertCommitteeAccess, can } from '@/server/authz';

/**
 * PasswordChangeService — solicitudes de cambio de contraseña admin-initiated
 * sin envío de correo (user requests change, admin generates temporary password).
 *
 * Flujo:
 * 1. Usuario/admin solicita cambio (requestChange)
 * 2. Admin aprueba, genera contraseña temporal (approveChange)
 * 3. Usuario entra con temp pass, sistema obliga cambio (middleware + /cambiar-contrasena)
 * 4. Usuario cambia a nueva contraseña (changePassword vía server action)
 *
 * SEGURIDAD: server-only, requiere users.manage o password_changes.* permisos.
 * Audita cada operación.
 */

// ── Tipos públicos ───────────────────────────────────────────────────────

export interface PasswordChangeRequest {
  id: UUID;
  userId: UUID;
  userName: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  requestedAt: string;
  requestedBy?: UUID;
  approvedAt?: string;
  approvedBy?: UUID;
  approvedByName?: string;
  rejectedAt?: string;
  rejectedReason?: string;
  temporaryPassword?: string; // solo en aprobación, nunca almacenado
}

export interface PasswordChangeServiceDeps {
  client?: SupabaseClient;
}

// ── Contrato del servicio ────────────────────────────────────────────────

export interface PasswordChangeService {
  /** Usuario/admin solicita cambio de contraseña. */
  requestChange(
    ctx: Ctx,
    userId: UUID,
    reason?: string,
  ): Promise<Result<{ requestId: UUID }>>;

  /** Admin aprueba solicitud y genera contraseña temporal. */
  approveChange(
    ctx: Ctx,
    requestId: UUID,
  ): Promise<Result<{ temporaryPassword: string }>>;

  /** Admin rechaza solicitud. */
  rejectChange(
    ctx: Ctx,
    requestId: UUID,
    reason?: string,
  ): Promise<Result<void>>;

  /** Admin lista solicitudes pendientes del comité activo. */
  listPendingRequests(ctx: Ctx): Promise<Result<PasswordChangeRequest[]>>;

  /** Usuario cambia contraseña post-login (limpia force_password_change flag). */
  changePassword(
    ctx: Ctx,
    newPassword: string,
  ): Promise<Result<void>>;
}

/**
 * Crea instancia de PasswordChangeService sobre Supabase.
 * Por defecto usa cliente admin (service_role) para acceso a auth.users.
 */
export function createPasswordChangeService(
  deps: PasswordChangeServiceDeps = {},
): PasswordChangeService {
  const getClient = (): SupabaseClient => deps.client ?? createSupabaseAdminClient();

  return {
    /**
     * Solicita cambio de contraseña para un usuario.
     * Requiere implícitamente que el comité exista.
     * Solo permite una solicitud pendiente por usuario/comité.
     */
    async requestChange(ctx, userId, reason): Promise<Result<{ requestId: UUID }>> {
      // Autorización: solo admins pueden solicitar por otros
      if (userId !== ctx.userId && !can(ctx, 'users.manage')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para solicitar cambio de contraseña de otro usuario.',
        );
      }

      try {
        await assertCommitteeAccess(ctx, ctx.committeeId);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado al comité solicitado.');
      }

      const client = getClient();

      // Verificar que el usuario es miembro activo del comité
      const { data: membership, error: memberError } = await client
        .from('committee_users')
        .select('id')
        .eq('committee_id', ctx.committeeId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

      if (memberError) {
        return err(
          'password_change/membership-check-failed',
          `No se pudo verificar membresía: ${memberError.message}.`,
        );
      }
      if (!membership) {
        return err(
          'password_change/not-a-member',
          'El usuario no es miembro activo del comité.',
        );
      }

      // Crear solicitud (con UNIQUE constraint, rechaza si ya existe pendiente)
      const { data: created, error: insertError } = await client
        .from('password_change_requests')
        .insert({
          user_id: userId,
          committee_id: ctx.committeeId,
          status: 'pending',
          reason: reason?.trim() || null,
          requested_by: ctx.userId,
          requested_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError || !created) {
        // Detectar conflicto de UNIQUE constraint
        if (insertError?.code === '23505') {
          return err(
            'password_change/already-pending',
            'Ya existe una solicitud pendiente para este usuario en este comité.',
          );
        }
        return err(
          'password_change/create-failed',
          `No se pudo crear la solicitud: ${insertError?.message ?? 'error desconocido'}.`,
        );
      }

      const requestId = (created as { id: UUID }).id;

      // Auditar
      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'password_change.request',
        entityId: requestId,
        newValues: {
          requested_user_id: userId,
          reason: reason?.trim() || null,
        },
      });

      return ok({ requestId });
    },

    /**
     * Admin aprueba solicitud y genera contraseña temporal.
     * Requiere permiso password_changes.approve.
     * Devuelve la contraseña temporal (mostrar UNA SOLA VEZ al admin).
     */
    async approveChange(ctx, requestId): Promise<Result<{ temporaryPassword: string }>> {
      if (!can(ctx, 'password_changes.approve')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para aprobar cambios de contraseña.',
        );
      }

      const client = getClient();

      // Leer solicitud
      const { data: request, error: readError } = await client
        .from('password_change_requests')
        .select('id, user_id, committee_id, status')
        .eq('id', requestId)
        .maybeSingle();

      if (readError) {
        return err(
          'password_change/read-failed',
          `No se pudo leer la solicitud: ${readError.message}.`,
        );
      }
      if (!request) {
        return err(
          'password_change/not-found',
          'La solicitud de cambio no existe.',
        );
      }

      const req = request as { id: UUID; user_id: UUID; committee_id: UUID; status: string };

      // Validar acceso al comité
      try {
        await assertCommitteeAccess(ctx, req.committee_id);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado al comité solicitado.');
      }

      // Solo puede aprobar solicitudes pendientes
      if (req.status !== 'pending') {
        return err(
          'password_change/not-pending',
          `La solicitud no está pendiente (estado: ${req.status}).`,
        );
      }

      // Generar contraseña temporal (12 caracteres alphanumérici + símbolos)
      const tempPassword = generateTemporaryPassword();

      // Actualizar auth.users con nueva contraseña
      const { error: authError } = await client.auth.admin.updateUserById(req.user_id, {
        password: tempPassword,
      });

      if (authError) {
        return err(
          'password_change/auth-update-failed',
          `No se pudo actualizar contraseña en auth: ${authError.message}.`,
        );
      }

      // Marcar usuario para cambio obligatorio
      const { error: profileError } = await client
        .from('profiles')
        .update({ force_password_change: true })
        .eq('id', req.user_id);

      if (profileError) {
        return err(
          'password_change/profile-update-failed',
          `No se pudo marcar cambio obligatorio: ${profileError.message}.`,
        );
      }

      // Actualizar solicitud: approved
      const { error: updateError } = await client
        .from('password_change_requests')
        .update({
          status: 'approved',
          approved_by: ctx.userId,
          approved_at: new Date().toISOString(),
          // NO almacenar temporary_password en la BD (solo mostrar al admin una vez)
          temporary_password: null,
        })
        .eq('id', requestId);

      if (updateError) {
        return err(
          'password_change/update-failed',
          `No se pudo actualizar solicitud: ${updateError.message}.`,
        );
      }

      // Auditar aprobación
      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'password_change.approve',
        entityId: requestId,
        newValues: {
          status: 'approved',
          approved_by: ctx.userId,
        },
      });

      return ok({ temporaryPassword: tempPassword });
    },

    /**
     * Admin rechaza una solicitud de cambio.
     */
    async rejectChange(ctx, requestId, reason): Promise<Result<void>> {
      if (!can(ctx, 'password_changes.approve')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para rechazar cambios de contraseña.',
        );
      }

      const client = getClient();

      const { data: request, error: readError } = await client
        .from('password_change_requests')
        .select('id, committee_id, status')
        .eq('id', requestId)
        .maybeSingle();

      if (readError) {
        return err(
          'password_change/read-failed',
          `No se pudo leer la solicitud: ${readError.message}.`,
        );
      }
      if (!request) {
        return err(
          'password_change/not-found',
          'La solicitud de cambio no existe.',
        );
      }

      const req = request as { id: UUID; committee_id: UUID; status: string };

      try {
        await assertCommitteeAccess(ctx, req.committee_id);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado al comité solicitado.');
      }

      if (req.status !== 'pending') {
        return err(
          'password_change/not-pending',
          `La solicitud no está pendiente (estado: ${req.status}).`,
        );
      }

      // Actualizar solicitud: rejected
      const { error: updateError } = await client
        .from('password_change_requests')
        .update({
          status: 'rejected',
          rejected_at: new Date().toISOString(),
          rejected_reason: reason?.trim() || null,
        })
        .eq('id', requestId);

      if (updateError) {
        return err(
          'password_change/reject-failed',
          `No se pudo rechazar solicitud: ${updateError.message}.`,
        );
      }

      // Auditar rechazo
      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'password_change.reject',
        entityId: requestId,
        newValues: {
          status: 'rejected',
          reason: reason?.trim() || null,
        },
      });

      return ok(undefined);
    },

    /**
     * Admin lista solicitudes pendientes del comité actual.
     */
    async listPendingRequests(ctx): Promise<Result<PasswordChangeRequest[]>> {
      if (!can(ctx, 'password_changes.approve')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para consultar solicitudes de cambio.',
        );
      }

      const client = getClient();

      // Fetch solicitudes + usuario + aprobador
      const { data: requests, error } = await client
        .from('password_change_requests')
        .select(`
          id,
          user_id,
          status,
          reason,
          requested_at,
          requested_by,
          approved_at,
          approved_by,
          rejected_at,
          rejected_reason
        `)
        .eq('committee_id', ctx.committeeId)
        .eq('status', 'pending')
        .order('requested_at', { ascending: false });

      if (error) {
        return err(
          'password_change/list-failed',
          `No se pudieron listar solicitudes: ${error.message}.`,
        );
      }

      // Enriquecer con nombres (perfiles + aprobadores)
      const requests_ = (requests ?? []) as Array<{
        id: UUID;
        user_id: UUID;
        status: string;
        reason: string | null;
        requested_at: string;
        requested_by: UUID | null;
        approved_at: string | null;
        approved_by: UUID | null;
        rejected_at: string | null;
        rejected_reason: string | null;
      }>;

      if (requests_.length === 0) {
        return ok([]);
      }

      // Cargar perfiles de usuarios que solicitaron
      const userIds = [...new Set(requests_.map((r) => r.user_id))];
      const { data: profiles } = await client
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);

      const nameById = new Map<string, string | null>(
        ((profiles ?? []) as { id: UUID; full_name: string | null }[]).map((p) => [
          p.id,
          p.full_name,
        ]),
      );

      const result: PasswordChangeRequest[] = requests_.map((r) => ({
        id: r.id,
        userId: r.user_id,
        userName: nameById.get(r.user_id) ?? null,
        status: r.status as 'pending' | 'approved' | 'rejected',
        reason: r.reason ?? undefined,
        requestedAt: r.requested_at,
        requestedBy: r.requested_by ?? undefined,
        approvedAt: r.approved_at ?? undefined,
        approvedBy: r.approved_by ?? undefined,
        rejectedAt: r.rejected_at ?? undefined,
        rejectedReason: r.rejected_reason ?? undefined,
      }));

      return ok(result);
    },

    /**
     * Usuario cambia su contraseña (post-login con pass temporal).
     * Actualiza auth.users y limpia force_password_change flag.
     */
    async changePassword(ctx, newPassword): Promise<Result<void>> {
      // Validar contraseña (mín 12 caracteres, complejidad)
      const validation = validatePassword(newPassword);
      if (!validation.ok) {
        return validation as Result<void>;
      }

      const client = getClient();

      // Cambiar contraseña en auth.users
      const { error: authError } = await client.auth.updateUser({
        password: newPassword,
      });

      if (authError) {
        return err(
          'password_change/update-failed',
          `No se pudo cambiar contraseña: ${authError.message}.`,
        );
      }

      // Limpiar flag force_password_change
      const { error: profileError } = await client
        .from('profiles')
        .update({ force_password_change: false })
        .eq('id', ctx.userId);

      if (profileError) {
        // Log pero no falla (la contraseña ya cambió)
        console.error('No se pudo limpiar force_password_change:', profileError.message);
      }

      // Auditar cambio
      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'password_change.force_changed',
        entityId: ctx.userId,
        newValues: {
          force_password_change_cleared: true,
        },
      });

      return ok(undefined);
    },
  };
}

// ── Utilidades ───────────────────────────────────────────────────────────

/**
 * Genera contraseña temporal: 12 caracteres (letras mayúsculas, minúsculas, números, símbolos).
 * Base64 truncado da entropía suficiente para ser seguro (mínimo 70+ bits).
 */
function generateTemporaryPassword(): string {
  const bytes = randomBytes(12);
  // Base64 (3 bytes → 4 chars) → 12 bytes → 16 chars base64
  const base64 = bytes.toString('base64')
    .replace(/\+/g, '!')    // + → !
    .replace(/\//g, '#')    // / → #
    .replace(/=/g, '@');    // = → @
  return base64.slice(0, 12);
}

/**
 * Valida contraseña: mín 12 caracteres, debe contener mayúscula, minúscula, número, símbolo.
 */
function validatePassword(password: unknown): Result<void> {
  if (typeof password !== 'string') {
    return err('password/invalid', 'Contraseña inválida.');
  }

  if (password.length < 12) {
    return err(
      'password/too-short',
      'La contraseña debe tener al menos 12 caracteres.',
    );
  }

  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[!@#$%^&*()_+=\[\]{};':"\\|,.<>?/`~-]/.test(password);

  if (!hasUppercase || !hasLowercase || !hasNumber || !hasSymbol) {
    return err(
      'password/weak',
      'La contraseña debe contener mayúsculas, minúsculas, números y símbolos.',
    );
  }

  return ok(undefined);
}

// ── Auditoría ────────────────────────────────────────────────────────────

interface AuditInput {
  committeeId: UUID;
  userId: UUID;
  action: string;
  entityId: UUID;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

/**
 * Registra auditoría sin propagar errores (no enmascarar operaciones exitosas).
 */
async function recordAudit(client: SupabaseClient, entry: AuditInput): Promise<void> {
  try {
    const { error } = await client.from('audit_logs').insert({
      committee_id: entry.committeeId,
      user_id: entry.userId,
      entity_type: 'password_change_request',
      entity_id: entry.entityId,
      action: entry.action,
      old_values: entry.oldValues ?? null,
      new_values: entry.newValues ?? null,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudo auditar cambio de contraseña:', error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('No se pudo auditar cambio de contraseña:', e);
  }
}
