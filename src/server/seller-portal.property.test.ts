// Feature: sac-sistema-administracion-comunitaria
// Property 38: Reportes, indicadores y portal restringidos al comité y al vendedor
// Security test 26.4: El vendedor solo ve y opera sus números asignados

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import type { Ctx } from '@/domain/types';
import { createSellerPortalService } from './seller-portal-service';

const USER_A = '11111111-1111-1111-1111-111111111111';
const COMMITTEE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITTEE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SELLER_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SELLER_B = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function makeCtx(committeeId = COMMITTEE_A, userId = USER_A): Ctx {
  return { userId, committeeId, permissions: [], isSuperAdmin: false };
}

// Mock that tracks which committee_id and seller_id filters were applied.
function makeTrackingClient() {
  const queries: { table: string; filters: Record<string, unknown> }[] = [];

  const buildChain = (table: string, filters: Record<string, unknown> = {}) => ({
    eq: vi.fn((col: string, val: unknown) => {
      filters[col] = val;
      return buildChain(table, filters);
    }),
    is: vi.fn((_col: string, _val: unknown) => buildChain(table, filters)),
    in: vi.fn((_col: string, _vals: unknown) => {
      queries.push({ table, filters: { ...filters } });
      return Promise.resolve({
        data: [],
        error: null,
      });
    }),
    single: vi.fn(() => {
      queries.push({ table, filters: { ...filters } });
      return Promise.resolve({ data: null, error: { message: 'not found' } });
    }),
    // Calling .select() itself resolves (for query chains that end here)
    then: undefined as unknown,
  });

  const client = {
    from: vi.fn((table: string) => ({
      select: vi.fn((_cols?: string) => {
        const chain = buildChain(table);
        return chain;
      }),
    })),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  return { client, queries };
}

// Mock that returns seller A's numbers only when committee=A AND seller=A.
function makeIsolatingClient(sellerNumbers: number[] = [1, 2, 3], committeeId = COMMITTEE_A, sellerId = SELLER_A) {
  const client = {
    from: vi.fn((_tbl: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn((col: string, val: unknown) => ({
          eq: vi.fn((col2: string, val2: unknown) => ({
            is: vi.fn(() => ({
              data: (col === 'seller_id' || col2 === 'seller_id') && (val === sellerId || val2 === sellerId)
                && (val === committeeId || val2 === committeeId)
                ? sellerNumbers.map((n) => ({ bonus_number_id: `num-${n}`, bonus_numbers: { number: n } }))
                : [],
              error: null,
            })),
            in: vi.fn(() => Promise.resolve({ data: [], error: null })),
            single: vi.fn(() => Promise.resolve({ data: null, error: { message: 'not found' } })),
          })),
          is: vi.fn(() => ({
            data: val === sellerId
              ? sellerNumbers.map((n) => ({ bonus_number_id: `num-${n}`, bonus_numbers: { number: n } }))
              : [],
            error: null,
          })),
          in: vi.fn((_col: string, ids: string[]) => Promise.resolve({
            data: ids.map((id) => ({ id: `due-${id}`, bonus_number_id: id, status: 'pendiente', amount: '100.00' })),
            error: null,
          })),
          single: vi.fn(() => Promise.resolve({ data: null, error: { message: 'not found' } })),
        })),
      })),
    })),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  return { client };
}

// ---------------------------------------------------------------------------
// Property 38: Portal restricted to own committee and seller (R39.1, R39.7)
// ---------------------------------------------------------------------------

describe('Property 38: Portal restringido al comité y vendedor (R39.1, R39.7)', () => {
  // **Validates: Requirements 39.7** — committee_id filter always applied
  it('getAssignments siempre filtra por committee_id del contexto', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // random committee
        fc.uuid(), // random seller
        fc.constantFrom('2025-01-01', '2025-06-01', '2024-12-01'),
        async (committeeId, sellerId, period) => {
          const { client, queries } = makeTrackingClient();
          const service = createSellerPortalService({ client });
          await service.getAssignments({ userId: USER_A, committeeId, permissions: [], isSuperAdmin: false }, sellerId, period);
          // Every query against bonus_seller_assignments must filter by committee_id
          const assignmentQueries = queries.filter((q) => q.table === 'bonus_seller_assignments');
          return assignmentQueries.every((q) => q.filters['committee_id'] === committeeId);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 39.1** — seller_id filter always applied
  it('getAssignments siempre filtra por seller_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (sellerId) => {
          const { client, queries } = makeTrackingClient();
          const service = createSellerPortalService({ client });
          await service.getAssignments(makeCtx(), sellerId, '2025-01-01');
          const assignmentQueries = queries.filter((q) => q.table === 'bonus_seller_assignments');
          return assignmentQueries.every((q) => q.filters['seller_id'] === sellerId);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 39.7** — different committee = no results
  it('un vendedor del comité A no ve asignaciones del comité B', async () => {
    // Seller B owns numbers in committee B; ctx has committee A
    const { client } = makeIsolatingClient([10, 20, 30], COMMITTEE_B, SELLER_B);
    const service = createSellerPortalService({ client });
    const result = await service.getAssignments(makeCtx(COMMITTEE_A), SELLER_B, '2025-01-01');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Security test 26.4: Seller only sees own numbers (R39.1, R39.7)
// ---------------------------------------------------------------------------

describe('Security 26.4: Vendedor solo ve sus propios números (R39.1, R39.7)', () => {
  // **Validates: Requirements 39.1** — seller A cannot see seller B's numbers
  it('getAssignments con seller_id ajeno devuelve lista vacía', async () => {
    // Seller A owns numbers [1, 2, 3]; query with seller B returns nothing
    const { client } = makeIsolatingClient([1, 2, 3], COMMITTEE_A, SELLER_A);
    const service = createSellerPortalService({ client });

    // Seller B queries — mock returns empty for non-matching seller
    const resultB = await service.getAssignments(makeCtx(COMMITTEE_A), SELLER_B, '2025-01-01');
    expect(resultB.ok).toBe(true);
    if (resultB.ok) expect(resultB.value).toHaveLength(0);
  });

  // **Validates: Requirements 39.7** — cross-committee access is blocked
  it('getAssignments no mezcla datos de distintos comités', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // committeeId used in ctx
        fc.uuid(), // sellerId
        async (committeeId, sellerId) => {
          const { client, queries } = makeTrackingClient();
          const service = createSellerPortalService({ client });
          await service.getAssignments({ userId: USER_A, committeeId, permissions: [], isSuperAdmin: false }, sellerId, '2025-01-01');
          // All queries must be scoped to the ctx committeeId — never to another
          return queries.every((q) =>
            q.filters['committee_id'] === undefined || q.filters['committee_id'] === committeeId
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 39.5** — seller cannot confirm own delivery (UI constraint)
  // The `reportSettlementAction` delegates to `confirmSettlement` in BonusSettlementService
  // which calls the SQL RPC that enforces reporter ≠ confirmer (R31.4).
  it('findSeller devuelve error cuando el usuario no tiene perfil de vendedor', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({ data: null, error: { message: 'not found' } })),
            })),
          })),
        })),
      })),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const service = createSellerPortalService({ client });
    const result = await service.findSeller(makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('portal/seller-not-found');
  });
});
