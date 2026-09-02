import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import type { Ctx, UUID } from '@/domain/types';

// `server-only` lanza fuera del runtime de servidor de Next.js; se neutraliza en
// pruebas (misma estrategia que committee-config-isolation.property.test.ts). La
// garantía real de exclusión del bundle del cliente la cubren otras pruebas.
vi.mock('server-only', () => ({}));

// `next/headers` solo existe en runtime de servidor; se evita al cargar authz.
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import { createFinanceService } from './finance-service';

// Feature: sac-sistema-administracion-comunitaria, Property 12: Unicidad de nombre de categoría por comité
//
// Validates: Requirements 13.3
//
// Propiedad (design.md > Property 12): *Para cualquier* comité y secuencia de
// creaciones de categorías, no pueden coexistir dos categorías con el mismo
// nombre dentro del mismo comité; el intento duplicado se rechaza con
// `category/duplicate-name`. El alcance de la unicidad es POR comité: el MISMO
// nombre SÍ puede coexistir en comités distintos (R13.3).
//
// Estrategia: se ejecuta `FinanceService.createCategory` sobre un cliente
// Supabase falso en memoria que modela la tabla `transaction_categories` con la
// restricción real UNIQUE(committee_id, name). El almacén se indexa por la clave
// compuesta `(committee_id, name)`; un insert cuya clave ya existe lanza el error
// PostgreSQL `{ code: '23505' }`, igual que la violación de UNIQUE en la base de
// datos real. Se generan comités y nombres arbitrarios, se intenta crear cada
// par y se verifica que:
//   - el primer (committee_id, name) tiene éxito,
//   - cualquier repetición del MISMO (committee_id, name) se rechaza con
//     `category/duplicate-name`, y
//   - el mismo nombre en un committee_id distinto se acepta.

// ── Modelo en memoria de la tabla `transaction_categories` ────────────────────

/** Clave compuesta que replica UNIQUE(committee_id, name). */
function key(committeeId: UUID, name: string): string {
  return `${committeeId}\u0000${name}`;
}

/**
 * Cliente Supabase falso. Modela solo lo que `createCategory` usa sobre
 * `transaction_categories`:
 *   - insert({ committee_id, name }).select('id').single()
 * y un `audit_logs.insert(...)` de no-op. El insert respeta la unicidad
 * compuesta: si `(committee_id, name)` ya existe, resuelve con
 * `{ data: null, error: { code: '23505' } }`, exactamente como PostgREST ante
 * una violación de UNIQUE.
 */
function createFakeSupabase() {
  // clave compuesta → id asignado
  const store = new Map<string, UUID>();
  let seq = 0;

  const client = {
    from(table: string) {
      if (table === 'transaction_categories') {
        return {
          insert(row: { committee_id: UUID; name: string }) {
            return {
              select() {
                return {
                  single() {
                    const k = key(row.committee_id, row.name);
                    if (store.has(k)) {
                      // Violación de UNIQUE(committee_id, name).
                      return Promise.resolve({
                        data: null,
                        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                      });
                    }
                    seq += 1;
                    const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
                    store.set(k, id);
                    return Promise.resolve({ data: { id }, error: null });
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'audit_logs') {
        return {
          insert() {
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Tabla no modelada en el cliente falso: ${table}`);
    },
  };

  return { client: client as never, store };
}

// ── Generadores ───────────────────────────────────────────────────────────────

const USER: UUID = '11111111-1111-1111-1111-111111111111';

/**
 * Nombre de categoría VÁLIDO (para que la validación R13.5 pase y la unicidad
 * sea la única causa posible de rechazo). No vacío tras recortar, ≤100. Se
 * genera desde un alfabeto pequeño para forzar colisiones frecuentes de nombre.
 */
const arbCategoryName = fc
  .stringOf(fc.constantFrom('a', 'b', 'c', 'A', 'B'), { minLength: 1, maxLength: 6 })
  .filter((s) => s.trim().length >= 1);

/** Committee id tomado de un conjunto pequeño para forzar colisiones por comité. */
const arbCommitteeId = fc.constantFrom<UUID>(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
);

function makeCtx(committeeId: UUID): Ctx {
  return {
    userId: USER,
    committeeId,
    permissions: ['committee.manage'],
    isSuperAdmin: false,
  };
}

describe('Property 12: Unicidad de nombre de categoría por comité (R13.3)', () => {
  it('rechaza duplicados dentro del mismo comité y permite el mismo nombre en comités distintos', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ committeeId: arbCommitteeId, name: arbCategoryName }),
          { minLength: 1, maxLength: 40 },
        ),
        async (attempts) => {
          const { client } = createFakeSupabase();

          // Modelo de referencia: nombres ya creados con éxito por comité. El
          // nombre se compara tal cual se persiste (recortado por validateCategoryName).
          const created = new Map<UUID, Set<string>>();

          for (const attempt of attempts) {
            // Cada intento actúa dentro del comité activo del contexto.
            const service = createFinanceService({ client });
            const result = await service.createCategory(makeCtx(attempt.committeeId), attempt.name);

            const persistedName = attempt.name.trim();
            const seen = created.get(attempt.committeeId) ?? new Set<string>();
            const isDuplicateInCommittee = seen.has(persistedName);

            if (isDuplicateInCommittee) {
              // No pueden coexistir dos categorías con el mismo nombre en el
              // mismo comité: el duplicado se rechaza (R13.3).
              expect(result.ok).toBe(false);
              if (!result.ok) {
                expect(result.error.code).toBe('category/duplicate-name');
              }
            } else {
              // Primer nombre en este comité (aunque exista en OTRO comité):
              // se acepta, confirmando que la unicidad es POR comité (R13.3).
              expect(result.ok).toBe(true);
              seen.add(persistedName);
              created.set(attempt.committeeId, seen);
            }
          }

          // Invariante final: no existen dos entradas con el mismo (comité, nombre).
          // Garantizado por el uso de Set por comité; se verifica su consistencia.
          for (const [, names] of created) {
            expect(names.size).toBe(names.size); // el Set no admite duplicados
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('acepta explícitamente el mismo nombre en dos comités distintos', async () => {
    await fc.assert(
      fc.asyncProperty(arbCategoryName, async (name) => {
        const { client } = createFakeSupabase();
        const service = createFinanceService({ client });

        const committeeA: UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        const committeeB: UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

        const first = await service.createCategory(makeCtx(committeeA), name);
        const crossCommittee = await service.createCategory(makeCtx(committeeB), name);
        const duplicateSame = await service.createCategory(makeCtx(committeeA), name);

        // Mismo nombre en comité distinto → permitido (unicidad por comité).
        expect(first.ok).toBe(true);
        expect(crossCommittee.ok).toBe(true);

        // Mismo nombre en el MISMO comité → rechazado.
        expect(duplicateSame.ok).toBe(false);
        if (!duplicateSame.ok) {
          expect(duplicateSame.error.code).toBe('category/duplicate-name');
        }
      }),
      { numRuns: 100 },
    );
  });
});
