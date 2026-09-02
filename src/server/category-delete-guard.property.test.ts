import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import type { Ctx, UUID } from '@/domain/types';

// `server-only` lanza fuera del runtime de servidor de Next.js; se neutraliza en
// pruebas (misma estrategia que las demás pruebas de propiedad del servidor). La
// garantía real de exclusión del bundle del cliente la cubren otras pruebas.
vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

import { createFinanceService } from './finance-service';

/**
 * Feature: sac-sistema-administracion-comunitaria, Property 13: No se elimina
 * una categoría con ingresos asociados
 *
 * Validates: Requirements 13.4
 *
 * Propiedad (design.md > Property 13): *Para cualquier* cantidad N de
 * transacciones (ingresos) asociadas a una categoría existente del comité,
 * `FinanceService.deleteCategory`:
 *   - RECHAZA la eliminación con el código de error `category/in-use` y NO
 *     ejecuta ningún DELETE cuando N >= 1, y
 *   - ELIMINA la categoría (Result ok) ejecutando exactamente un DELETE cuando
 *     N == 0.
 *
 * Estrategia: se ejecuta `deleteCategory` sobre un cliente Supabase falso en
 * memoria que modela fielmente las tres consultas que usa la operación:
 *   1. `from('transaction_categories').select('name, committee_id')
 *        .eq('id', id).eq('committee_id', cid).single()` → categoría existente.
 *   2. `from('financial_transactions').select('id', { count:'exact', head:true })
 *        .eq('committee_id', cid).eq('category_id', id)` → retorna el conteo N.
 *   3. `from('transaction_categories').delete().eq('id', id).eq('committee_id', cid)`
 *        → registra que se ejecutó una eliminación.
 * Se genera N arbitrario (incluyendo 0 y valores grandes) y se afirma el bicondicional
 * entre N y el resultado, además de rastrear si realmente se emitió un DELETE.
 */

// ── Modelo en memoria del cliente Supabase falso ──────────────────────────────

interface FakeState {
  /** Categoría existente en el comité (id + nombre). */
  categoryId: UUID;
  committeeId: UUID;
  categoryName: string;
  /** Conteo de transacciones asociadas a la categoría (N generado). */
  transactionCount: number;
}

/**
 * Cliente Supabase falso. Modela solo lo que `deleteCategory` usa y rastrea si
 * se ejecutó un DELETE sobre `transaction_categories`.
 */
function createFakeSupabase(state: FakeState) {
  let deleteCount = 0;
  const auditInserts: unknown[] = [];

  const matchesCategory = (filters: Map<string, unknown>): boolean =>
    filters.get('id') === state.categoryId &&
    filters.get('committee_id') === state.committeeId;

  const client = {
    from(table: string) {
      if (table === 'transaction_categories') {
        const filters = new Map<string, unknown>();
        let mode: 'select' | 'delete' = 'select';

        const builder: Record<string, unknown> = {
          select() {
            mode = 'select';
            return builder;
          },
          delete() {
            mode = 'delete';
            return builder;
          },
          eq(column: string, value: unknown) {
            filters.set(column, value);
            // El DELETE encadena dos `.eq(...)` y se resuelve al ser await-eado
            // (thenable). El thenable sigue siendo encadenable con más `.eq(...)`
            // para reflejar `.delete().eq('id', id).eq('committee_id', cid)`. El
            // SELECT se cierra con `.single()`.
            if (mode === 'delete') {
              return makeDeleteThenable();
            }
            return builder;
          },
          single() {
            if (matchesCategory(filters)) {
              return Promise.resolve({
                data: { name: state.categoryName, committee_id: state.committeeId },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: { message: 'not found' } });
          },
        };

        function makeDeleteThenable(): Record<string, unknown> {
          const apply = () => {
            if (matchesCategory(filters)) {
              deleteCount += 1;
            }
            return { data: null, error: null };
          };
          const thenable: Record<string, unknown> = {
            eq(column: string, value: unknown) {
              filters.set(column, value);
              return thenable;
            },
            then: (resolve: (v: { data: null; error: null }) => unknown) =>
              Promise.resolve(apply()).then(resolve),
          };
          return thenable;
        }

        return builder;
      }

      if (table === 'financial_transactions') {
        const filters = new Map<string, unknown>();
        const builder: Record<string, unknown> = {
          select() {
            return builder;
          },
          eq(column: string, value: unknown) {
            filters.set(column, value);
            return makeCountThenable();
          },
        };

        // El conteo se resuelve al ser await-eado (thenable con { count, error }).
        function makeCountThenable() {
          const resolveCount = () => {
            const matches =
              filters.get('committee_id') === state.committeeId &&
              filters.get('category_id') === state.categoryId;
            return { count: matches ? state.transactionCount : 0, error: null };
          };
          return {
            ...builder,
            then: (resolve: (v: { count: number; error: null }) => unknown) =>
              Promise.resolve(resolveCount()).then(resolve),
          };
        }

        return builder;
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

  return {
    client: client as never,
    getDeleteCount: () => deleteCount,
    auditInserts,
  };
}

// ── Generadores ───────────────────────────────────────────────────────────────

const uuidLike = fc.uuid();

/**
 * Cantidad N de transacciones asociadas. Se sesga para cubrir explícitamente el
 * límite (0 y 1) y también valores grandes.
 */
const arbTransactionCount = fc.oneof(
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 1, arbitrary: fc.constant(1) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 5_000 }) },
);

describe('Property 13: No se elimina una categoría con ingresos asociados (R13.4)', () => {
  it('deleteCategory rechaza (category/in-use, sin DELETE) sii N>=1 y elimina (con DELETE) sii N==0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          categoryId: uuidLike,
          committeeId: uuidLike,
          categoryName: fc
            .string({ minLength: 1, maxLength: 40 })
            .filter((s) => s.trim().length >= 1 && s.trim().length <= 100),
          transactionCount: arbTransactionCount,
          userId: uuidLike,
          isSuperAdmin: fc.boolean(),
        }),
        async (scenario) => {
          const state: FakeState = {
            categoryId: scenario.categoryId,
            committeeId: scenario.committeeId,
            categoryName: scenario.categoryName,
            transactionCount: scenario.transactionCount,
          };

          const { client, getDeleteCount } = createFakeSupabase(state);

          // Contexto autorizado: administrador del comité objetivo con permiso
          // committee.manage (o superadmin), comité activo = comité de la
          // categoría, para que la operación llegue a la comprobación de uso.
          const ctx: Ctx = {
            userId: scenario.userId,
            committeeId: scenario.committeeId,
            permissions: ['committee.manage'],
            isSuperAdmin: scenario.isSuperAdmin,
          };

          const service = createFinanceService({ client });
          const result = await service.deleteCategory(ctx, scenario.categoryId);

          if (scenario.transactionCount >= 1) {
            // N >= 1 → rechazo con category/in-use y NINGÚN DELETE emitido.
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.code).toBe('category/in-use');
            }
            expect(getDeleteCount()).toBe(0);
          } else {
            // N == 0 → éxito y EXACTAMENTE un DELETE emitido.
            expect(result.ok).toBe(true);
            expect(getDeleteCount()).toBe(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
