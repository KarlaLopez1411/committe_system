// Feature: sac-sistema-administracion-comunitaria
// Property 11: La anulación crea una compensación vinculada sin borrar el original

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import type { Ctx } from '@/domain/types';
import { createFinanceService } from './finance-service';

const USER = '11111111-1111-1111-1111-111111111111';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TX_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const REVERSAL_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return { userId: USER, committeeId: COMMITTEE, permissions: ['transactions.approve'], isSuperAdmin: false, ...overrides };
}

/** Mock client that records rpc calls and simulates specific void errors. */
function makeVoidClient(opts: { rpcError?: string | null } = {}) {
  const captured: { name: string; params: Record<string, unknown> }[] = [];
  const client = {
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      captured.push({ name, params });
      if (opts.rpcError) return { data: null, error: { message: opts.rpcError } };
      return { data: REVERSAL_ID, error: null };
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  return { client, captured };
}

/** Mock that supports approve (select + update). */
function makeApproveClient(opts: { currentStatus?: string; updateError?: string } = {}) {
  const { currentStatus = 'draft', updateError } = opts;
  const captured = { updates: 0, audits: 0 };

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'audit_logs') {
        return { insert: vi.fn(() => Promise.resolve({ error: null })) };
      }
      if (table === 'financial_transactions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({
                data: { status: currentStatus, committee_id: COMMITTEE },
                error: null,
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => {
                captured.updates += 1;
                return Promise.resolve({ error: updateError ? { message: updateError } : null });
              }),
            })),
          })),
        };
      }
      throw new Error(`unmocked table: ${table}`);
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  return { client, captured };
}

// ---------------------------------------------------------------------------
// Property 11: La anulación crea una compensación vinculada sin borrar el original
// ---------------------------------------------------------------------------

describe('Property 11: Anulación crea compensación vinculada (R15.3, R15.4)', () => {
  // **Validates: Requirements 15.3**
  it('void llama al RPC con el transaction_id correcto', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (txId) => {
          const { client, captured } = makeVoidClient();
          const service = createFinanceService({ client });
          const result = await service.void(makeCtx(), txId, 'Test reason');
          if (!result.ok) return false;
          const call = captured.find((c) => c.name === 'rpc_void_transaction');
          if (!call) return false;
          return call.params.p_transaction_id === txId
            && call.params.p_committee_id === COMMITTEE;
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 15.3**
  it('void devuelve el reversalId retornado por el RPC', async () => {
    const { client } = makeVoidClient();
    const service = createFinanceService({ client });
    const result = await service.void(makeCtx(), TX_ID, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.reversalId).toBe(REVERSAL_ID);
  });

  // **Validates: Requirements 15.4**
  it('void rechaza cuando la transacción no está en estado posted', async () => {
    const { client } = makeVoidClient({ rpcError: 'estado actual: draft' });
    const service = createFinanceService({ client });
    const result = await service.void(makeCtx(), TX_ID, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('transaction/invalid-status');
  });

  // **Validates: Requirements 15.4**
  it('void rechaza cuando la transacción no existe en el comité', async () => {
    const { client } = makeVoidClient({ rpcError: 'transacción no encontrada' });
    const service = createFinanceService({ client });
    const result = await service.void(makeCtx(), TX_ID, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('transaction/not-found');
  });

  it('void rechaza sin permiso transactions.approve', async () => {
    const { client, captured } = makeVoidClient();
    const service = createFinanceService({ client });
    const result = await service.void(makeCtx({ permissions: [] }), TX_ID, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(captured).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// approve — transición borrador → aprobado (R15.1, R15.2)
// ---------------------------------------------------------------------------

describe('approve — transición draft→posted (R15.1, R15.2)', () => {
  it('aprueba una transacción en estado draft', async () => {
    const { client, captured } = makeApproveClient({ currentStatus: 'draft' });
    const service = createFinanceService({ client });
    const result = await service.approve(makeCtx(), TX_ID);
    expect(result.ok).toBe(true);
    expect(captured.updates).toBe(1);
  });

  it('rechaza aprobar una transacción que no está en draft', async () => {
    const { client, captured } = makeApproveClient({ currentStatus: 'posted' });
    const service = createFinanceService({ client });
    const result = await service.approve(makeCtx(), TX_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('transaction/invalid-status');
    expect(captured.updates).toBe(0);
  });

  it('rechaza sin permiso transactions.approve', async () => {
    const { client, captured } = makeApproveClient();
    const service = createFinanceService({ client });
    const result = await service.approve(makeCtx({ permissions: [] }), TX_ID);
    expect(result.ok).toBe(false);
    expect(captured.updates).toBe(0);
  });
});
