import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { assertCommitteeAccess, can } from '@/server/authz';

/**
 * RoleService — asignación de roles predefinidos a usuarios de un comité
 * (Requirements 5.1, 5.2, 5.3, 5.4).
 *
 * Implementa la porción de "Authorization" de design.md relativa a la
 * asignación de roles:
 *  - `assignRole`: requiere el permiso `users.manage` (R5.x); valida que el rol
 *    pertenezca a los 9 predefinidos (R5.1, R5.3); valida que el usuario sea
 *    miembro ACTIVO del comité activo (R5.4); registra la asignación en
 *    `user_roles` vinculada al `committee_id` (R5.2) manejando la restricción
 *    UNIQUE(committee_id, user_id, role_id) de forma idempotente; y audita.
 *
 * SEGURIDAD (Requirements 40.2, 40.3): `server-only` impide que este módulo
 * llegue al bundle del navegador. Usa el cliente admin (`service_role`) porque
 * la asignación de roles es una operación administrativa que debe resolver
 * `roles`/`committee_users` y escribir en `user_roles` y `audit_logs` con
 * independencia de las políticas RLS del usuario que invoca.
 */

// ── Constantes de dominio ─────────────────────────────────────────────────────

/**
 * Catálogo cerrado de los 9 roles predefinidos (Requirements 5.1). Debe
 * coincidir con el CHECK de `roles.key` de la migración 0002.
 */
export const PREDEFINED_ROLE_KEYS = [
  'superadmin',
  'committee_admin',
  'president',
  'treasurer',
  'secretary',
  'clerk',
  'bonus_seller',
  'auditor',
  'member',
] as const;

export type RoleKey = (typeof PREDEFINED_ROLE_KEYS)[number];

/** Permiso requerido para administrar roles de usuarios (Requirements 6.1). */
export const USERS_MANAGE_PERMISSION = 'users.manage';

/** Verifica que un valor sea una de las 9 claves de rol predefinidas (R5.1, R5.3). */
export function isPredefinedRole(roleKey: unknown): roleKey is RoleKey {
  return (
    typeof roleKey === 'string' &&
    (PREDEFINED_ROLE_KEYS as readonly string[]).includes(roleKey)
  );
}

// ── Dependencias inyectables ──────────────────────────────────────────────────

/** Dependencias inyectables (permite simular Supabase en pruebas). */
export interface RoleServiceDeps {
  client?: SupabaseClient;
}

// ── Contrato del servicio ─────────────────────────────────────────────────────

/** Rol asignado (clave + etiqueta legible). */
export interface AssignedRole {
  key: string;
  name: string;
}

/** Usuario del comité con su perfil, correo y roles asignados. */
export interface CommitteeUserRow {
  userId: UUID;
  fullName: string | null;
  email: string | null;
  status: string;
  roles: AssignedRole[];
}

/** Catálogo de roles asignables (clave + etiqueta). */
export interface RoleOption {
  key: string;
  name: string;
}

export interface RoleService {
  /**
   * Asigna uno de los 9 roles predefinidos a un usuario que sea miembro activo
   * del comité activo del contexto (Requirements 5.1–5.4).
   */
  assignRole(
    ctx: Ctx,
    targetUserId: UUID,
    roleKey: string,
  ): Promise<Result<{ userRoleId: UUID }>>;
  /** Retira un rol de un usuario en el comité activo (users.manage). */
  removeRole(ctx: Ctx, targetUserId: UUID, roleKey: string): Promise<Result<void>>;
  /** Lista los usuarios del comité activo con su perfil, correo y roles. */
  listCommitteeUsersWithRoles(ctx: Ctx): Promise<Result<CommitteeUserRow[]>>;
  /** Catálogo de roles asignables (excluye superadmin, que es de plataforma). */
  listRoles(ctx: Ctx): Promise<Result<RoleOption[]>>;
}

/**
 * Crea una instancia de RoleService sobre Supabase.
 *
 * Por defecto usa el cliente admin (`service_role`). Las pruebas pueden inyectar
 * un cliente simulado.
 */
export function createRoleService(deps: RoleServiceDeps = {}): RoleService {
  const getClient = (): SupabaseClient => deps.client ?? createSupabaseAdminClient();

  return {
    async assignRole(ctx, targetUserId, roleKey): Promise<Result<{ userRoleId: UUID }>> {
      // R5.x: requiere el permiso users.manage (o superadministrador).
      if (!can(ctx, USERS_MANAGE_PERMISSION)) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para asignar roles a usuarios.',
        );
      }

      // Solo el comité activo del administrador (o superadmin); audita el
      // intento ajeno (R2.3, R2.5, R2.6).
      try {
        await assertCommitteeAccess(ctx, ctx.committeeId);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado al comité solicitado.');
      }

      // R5.1/R5.3: el rol debe pertenecer a los 9 predefinidos.
      if (!isPredefinedRole(roleKey)) {
        return err(
          'role/invalid-role',
          'El rol indicado no es válido.',
          'roleKey',
        );
      }

      if (typeof targetUserId !== 'string' || targetUserId.trim().length === 0) {
        return err(
          'role/invalid-user',
          'El usuario indicado no es válido.',
          'targetUserId',
        );
      }

      const client = getClient();

      // R5.4: el usuario objetivo debe ser miembro ACTIVO del comité activo.
      const { data: membership, error: membershipError } = await client
        .from('committee_users')
        .select('id')
        .eq('committee_id', ctx.committeeId)
        .eq('user_id', targetUserId)
        .eq('status', 'active')
        .maybeSingle();

      if (membershipError) {
        return err(
          'role/membership-check-failed',
          `No se pudo verificar la membresía del usuario: ${membershipError.message}.`,
        );
      }
      if (!membership) {
        return err(
          'role/not-a-member',
          'El usuario no es miembro del comité.',
          'targetUserId',
        );
      }

      // Resuelve el id del rol a partir de su clave predefinida.
      const { data: role, error: roleError } = await client
        .from('roles')
        .select('id')
        .eq('key', roleKey)
        .maybeSingle();

      if (roleError) {
        return err(
          'role/lookup-failed',
          `No se pudo resolver el rol indicado: ${roleError.message}.`,
        );
      }
      if (!role) {
        // Defensa en profundidad: el catálogo debería contener las 9 claves.
        return err('role/invalid-role', 'El rol indicado no es válido.', 'roleKey');
      }

      const roleId = (role as { id: UUID }).id;

      // R5.2: registra la asignación vinculada al committee_id activo. La
      // restricción UNIQUE(committee_id, user_id, role_id) impide duplicados;
      // se maneja con upsert idempotente para no fallar si el rol ya estaba
      // asignado, devolviendo el id existente.
      const { data: assigned, error: insertError } = await client
        .from('user_roles')
        .upsert(
          {
            committee_id: ctx.committeeId,
            user_id: targetUserId,
            role_id: roleId,
          },
          { onConflict: 'committee_id,user_id,role_id' },
        )
        .select('id')
        .single();

      if (insertError || !assigned) {
        return err(
          'role/assign-failed',
          `No se pudo registrar la asignación de rol: ${
            insertError?.message ?? 'error desconocido'
          }.`,
        );
      }

      const userRoleId = (assigned as { id: UUID }).id;

      // Auditoría de la asignación, atribuible al usuario (R36.1).
      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'user_role.assign',
        entityId: userRoleId,
        newValues: { user_id: targetUserId, role_id: roleId, role_key: roleKey },
      });

      return ok({ userRoleId });
    },

    async removeRole(ctx, targetUserId, roleKey): Promise<Result<void>> {
      if (!can(ctx, USERS_MANAGE_PERMISSION)) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para retirar roles a usuarios.');
      }
      try {
        await assertCommitteeAccess(ctx, ctx.committeeId);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado al comité solicitado.');
      }
      if (!isPredefinedRole(roleKey)) {
        return err('role/invalid-role', 'El rol indicado no es válido.', 'roleKey');
      }

      const client = getClient();

      const { data: role } = await client.from('roles').select('id').eq('key', roleKey).maybeSingle();
      if (!role) return err('role/invalid-role', 'El rol indicado no es válido.', 'roleKey');
      const roleId = (role as { id: UUID }).id;

      const { error } = await client
        .from('user_roles')
        .delete()
        .eq('committee_id', ctx.committeeId)
        .eq('user_id', targetUserId)
        .eq('role_id', roleId);

      if (error) {
        return err('role/remove-failed', `No se pudo retirar el rol: ${error.message}.`);
      }

      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'user_role.revoke',
        entityId: targetUserId,
        oldValues: { user_id: targetUserId, role_id: roleId, role_key: roleKey },
      });

      return ok(undefined);
    },

    async listCommitteeUsersWithRoles(ctx): Promise<Result<CommitteeUserRow[]>> {
      if (!can(ctx, USERS_MANAGE_PERMISSION)) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para consultar los usuarios del comité.');
      }
      const client = getClient();

      // Miembros de la app (usuarios) del comité.
      const { data: cu, error: cuErr } = await client
        .from('committee_users')
        .select('user_id, status')
        .eq('committee_id', ctx.committeeId);
      if (cuErr) return err('users/list-failed', `No se pudieron listar los usuarios: ${cuErr.message}.`);

      const userIds = ((cu ?? []) as { user_id: UUID; status: string }[]).map((r) => r.user_id);
      if (userIds.length === 0) return ok([]);

      // Perfiles (full_name).
      const { data: profiles } = await client
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      const nameById = new Map<string, string | null>(
        ((profiles ?? []) as { id: UUID; full_name: string | null }[]).map((p) => [p.id, p.full_name]),
      );

      // Roles por usuario en este comité.
      const { data: userRoles } = await client
        .from('user_roles')
        .select('user_id, roles(key, name)')
        .eq('committee_id', ctx.committeeId)
        .in('user_id', userIds);
      const rolesByUser = new Map<string, AssignedRole[]>();
      for (const r of (userRoles ?? []) as { user_id: UUID; roles: unknown }[]) {
        const rel = r.roles;
        const role = Array.isArray(rel) ? rel[0] : rel;
        if (!role) continue;
        const item = { key: (role as { key: string }).key, name: (role as { name: string }).name };
        const list = rolesByUser.get(r.user_id) ?? [];
        list.push(item);
        rolesByUser.set(r.user_id, list);
      }

      // Correos desde auth.users (solo con el cliente admin/service_role).
      const emailById = new Map<string, string | null>();
      try {
        const { data: authList } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
        for (const u of authList?.users ?? []) {
          if (userIds.includes(u.id)) emailById.set(u.id, u.email ?? null);
        }
      } catch {
        // Si no se puede leer auth.users, se omite el correo (no bloquea).
      }

      const rows: CommitteeUserRow[] = ((cu ?? []) as { user_id: UUID; status: string }[]).map((r) => ({
        userId: r.user_id,
        fullName: nameById.get(r.user_id) ?? null,
        email: emailById.get(r.user_id) ?? null,
        status: r.status,
        roles: (rolesByUser.get(r.user_id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      }));
      rows.sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''));
      return ok(rows);
    },

    async listRoles(ctx): Promise<Result<RoleOption[]>> {
      if (!can(ctx, USERS_MANAGE_PERMISSION)) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para consultar los roles.');
      }
      const client = getClient();
      const { data, error } = await client
        .from('roles')
        .select('key, name')
        .neq('key', 'superadmin') // superadmin es de plataforma, no asignable por comité
        .order('name', { ascending: true });
      if (error) return err('roles/list-failed', `No se pudieron listar los roles: ${error.message}.`);
      return ok(((data ?? []) as { key: string; name: string }[]).map((r) => ({ key: r.key, name: r.name })));
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
      entity_type: 'user_role',
      entity_id: entry.entityId,
      action: entry.action,
      old_values: entry.oldValues ?? null,
      new_values: entry.newValues ?? null,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudo auditar la asignación de rol:', error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('No se pudo auditar la asignación de rol:', e);
  }
}
