import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { assertCommitteeAccess, can } from '@/server/authz';

/**
 * MemberService — registro de miembros y vínculo miembro/usuario
 * (Requirements 7.1–7.5, 8.1, 8.2).
 *
 * Implementa la sección "MemberService" de design.md:
 *  - `register`: valida nombre 1–150 (R7.1, R7.3), estado en
 *    {activo, inactivo, baja} con default `activo` (R7.2, R7.4), teléfono ≤30 y
 *    notas ≤500 (R7.5); asocia el miembro al comité del contexto y permite
 *    miembros sin cuenta de acceso (R8.1). Ante error de validación conserva los
 *    datos capturados y NO persiste (R7.3, R7.4, R7.5).
 *  - `linkUser`: asocia a lo sumo un miembro por usuario dentro del comité
 *    (R8.2), rechazando si el usuario ya está vinculado a otro miembro.
 *
 * SEGURIDAD (Requirements 40.2, 40.3): `server-only` impide que este módulo
 * llegue al bundle del navegador. Usa el cliente admin (`service_role`) porque
 * las altas de miembros son operaciones administrativas que además deben poder
 * escribir en `audit_logs`. La autorización efectiva se valida contra el `Ctx`.
 */

// ── Constantes de dominio ─────────────────────────────────────────────────────

/** Estados válidos de un miembro (alineado con el CHECK de members.status). */
export const MEMBER_STATUSES = ['activo', 'inactivo', 'baja'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Estado inicial por defecto de un miembro nuevo (Requirements 7.2). */
export const DEFAULT_MEMBER_STATUS: MemberStatus = 'activo';

/** Longitud mínima y máxima del nombre del miembro (Requirements 7.1, 7.3). */
export const MEMBER_NAME_MIN = 1;
export const MEMBER_NAME_MAX = 150;

/** Longitud máxima del teléfono del miembro (Requirements 7.5). */
export const MEMBER_PHONE_MAX = 30;

/** Longitud máxima de las notas del miembro (Requirements 7.5). */
export const MEMBER_NOTES_MAX = 500;

// ── DTOs de entrada ───────────────────────────────────────────────────────────

/** Datos de alta de un miembro (design.md > MemberService). */
export interface MemberInput {
  fullName: string;
  phone?: string | null;
  joinedAt?: string | null;
  position?: string | null;
  status?: string | null;
  notes?: string | null;
  /** El miembro se compromete a la aportación mensual voluntaria. */
  monthlyCommitment?: boolean;
  /** Monto mensual comprometido (por defecto $100). */
  monthlyAmount?: string | number | null;
}

/** Dependencias inyectables (permite simular Supabase en pruebas). */
export interface MemberServiceDeps {
  client?: SupabaseClient;
}

// ── Utilidades de validación ──────────────────────────────────────────────────

/**
 * Valida el nombre de un miembro: no vacío tras recortar y entre 1 y 150
 * caracteres (Requirements 7.1, 7.3). Devuelve el nombre recortado si es válido.
 */
export function validateMemberName(name: unknown): Result<string> {
  if (typeof name !== 'string') {
    return err('member/invalid-name', 'El nombre del miembro es obligatorio.', 'fullName');
  }
  const trimmed = name.trim();
  if (trimmed.length < MEMBER_NAME_MIN) {
    return err('member/invalid-name', 'El nombre del miembro es obligatorio.', 'fullName');
  }
  if (trimmed.length > MEMBER_NAME_MAX) {
    return err(
      'member/invalid-name',
      `El nombre del miembro no puede exceder ${MEMBER_NAME_MAX} caracteres.`,
      'fullName',
    );
  }
  return ok(trimmed);
}

/**
 * Valida el estado del miembro contra el conjunto cerrado {activo, inactivo,
 * baja} (Requirements 7.4). Un valor ausente/nulo se resuelve al estado inicial
 * `activo` (Requirements 7.2).
 */
export function validateMemberStatus(status: unknown): Result<MemberStatus> {
  if (status === undefined || status === null || status === '') {
    return ok(DEFAULT_MEMBER_STATUS);
  }
  if (typeof status !== 'string' || !MEMBER_STATUSES.includes(status as MemberStatus)) {
    return err(
      'member/invalid-status',
      `El estado del miembro debe ser uno de: ${MEMBER_STATUSES.join(', ')}.`,
      'status',
    );
  }
  return ok(status as MemberStatus);
}

/**
 * Valida el teléfono opcional del miembro por longitud máxima (Requirements
 * 7.5). Devuelve `null` si está ausente o vacío tras recortar.
 */
export function validateMemberPhone(phone: unknown): Result<string | null> {
  if (phone === undefined || phone === null) {
    return ok(null);
  }
  if (typeof phone !== 'string') {
    return err('member/invalid-phone', 'El teléfono no es válido.', 'phone');
  }
  const trimmed = phone.trim();
  if (trimmed.length === 0) {
    return ok(null);
  }
  if (trimmed.length > MEMBER_PHONE_MAX) {
    return err(
      'member/invalid-phone',
      `El teléfono no puede exceder ${MEMBER_PHONE_MAX} caracteres.`,
      'phone',
    );
  }
  return ok(trimmed);
}

/**
 * Valida las notas opcionales del miembro por longitud máxima (Requirements
 * 7.5). Devuelve `null` si están ausentes o vacías tras recortar.
 */
export function validateMemberNotes(notes: unknown): Result<string | null> {
  if (notes === undefined || notes === null) {
    return ok(null);
  }
  if (typeof notes !== 'string') {
    return err('member/invalid-notes', 'Las notas no son válidas.', 'notes');
  }
  const trimmed = notes.trim();
  if (trimmed.length === 0) {
    return ok(null);
  }
  if (trimmed.length > MEMBER_NOTES_MAX) {
    return err(
      'member/invalid-notes',
      `Las notas no pueden exceder ${MEMBER_NOTES_MAX} caracteres.`,
      'notes',
    );
  }
  return ok(trimmed);
}

// ── Contrato del servicio ─────────────────────────────────────────────────────

export interface MemberService {
  register(ctx: Ctx, data: MemberInput): Promise<Result<{ memberId: UUID }>>;
  linkUser(ctx: Ctx, memberId: UUID, userId: UUID): Promise<Result<void>>;
  /** Edita los datos básicos de un miembro (nombre, teléfono, cargo, notas, compromiso, estado). */
  update(ctx: Ctx, memberId: UUID, data: MemberInput): Promise<Result<void>>;
  /** Cambia el estado de un miembro (activo/inactivo/baja). */
  setStatus(ctx: Ctx, memberId: UUID, status: string): Promise<Result<void>>;
  /** Elimina un miembro. Bloqueado si tiene aportaciones o usuario vinculado. */
  remove(ctx: Ctx, memberId: UUID): Promise<Result<void>>;
}

/**
 * Crea una instancia de MemberService sobre Supabase.
 *
 * Por defecto usa el cliente admin (`service_role`), apropiado para el alta de
 * miembros y para escribir auditoría. Las pruebas pueden inyectar un cliente
 * simulado.
 */
export function createMemberService(deps: MemberServiceDeps = {}): MemberService {
  const getClient = (): SupabaseClient => deps.client ?? createSupabaseAdminClient();

  return {
    /**
     * Registra un miembro asociado al comité del contexto (Requirements
     * 7.1–7.5, 8.1). Requiere el permiso `members.create`. Valida todos los
     * campos ANTES de persistir; ante un error de validación NO se inserta nada
     * (los datos capturados los conserva el llamador) (R7.3, R7.4, R7.5).
     * El miembro puede registrarse sin una cuenta de acceso asociada (R8.1).
     */
    async register(ctx, data): Promise<Result<{ memberId: UUID }>> {
      if (!can(ctx, 'members.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para registrar miembros.');
      }

      const nameCheck = validateMemberName(data?.fullName);
      if (!nameCheck.ok) {
        return nameCheck as Result<{ memberId: UUID }>;
      }

      const statusCheck = validateMemberStatus(data?.status);
      if (!statusCheck.ok) {
        return statusCheck as Result<{ memberId: UUID }>;
      }

      const phoneCheck = validateMemberPhone(data?.phone);
      if (!phoneCheck.ok) {
        return phoneCheck as Result<{ memberId: UUID }>;
      }

      const notesCheck = validateMemberNotes(data?.notes);
      if (!notesCheck.ok) {
        return notesCheck as Result<{ memberId: UUID }>;
      }

      const client = getClient();
      const { data: created, error } = await client
        .from('members')
        .insert({
          committee_id: ctx.committeeId, // asociación al comité del contexto (R7.1)
          full_name: nameCheck.value,
          phone: phoneCheck.value,
          joined_at: data.joinedAt ?? null,
          position: data.position ?? null,
          status: statusCheck.value, // default `activo` cuando no se especifica (R7.2)
          notes: notesCheck.value,
          monthly_commitment: data.monthlyCommitment ?? false,
          monthly_amount: data.monthlyAmount != null && String(data.monthlyAmount) !== '' ? data.monthlyAmount : 100,
          created_by: ctx.userId,
        })
        .select('id')
        .single();

      if (error || !created) {
        return err(
          'member/create-failed',
          `No se pudo registrar el miembro: ${error?.message ?? 'error desconocido'}.`,
        );
      }

      const memberId = (created as { id: UUID }).id;

      // Auditoría del alta, atribuible al usuario y fecha (R36.1).
      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'member.create',
        entityId: memberId,
        newValues: {
          full_name: nameCheck.value,
          status: statusCheck.value,
        },
      });

      return ok({ memberId });
    },

    /**
     * Vincula un usuario con un miembro dentro del comité, permitiendo a lo sumo
     * un miembro por usuario (Requirements 8.2). Rechaza si el usuario ya está
     * vinculado a un miembro del comité. Requiere el permiso `users.manage`.
     *
     * La unicidad última la garantiza la BD con `UNIQUE(committee_id, member_id)`
     * y la fila única de membresía `UNIQUE(committee_id, user_id)`; aquí se
     * comprueba de forma explícita para devolver un error de dominio claro.
     */
    async linkUser(ctx, memberId, userId): Promise<Result<void>> {
      if (!can(ctx, 'users.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para vincular usuarios con miembros.');
      }

      // Solo el comité del contexto (o superadmin); audita el intento ajeno.
      try {
        await assertCommitteeAccess(ctx, ctx.committeeId);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado al comité solicitado.');
      }

      const client = getClient();

      // Localiza la membresía del usuario en el comité activo.
      const { data: membership, error: readError } = await client
        .from('committee_users')
        .select('id, member_id')
        .eq('committee_id', ctx.committeeId)
        .eq('user_id', userId)
        .maybeSingle();

      if (readError) {
        return err(
          'member/link-read-failed',
          `No se pudo verificar la membresía del usuario: ${readError.message}.`,
        );
      }
      if (!membership) {
        return err(
          'member/user-not-member',
          'El usuario no pertenece al comité activo.',
          'userId',
        );
      }

      // R8.2: a lo sumo un miembro por usuario dentro del comité.
      const existingMemberId = (membership as { member_id: UUID | null }).member_id;
      if (existingMemberId) {
        if (existingMemberId === memberId) {
          // Ya está vinculado a este mismo miembro: operación idempotente.
          return ok(undefined);
        }
        return err(
          'member/user-already-linked',
          'El usuario ya está vinculado a un miembro en este comité.',
          'userId',
        );
      }

      const membershipId = (membership as { id: UUID }).id;
      const { error: updateError } = await client
        .from('committee_users')
        .update({ member_id: memberId })
        .eq('id', membershipId);

      if (updateError) {
        return err(
          'member/link-failed',
          `No se pudo vincular el usuario con el miembro: ${updateError.message}.`,
        );
      }

      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'member.link_user',
        entityId: memberId,
        newValues: { member_id: memberId, user_id: userId },
      });

      return ok(undefined);
    },

    /**
     * Edita los datos básicos de un miembro del comité activo (Requirements
     * 7.x). Requiere `members.update`. Valida antes de persistir.
     */
    async update(ctx, memberId, data): Promise<Result<void>> {
      if (!can(ctx, 'members.update')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para editar miembros.');
      }

      const nameCheck = validateMemberName(data?.fullName);
      if (!nameCheck.ok) return nameCheck as Result<void>;
      const statusCheck = validateMemberStatus(data?.status);
      if (!statusCheck.ok) return statusCheck as Result<void>;
      const phoneCheck = validateMemberPhone(data?.phone);
      if (!phoneCheck.ok) return phoneCheck as Result<void>;
      const notesCheck = validateMemberNotes(data?.notes);
      if (!notesCheck.ok) return notesCheck as Result<void>;

      const client = getClient();

      // Verifica que el miembro pertenezca al comité activo.
      const { data: existing } = await client
        .from('members')
        .select('id')
        .eq('id', memberId)
        .eq('committee_id', ctx.committeeId)
        .maybeSingle();
      if (!existing) return err('member/not-found', 'El miembro indicado no existe en este comité.');

      const { error } = await client
        .from('members')
        .update({
          full_name: nameCheck.value,
          phone: phoneCheck.value,
          position: data.position?.trim() || null,
          status: statusCheck.value,
          notes: notesCheck.value,
          monthly_commitment: data.monthlyCommitment ?? false,
          monthly_amount:
            data.monthlyAmount != null && String(data.monthlyAmount) !== '' ? data.monthlyAmount : 100,
        })
        .eq('id', memberId)
        .eq('committee_id', ctx.committeeId);

      if (error) return err('member/update-failed', `No se pudo actualizar el miembro: ${error.message}.`);

      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'member.update',
        entityId: memberId,
        newValues: { full_name: nameCheck.value, status: statusCheck.value },
      });

      return ok(undefined);
    },

    /**
     * Cambia el estado de un miembro (activo/inactivo/baja) del comité activo.
     * Requiere `members.update`.
     */
    async setStatus(ctx, memberId, status): Promise<Result<void>> {
      if (!can(ctx, 'members.update')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para cambiar el estado de miembros.');
      }
      const statusCheck = validateMemberStatus(status);
      if (!statusCheck.ok) return statusCheck as Result<void>;

      const client = getClient();
      const { data: existing } = await client
        .from('members')
        .select('status')
        .eq('id', memberId)
        .eq('committee_id', ctx.committeeId)
        .maybeSingle();
      if (!existing) return err('member/not-found', 'El miembro indicado no existe en este comité.');

      const { error } = await client
        .from('members')
        .update({ status: statusCheck.value })
        .eq('id', memberId)
        .eq('committee_id', ctx.committeeId);
      if (error) return err('member/status-failed', `No se pudo cambiar el estado: ${error.message}.`);

      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'member.set_status',
        entityId: memberId,
        oldValues: { status: (existing as { status: string }).status },
        newValues: { status: statusCheck.value },
      });

      return ok(undefined);
    },

    /**
     * Elimina un miembro del comité activo. Requiere `members.update`. Se
     * bloquea si el miembro tiene aportaciones registradas o un usuario
     * vinculado (integridad referencial); en ese caso se sugiere darlo de baja.
     */
    async remove(ctx, memberId): Promise<Result<void>> {
      if (!can(ctx, 'members.update')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para eliminar miembros.');
      }
      const client = getClient();

      const { data: existing } = await client
        .from('members')
        .select('id')
        .eq('id', memberId)
        .eq('committee_id', ctx.committeeId)
        .maybeSingle();
      if (!existing) return err('member/not-found', 'El miembro indicado no existe en este comité.');

      // Bloqueo por aportaciones (FK contributions.member_id).
      const { count: contribCount } = await client
        .from('contributions')
        .select('id', { count: 'exact', head: true })
        .eq('committee_id', ctx.committeeId)
        .eq('member_id', memberId);
      if ((contribCount ?? 0) > 0) {
        return err(
          'member/has-contributions',
          'No se puede eliminar: el miembro tiene aportaciones registradas. Dalo de baja en su lugar.',
        );
      }

      // Bloqueo por usuario vinculado (committee_users.member_id).
      const { count: linkCount } = await client
        .from('committee_users')
        .select('id', { count: 'exact', head: true })
        .eq('committee_id', ctx.committeeId)
        .eq('member_id', memberId);
      if ((linkCount ?? 0) > 0) {
        return err(
          'member/linked-user',
          'No se puede eliminar: el miembro tiene una cuenta de usuario vinculada. Dalo de baja en su lugar.',
        );
      }

      const { error } = await client
        .from('members')
        .delete()
        .eq('id', memberId)
        .eq('committee_id', ctx.committeeId);
      if (error) return err('member/delete-failed', `No se pudo eliminar el miembro: ${error.message}.`);

      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'member.delete',
        entityId: memberId,
        oldValues: { member_id: memberId },
      });

      return ok(undefined);
    },
  };
}

// ── Auditoría ─────────────────────────────────────────────────────────────────

interface AuditInput {
  committeeId: UUID;
  userId: UUID;
  action: string;
  entityId: UUID;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

/**
 * Escribe un registro de auditoría atribuible a usuario y fecha (Requirements
 * 36.1). No propaga errores de auditoría para no enmascarar el éxito de la
 * operación de negocio; los registra por consola.
 */
async function recordAudit(client: SupabaseClient, entry: AuditInput): Promise<void> {
  try {
    const { error } = await client.from('audit_logs').insert({
      committee_id: entry.committeeId,
      user_id: entry.userId,
      entity_type: 'member',
      entity_id: entry.entityId,
      action: entry.action,
      old_values: entry.oldValues ?? null,
      new_values: entry.newValues ?? null,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudo auditar la operación de miembro:', error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('No se pudo auditar la operación de miembro:', e);
  }
}
