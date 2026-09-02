import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import type { Ctx, UUID } from '@/domain/types';

// `server-only` lanza fuera del runtime de servidor de Next.js; se neutraliza en
// pruebas (misma estrategia que multitenant-isolation.property.test.ts). La
// garantía real de exclusión del bundle del cliente la cubren otras pruebas.
vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

import { createCommitteeService } from './committee-service';
import type { CommitteeConfigPatch } from './committee-service';

/**
 * Feature: sac-sistema-administracion-comunitaria, Property 2: Modificar la
 * configuración de un comité preserva los demás
 *
 * Validates: Requirements 3.2
 *
 * Propiedad (design.md > Property 2): *Para cualquier* conjunto de comités con
 * configuración arbitraria, modificar la configuración de uno deja intacta la
 * configuración de todos los comités con `committee_id` distinto.
 *
 * Estrategia: se ejecuta `CommitteeService.updateConfig` sobre un cliente
 * Supabase falso en memoria que modela fielmente la tabla `committees`. El
 * punto clave del modelo es que `update(...).eq('id', id)` SOLO muta la fila
 * cuyo `id` coincide (igual que el alcance real de `.eq('id', id)` sobre
 * PostgREST). Tras aplicar un parche válido a UN comité objetivo, se verifica:
 *   - que todos los demás comités quedan byte-for-byte idénticos, y
 *   - que el comité objetivo refleja el parche aplicado.
 */

// ── Modelo en memoria de una fila de `committees` ─────────────────────────────

interface CommitteeRow {
  id: UUID;
  name: string;
  locality: string | null;
  phone: string | null;
  email: string | null;
  finance_settings: Record<string, unknown>;
  bonus_settings: Record<string, unknown>;
  settings: Record<string, unknown>;
}

/**
 * Cliente Supabase falso en memoria. Modela solo lo que `updateConfig` usa:
 *   - `from('committees').select(cols).eq('id', id).single()`
 *   - `from('committees').update(patch).eq('id', id)`
 *   - `from('audit_logs').insert(row)`
 *
 * El `.eq('id', id)` acumula un filtro que restringe tanto la lectura como la
 * escritura a la fila coincidente, igual que el alcance real de PostgREST.
 */
function createFakeSupabase(store: Map<UUID, CommitteeRow>) {
  const auditInserts: unknown[] = [];

  const committeesQuery = () => {
    const filters: Array<{ column: string; value: unknown }> = [];
    let mode: 'select' | 'update' = 'select';
    let selectedCols: string[] = [];
    let updatePatch: Record<string, unknown> | null = null;

    const matches = (row: CommitteeRow): boolean =>
      filters.every(
        (f) => (row as unknown as Record<string, unknown>)[f.column] === f.value,
      );

    const builder: Record<string, unknown> = {
      select(cols: string) {
        mode = 'select';
        selectedCols = cols.split(',').map((c) => c.trim());
        return builder;
      },
      update(patch: Record<string, unknown>) {
        mode = 'update';
        updatePatch = patch;
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        // Para un `update`, el efecto se aplica al resolver el thenable; para un
        // `select`, `single()` cierra la cadena. Ejecutamos el update aquí de
        // forma perezosa mediante el thenable de abajo.
        if (mode === 'update') {
          return makeThenable();
        }
        return builder;
      },
      single() {
        const found = [...store.values()].find(matches);
        if (!found) {
          return Promise.resolve({ data: null, error: { message: 'not found' } });
        }
        const projected: Record<string, unknown> = {};
        for (const col of selectedCols) {
          projected[col] = (found as unknown as Record<string, unknown>)[col];
        }
        return Promise.resolve({ data: projected, error: null });
      },
    };

    // El resultado de `update(...).eq(...)` es un thenable que aplica la
    // mutación SOLO a las filas que coinciden con los filtros acumulados.
    function makeThenable() {
      const apply = () => {
        for (const row of store.values()) {
          if (matches(row)) {
            Object.assign(row, updatePatch);
          }
        }
        return { data: null, error: null };
      };
      return {
        then: (
          resolve: (v: { data: null; error: null }) => unknown,
        ) => Promise.resolve(apply()).then(resolve),
      };
    }

    return builder;
  }

  const client = {
    from(table: string) {
      if (table === 'committees') {
        return committeesQuery();
      }
      if (table === 'audit_logs') {
        return {
          insert(row: unknown) {
            auditInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Tabla no modelada en el cliente falso: ${table}`);
    },
  };

  return { client: client as never, auditInserts };
}

// ── Generadores ───────────────────────────────────────────────────────────────

const uuidLike = fc.uuid();

/** Valor JSON arbitrario y estable para settings. */
const arbSettings = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }),
  fc.oneof(
    fc.string({ maxLength: 12 }),
    fc.integer(),
    fc.boolean(),
  ),
  { maxKeys: 4 },
);

/** Texto de configuración válido (no vacío tras recortar, ≤120 caracteres). */
const arbConfigText = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length >= 1 && s.trim().length <= 120);

/** Fila arbitraria de comité. */
const arbCommitteeRow = (id: UUID): fc.Arbitrary<CommitteeRow> =>
  fc.record({
    id: fc.constant(id),
    name: fc
      .string({ minLength: 1, maxLength: 40 })
      .filter((s) => s.trim().length >= 1 && s.trim().length <= 150),
    locality: fc.option(arbConfigText, { nil: null }),
    phone: fc.option(arbConfigText, { nil: null }),
    email: fc.option(arbConfigText, { nil: null }),
    finance_settings: arbSettings,
    bonus_settings: arbSettings,
    settings: arbSettings,
  });

/**
 * Parche de configuración VÁLIDO (para que la operación tenga éxito y realmente
 * mute el objetivo). Al menos un campo presente.
 */
const arbValidPatch: fc.Arbitrary<CommitteeConfigPatch> = fc
  .record(
    {
      name: fc
        .string({ minLength: 1, maxLength: 40 })
        .filter((s) => s.trim().length >= 1 && s.trim().length <= 150),
      locality: fc.oneof(arbConfigText, fc.constant(null)),
      phone: fc.oneof(arbConfigText, fc.constant(null)),
      email: fc.oneof(arbConfigText, fc.constant(null)),
      financeSettings: arbSettings,
      bonusSettings: arbSettings,
      settings: arbSettings,
    },
    { requiredKeys: [] },
  )
  .filter((p) => Object.keys(p).length > 0);

describe('Property 2: Modificar la configuración de un comité preserva los demás (R3.2)', () => {
  it('updateConfig sobre un comité deja intactos todos los demás y refleja el parche en el objetivo', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .uniqueArray(uuidLike, { minLength: 2, maxLength: 6 })
          .chain((committeeIds) =>
            fc.record({
              committeeIds: fc.constant(committeeIds),
              rows: fc.tuple(
                ...committeeIds.map((id) => arbCommitteeRow(id)),
              ),
              targetIndex: fc.nat({ max: committeeIds.length - 1 }),
              patch: arbValidPatch,
              userId: uuidLike,
              isSuperAdmin: fc.boolean(),
            }),
          ),
        async (scenario) => {
          const { committeeIds, rows, targetIndex, patch, userId, isSuperAdmin } =
            scenario;

          const targetId = committeeIds[targetIndex]!;

          // Estado inicial del almacén.
          const store = new Map<UUID, CommitteeRow>();
          for (const row of rows) {
            store.set(row.id, { ...row });
          }

          // Snapshot profundo de los comités NO objetivo, antes del cambio.
          const beforeOthers = new Map<UUID, string>();
          for (const [id, row] of store) {
            if (id !== targetId) {
              beforeOthers.set(id, JSON.stringify(row));
            }
          }

          const { client } = createFakeSupabase(store);

          // Contexto autorizado: superadmin, o administrador del comité objetivo
          // con permiso committee.manage y comité activo = objetivo. En ambos
          // casos assertCommitteeAccess concede acceso.
          const ctx: Ctx = {
            userId,
            committeeId: targetId,
            permissions: ['committee.manage'],
            isSuperAdmin,
          };

          const service = createCommitteeService({ client });
          const result = await service.updateConfig(ctx, targetId, patch);

          // La operación válida debe tener éxito (R3.2 aplica al camino exitoso).
          expect(result.ok).toBe(true);

          // 1) Todos los comités con committee_id distinto quedan byte-for-byte
          //    idénticos (R3.2).
          for (const [id, snapshot] of beforeOthers) {
            expect(JSON.stringify(store.get(id))).toBe(snapshot);
          }

          // 2) El comité objetivo refleja el parche aplicado.
          const target = store.get(targetId)!;
          if (patch.name !== undefined) {
            expect(target.name).toBe(patch.name.trim());
          }
          if (patch.locality !== undefined) {
            expect(target.locality).toBe(
              patch.locality === null ? null : patch.locality.trim(),
            );
          }
          if (patch.phone !== undefined) {
            expect(target.phone).toBe(
              patch.phone === null ? null : patch.phone.trim(),
            );
          }
          if (patch.email !== undefined) {
            expect(target.email).toBe(
              patch.email === null ? null : patch.email.trim(),
            );
          }
          if (patch.financeSettings !== undefined) {
            expect(target.finance_settings).toEqual(patch.financeSettings);
          }
          if (patch.bonusSettings !== undefined) {
            expect(target.bonus_settings).toEqual(patch.bonusSettings);
          }
          if (patch.settings !== undefined) {
            expect(target.settings).toEqual(patch.settings);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
