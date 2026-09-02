import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { assertCommitteeAccess, can } from '@/server/authz';

/**
 * AuditService — registro de auditoría integrado en transacciones y consulta de
 * solo lectura (Requirements 36.1, 36.3, 36.4, 36.5).
 *
 * Implementa la sección "AuditService" de design.md:
 *  - `record(client, entry)`: escribe una fila en `audit_logs` usando el MISMO
 *    cliente/transacción que la operación sensible en curso, de modo que el
 *    registro participe en su transacción y se revierta con ella si falla
 *    (R36.4). EXIGE atribución: `userId` presente; de lo contrario RECHAZA
 *    lanzando `AuditAttributionError` (R36.1, R36.3). La fecha (`created_at`)
 *    la aporta la base de datos con `DEFAULT now()`.
 *  - `query(ctx, filter)`: consulta de SOLO LECTURA de `audit_logs` limitada al
 *    `committee_id` del contexto (R36.5), permitida a usuarios con `audit.read`
 *    (auditor incluido). Admite filtros por tipo/entidad/acción, rango de
 *    fechas y paginación.
 *
 * La inmutabilidad de `audit_logs` se garantiza a nivel de base de datos
 * (sin políticas de UPDATE/DELETE para roles de aplicación) (R36.2).
 *
 * SEGURIDAD (Requirements 40.2, 40.3): `server-only` impide que este módulo
 * llegue al bundle del navegador.
 *
 * NOTA: Los demás servicios (committee/member/finance/role) mantienen sus
 * propios helpers `recordAudit` en línea; este servicio ofrece una pieza
 * reutilizable para flujos transaccionales que necesiten `record` + `query`.
 */

/** Permiso requerido para consultar la auditoría (Requirements 36.5, 6.1). */
export const AUDIT_READ_PERMISSION = 'audit.read' as const;

/** Código de error para atribución faltante al registrar auditoría. */
export const AUDIT_ATTRIBUTION_ERROR_CODE = 'audit/missing-attribution' as const;

/** Tope máximo de resultados por consulta de auditoría (paginación). */
export const AUDIT_QUERY_MAX_LIMIT = 500;
/** Límite por defecto de resultados por consulta de auditoría. */
export const AUDIT_QUERY_DEFAULT_LIMIT = 100;

/**
 * Error lanzado cuando `record` se invoca sin atribución de usuario (R36.1,
 * R36.3). Se lanza (en lugar de devolver `Result`) para que aborte y REVIERTA
 * la transacción de la operación sensible que lo invoca (R36.4).
 */
export class AuditAttributionError extends Error {
  readonly code = AUDIT_ATTRIBUTION_ERROR_CODE;
  constructor(message = 'El registro de auditoría exige atribución de usuario (user_id).') {
    super(message);
    this.name = 'AuditAttributionError';
  }
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

/**
 * Entrada de auditoría a registrar (design.md > AuditService > AuditEntry).
 * `userId` es OBLIGATORIO: constituye la atribución exigida por R36.1/R36.3.
 * `createdAt` NO se acepta como entrada: lo aporta la base de datos.
 */
export interface AuditEntry {
  committeeId: UUID | null;
  userId: UUID;
  entityType: string;
  entityId?: UUID | null;
  action: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
}

/** Fila de auditoría tal como se devuelve en las consultas (R36.5). */
export interface AuditRecord {
  id: UUID;
  committeeId: UUID | null;
  userId: UUID;
  entityType: string;
  entityId: UUID | null;
  action: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

/** Filtros admitidos por la consulta de auditoría (R36.5). */
export interface AuditFilter {
  entityType?: string;
  entityId?: UUID;
  action?: string;
  /** Fecha/hora ISO inclusiva mínima (`created_at >= from`). */
  from?: string;
  /** Fecha/hora ISO inclusiva máxima (`created_at <= to`). */
  to?: string;
  /** Tamaño de página (1..AUDIT_QUERY_MAX_LIMIT; default AUDIT_QUERY_DEFAULT_LIMIT). */
  limit?: number;
  /** Desplazamiento para paginación (>= 0). */
  offset?: number;
}

/** Dependencias inyectables (permite simular Supabase en pruebas). */
export interface AuditServiceDeps {
  client?: SupabaseClient;
}

// ── Validación de atribución ──────────────────────────────────────────────────

/**
 * Comprueba que un valor sea un `user_id` no vacío (atribución mínima exigida
 * por R36.1/R36.3). No valida el formato UUID: la base de datos lo hace.
 */
export function hasAttribution(userId: unknown): userId is UUID {
  return typeof userId === 'string' && userId.trim().length > 0;
}

// ── Servicio ──────────────────────────────────────────────────────────────────

export interface AuditService {
  /**
   * Registra una entrada de auditoría dentro de la transacción de la operación
   * sensible, usando el `client` que ésta le pasa (R36.4). EXIGE `userId`; si
   * falta, lanza `AuditAttributionError` y aborta la transacción (R36.1, R36.3).
   */
  record(client: SupabaseClient, entry: AuditEntry): Promise<void>;

  /**
   * Consulta de solo lectura de `audit_logs` del comité activo (R36.5),
   * permitida a usuarios con `audit.read` (auditor incluido).
   */
  query(ctx: Ctx, filter?: AuditFilter): Promise<Result<AuditRecord[]>>;
}

/**
 * Crea una instancia de `AuditService`. El cliente por defecto es el admin
 * (`service_role`), coherente con los demás servicios del servidor; puede
 * inyectarse un cliente simulado en pruebas o el cliente transaccional en uso.
 */
export function createAuditService(deps: AuditServiceDeps = {}): AuditService {
  const defaultClient = deps.client;

  return {
    async record(client: SupabaseClient, entry: AuditEntry): Promise<void> {
      // Atribución obligatoria: sin user_id se rechaza y se revierte la
      // transacción de la operación sensible (R36.1, R36.3, R36.4).
      if (!hasAttribution(entry.userId)) {
        throw new AuditAttributionError();
      }

      // Se escribe con el MISMO cliente/transacción de la operación sensible
      // para participar en ella y revertirse en caso de fallo (R36.4). NO se
      // captura el error: si la inserción falla, se propaga para abortar y
      // revertir la operación.
      const { error } = await client.from('audit_logs').insert({
        committee_id: entry.committeeId,
        user_id: entry.userId,
        entity_type: entry.entityType,
        entity_id: entry.entityId ?? null,
        action: entry.action,
        old_values: entry.oldValues ?? null,
        new_values: entry.newValues ?? null,
        reason: entry.reason ?? null,
        // created_at lo aporta la base de datos (DEFAULT now()) — atribución de
        // fecha exigida por R36.1/R36.3.
      });

      if (error) {
        throw new Error(`No se pudo registrar la auditoría: ${error.message}`);
      }
    },

    async query(ctx: Ctx, filter: AuditFilter = {}): Promise<Result<AuditRecord[]>> {
      // Solo usuarios con audit.read (auditor incluido) pueden consultar (R36.5).
      if (!can(ctx, AUDIT_READ_PERMISSION)) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para consultar la auditoría.',
        );
      }

      // Aislamiento por comité: la consulta se limita al comité del contexto y
      // se audita cualquier intento fuera de él (R36.5, R2.3, R2.5).
      await assertCommitteeAccess(ctx, ctx.committeeId, { client: defaultClient });

      const client = defaultClient ?? createSupabaseAdminClient();

      const limit = clampLimit(filter.limit);
      const offset = filter.offset != null && filter.offset > 0 ? filter.offset : 0;

      let q = client
        .from('audit_logs')
        .select(
          'id, committee_id, user_id, entity_type, entity_id, action, old_values, new_values, reason, created_at',
        )
        .eq('committee_id', ctx.committeeId);

      if (filter.entityType) q = q.eq('entity_type', filter.entityType);
      if (filter.entityId) q = q.eq('entity_id', filter.entityId);
      if (filter.action) q = q.eq('action', filter.action);
      if (filter.from) q = q.gte('created_at', filter.from);
      if (filter.to) q = q.lte('created_at', filter.to);

      q = q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

      const { data, error } = await q;

      if (error) {
        return err('audit/query-failed', `No se pudo consultar la auditoría: ${error.message}`);
      }

      const rows = (data ?? []) as unknown[];
      return ok(rows.map(mapRow));
    },
  };
}

// ── Utilidades internas ───────────────────────────────────────────────────────

/** Restringe el límite de resultados al rango válido de paginación. */
function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) {
    return AUDIT_QUERY_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), AUDIT_QUERY_MAX_LIMIT);
}

/** Mapea una fila de `audit_logs` (snake_case) al DTO `AuditRecord`. */
function mapRow(row: unknown): AuditRecord {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as UUID,
    committeeId: (r.committee_id as UUID | null) ?? null,
    userId: r.user_id as UUID,
    entityType: r.entity_type as string,
    entityId: (r.entity_id as UUID | null) ?? null,
    action: r.action as string,
    oldValues: (r.old_values as Record<string, unknown> | null) ?? null,
    newValues: (r.new_values as Record<string, unknown> | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}
