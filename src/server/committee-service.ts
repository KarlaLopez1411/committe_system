import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { assertCommitteeAccess, can } from '@/server/authz';

/**
 * CommitteeService — creación, configuración y aislamiento de comités
 * (Requirements 1.1–1.4, 3.1–3.4, 13.2).
 *
 * Implementa la sección "CommitteeService" de design.md:
 *  - `create`: valida nombre (1–150), crea el comité, asigna `committee_id`
 *    único y siembra las categorías iniciales (R1.1–R1.3, R13.2).
 *  - `updateStatus`: cambia el estado del comité del administrador y audita el
 *    cambio con el usuario que lo realizó (R1.4).
 *  - `updateConfig`: aplica cambios ÚNICAMENTE al comité del administrador,
 *    preserva los demás comités sin cambios, valida valores y audita (R3.1–R3.4).
 *  - `seedDefaultCategories`: siembra las 7 categorías iniciales (R13.2).
 *
 * SEGURIDAD (Requirements 40.2, 40.3): `server-only` impide que este módulo
 * llegue al bundle del navegador. Usa el cliente admin (`service_role`) porque
 * la creación de comités y su configuración son operaciones administrativas que
 * también deben poder escribir en `audit_logs`.
 */

// ── Constantes de dominio ─────────────────────────────────────────────────────

/** Estados válidos de un comité (alineado con el CHECK de committees.status). */
export const COMMITTEE_STATUSES = ['active', 'inactive', 'suspended'] as const;
export type CommitteeStatus = (typeof COMMITTEE_STATUSES)[number];

/**
 * Categorías iniciales sembradas al crear un comité (Requirements 13.2).
 * Orden y contenido tomados de RF-040 / R13.2 del documento fuente.
 */
export const DEFAULT_CATEGORIES = [
  'aportaciones',
  'donaciones',
  'bonos',
  'actividades',
  'ventas',
  'cooperacion_extraordinaria',
  'otros',
] as const;

/** Longitud mínima y máxima del nombre del comité (Requirements 1.2). */
export const COMMITTEE_NAME_MIN = 1;
export const COMMITTEE_NAME_MAX = 150;

/**
 * Longitud máxima de valores de configuración textuales, ej. nombres de
 * categoría/cuenta/rol (Requirements 3.4: rechaza si excede 120 caracteres).
 */
export const CONFIG_TEXT_MAX = 120;

// ── DTOs de entrada ───────────────────────────────────────────────────────────

/** Datos de creación de un comité (design.md > CommitteeService). */
export interface CommitteeInput {
  name: string;
  slug?: string | null;
  logoPath?: string | null;
  locality?: string | null;
  phone?: string | null;
  email?: string | null;
  financeSettings?: Record<string, unknown>;
  bonusSettings?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

/**
 * Parche de configuración de un comité. Solo se aplican los campos presentes;
 * los ausentes se preservan (R3.2). Los valores textuales se validan por
 * longitud (R3.4).
 */
export interface CommitteeConfigPatch {
  name?: string;
  locality?: string | null;
  phone?: string | null;
  email?: string | null;
  financeSettings?: Record<string, unknown>;
  bonusSettings?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

/** Dependencias inyectables (permite simular Supabase en pruebas). */
export interface CommitteeServiceDeps {
  client?: SupabaseClient;
}

// ── Utilidades de validación ──────────────────────────────────────────────────

/**
 * Valida el nombre de un comité: no vacío tras recortar y entre 1 y 150
 * caracteres (Requirements 1.2). Devuelve el nombre recortado si es válido.
 */
export function validateCommitteeName(name: unknown): Result<string> {
  if (typeof name !== 'string') {
    return err('committee/invalid-name', 'El nombre del comité es obligatorio.', 'name');
  }
  const trimmed = name.trim();
  if (trimmed.length < COMMITTEE_NAME_MIN) {
    return err('committee/invalid-name', 'El nombre del comité es obligatorio.', 'name');
  }
  if (trimmed.length > COMMITTEE_NAME_MAX) {
    return err(
      'committee/invalid-name',
      `El nombre del comité no puede exceder ${COMMITTEE_NAME_MAX} caracteres.`,
      'name',
    );
  }
  return ok(trimmed);
}

/**
 * Valida un valor textual opcional de configuración por longitud máxima
 * (Requirements 3.4). Un valor vacío tras recortar se considera inválido cuando
 * está presente (por ejemplo, un nombre en blanco).
 */
function validateConfigText(
  value: string,
  field: string,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): Result<string> {
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    return err('committee/invalid-config', `El campo ${field} no puede estar vacío.`, field);
  }
  if (trimmed.length > CONFIG_TEXT_MAX) {
    return err(
      'committee/invalid-config',
      `El campo ${field} no puede exceder ${CONFIG_TEXT_MAX} caracteres.`,
      field,
    );
  }
  return ok(trimmed);
}

// ── Contrato del servicio ─────────────────────────────────────────────────────

export interface CommitteeService {
  create(ctx: Ctx, data: CommitteeInput): Promise<Result<{ committeeId: UUID }>>;
  updateStatus(ctx: Ctx, id: UUID, status: CommitteeStatus): Promise<Result<void>>;
  updateConfig(ctx: Ctx, id: UUID, patch: CommitteeConfigPatch): Promise<Result<void>>;
  seedDefaultCategories(committeeId: UUID): Promise<void>;
}

/**
 * Crea una instancia de CommitteeService sobre Supabase.
 *
 * Por defecto usa el cliente admin (`service_role`), apropiado para la creación
 * de comités por el superadministrador y para escribir auditoría. Las pruebas
 * pueden inyectar un cliente simulado.
 */
export function createCommitteeService(
  deps: CommitteeServiceDeps = {},
): CommitteeService {
  const getClient = (): SupabaseClient => deps.client ?? createSupabaseAdminClient();

  /**
   * Siembra las 7 categorías iniciales para un comité recién creado
   * (Requirements 13.2). Es idempotente frente a la unicidad
   * (committee_id, name): usa upsert ignorando duplicados.
   */
  async function seedDefaultCategories(committeeId: UUID): Promise<void> {
    const client = getClient();
    const rows = DEFAULT_CATEGORIES.map((name) => ({
      committee_id: committeeId,
      name,
    }));
    const { error } = await client
      .from('transaction_categories')
      .upsert(rows, { onConflict: 'committee_id,name', ignoreDuplicates: true });
    if (error) {
      throw new Error(
        `No se pudieron sembrar las categorías iniciales del comité: ${error.message}`,
      );
    }
  }

  return {
    /**
     * Crea un comité con nombre validado (R1.2), asigna `committee_id` único
     * (R1.3) y siembra las categorías iniciales (R13.2). Requiere el permiso
     * `committee.manage` (o superadministrador). R1.1, R44.1.
     */
    async create(ctx, data): Promise<Result<{ committeeId: UUID }>> {
      if (!can(ctx, 'committee.manage')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para crear comités.',
        );
      }

      const nameCheck = validateCommitteeName(data?.name);
      if (!nameCheck.ok) {
        return nameCheck as Result<{ committeeId: UUID }>;
      }

      const client = getClient();
      const { data: created, error } = await client
        .from('committees')
        .insert({
          name: nameCheck.value,
          slug: data.slug ?? null,
          logo_path: data.logoPath ?? null,
          locality: data.locality ?? null,
          phone: data.phone ?? null,
          email: data.email ?? null,
          finance_settings: data.financeSettings ?? {},
          bonus_settings: data.bonusSettings ?? {},
          settings: data.settings ?? {},
        })
        .select('id')
        .single();

      if (error || !created) {
        return err(
          'committee/create-failed',
          `No se pudo crear el comité: ${error?.message ?? 'error desconocido'}.`,
        );
      }

      const committeeId = (created as { id: UUID }).id;

      // Siembra de categorías iniciales al crear (R13.2).
      await seedDefaultCategories(committeeId);

      // Auditoría de la creación, atribuible al usuario (R36.1).
      await recordAudit(client, {
        committeeId,
        userId: ctx.userId,
        action: 'committee.create',
        entityId: committeeId,
        newValues: { name: nameCheck.value, status: 'active' },
      });

      return ok({ committeeId });
    },

    /**
     * Modifica el estado de un comité y registra el nuevo estado junto al
     * usuario que realizó el cambio (Requirements 1.4). Aplica solo al comité
     * del administrador: verifica acceso y permiso `committee.manage`.
     */
    async updateStatus(ctx, id, status): Promise<Result<void>> {
      if (!can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para modificar el comité.');
      }
      if (!COMMITTEE_STATUSES.includes(status)) {
        return err(
          'committee/invalid-status',
          'El estado del comité no es válido.',
          'status',
        );
      }

      // Solo el comité del administrador (o superadmin); audita el intento ajeno.
      try {
        await assertCommitteeAccess(ctx, id);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado al comité solicitado.');
      }

      const client = getClient();

      // Lee el estado previo para auditar old→new (R1.4, R36.1).
      const { data: prev, error: readError } = await client
        .from('committees')
        .select('status')
        .eq('id', id)
        .single();
      if (readError || !prev) {
        return err('committee/not-found', 'El comité indicado no existe.');
      }

      const { error } = await client
        .from('committees')
        .update({ status })
        .eq('id', id);
      if (error) {
        return err(
          'committee/update-failed',
          `No se pudo actualizar el estado del comité: ${error.message}.`,
        );
      }

      await recordAudit(client, {
        committeeId: id,
        userId: ctx.userId,
        action: 'committee.status.update',
        entityId: id,
        oldValues: { status: (prev as { status: string }).status },
        newValues: { status },
      });

      return ok(undefined);
    },

    /**
     * Aplica un parche de configuración ÚNICAMENTE al comité del administrador
     * (R3.1), preservando los demás comités (R3.2), rechazando acceso no
     * autorizado (R3.3) y validando valores (R3.4). Audita el cambio.
     */
    async updateConfig(ctx, id, patch): Promise<Result<void>> {
      // R3.3: sin permiso committee.manage se rechaza como acceso no autorizado.
      if (!can(ctx, 'committee.manage')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'Acceso no autorizado: se requiere el permiso committee.manage.',
        );
      }

      // R3.1/R3.3: solo el comité propio del administrador (o superadmin).
      try {
        await assertCommitteeAccess(ctx, id);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado al comité solicitado.');
      }

      // R3.4: validación de valores. Se construye el update solo con los campos
      // presentes en el parche, preservando el resto sin cambios (R3.2).
      const update: Record<string, unknown> = {};

      if (patch.name !== undefined) {
        const nameCheck = validateCommitteeName(patch.name);
        if (!nameCheck.ok) {
          return nameCheck as Result<void>;
        }
        update.name = nameCheck.value;
      }
      if (patch.locality !== undefined) {
        if (patch.locality !== null) {
          const check = validateConfigText(patch.locality, 'localidad', {
            allowEmpty: true,
          });
          if (!check.ok) return check as Result<void>;
          update.locality = check.value;
        } else {
          update.locality = null;
        }
      }
      if (patch.phone !== undefined) {
        if (patch.phone !== null) {
          const check = validateConfigText(patch.phone, 'teléfono', {
            allowEmpty: true,
          });
          if (!check.ok) return check as Result<void>;
          update.phone = check.value;
        } else {
          update.phone = null;
        }
      }
      if (patch.email !== undefined) {
        if (patch.email !== null) {
          const check = validateConfigText(patch.email, 'correo', {
            allowEmpty: true,
          });
          if (!check.ok) return check as Result<void>;
          update.email = check.value;
        } else {
          update.email = null;
        }
      }
      if (patch.financeSettings !== undefined) {
        update.finance_settings = patch.financeSettings;
      }
      if (patch.bonusSettings !== undefined) {
        update.bonus_settings = patch.bonusSettings;
      }
      if (patch.settings !== undefined) {
        update.settings = patch.settings;
      }

      if (Object.keys(update).length === 0) {
        return err(
          'committee/empty-patch',
          'No se proporcionó ningún cambio de configuración.',
        );
      }

      const client = getClient();

      // R3.4: preservar la configuración previa ante rechazo — se lee para
      // auditoría antes de aplicar (y para confirmar que el comité existe).
      const { data: prev, error: readError } = await client
        .from('committees')
        .select('name, locality, phone, email, finance_settings, bonus_settings, settings')
        .eq('id', id)
        .single();
      if (readError || !prev) {
        return err('committee/not-found', 'El comité indicado no existe.');
      }

      // R3.1/R3.2: el filtro `.eq('id', id)` restringe la escritura al comité
      // del administrador; ningún otro comité se ve afectado.
      const { error } = await client
        .from('committees')
        .update(update)
        .eq('id', id);
      if (error) {
        return err(
          'committee/update-failed',
          `No se pudo actualizar la configuración del comité: ${error.message}.`,
        );
      }

      await recordAudit(client, {
        committeeId: id,
        userId: ctx.userId,
        action: 'committee.config.update',
        entityId: id,
        oldValues: prev as Record<string, unknown>,
        newValues: update,
      });

      return ok(undefined);
    },

    seedDefaultCategories,
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
 * 1.4, 36.1). No propaga errores de auditoría para no enmascarar el éxito de la
 * operación de negocio; los registra por consola.
 */
async function recordAudit(client: SupabaseClient, entry: AuditInput): Promise<void> {
  try {
    const { error } = await client.from('audit_logs').insert({
      committee_id: entry.committeeId,
      user_id: entry.userId,
      entity_type: 'committee',
      entity_id: entry.entityId,
      action: entry.action,
      old_values: entry.oldValues ?? null,
      new_values: entry.newValues ?? null,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudo auditar la operación de comité:', error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('No se pudo auditar la operación de comité:', e);
  }
}
