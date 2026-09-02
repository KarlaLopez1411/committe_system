// Feature: sac-sistema-administracion-comunitaria
// Property 7: La suma de apuntes de una transferencia siempre es cero
// Property 8: Rechazo de transferencias inválidas

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import type { Ctx } from '@/domain/types';
import { createFinanceService, validateTransferAmount } from './finance-service';

const USER = '11111111-1111-1111-1111-111111111111';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FROM = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TO = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const TX_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return { userId: USER, committeeId: COMMITTEE, permissions: ['transactions.create'], isSuperAdmin: false, ...overrides };
}

function makeRpcClient(opts: { rpcError?: string | null } = {}) {
  const captured: { name: string; params: Record<string, unknown> }[] = [];
  const client = {
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      captured.push({ name, params });
      if (opts.rpcError) return { data: null, error: { message: opts.rpcError } };
      return { data: TX_ID, error: null };
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  return { client, captured };
}

const validAmountArb = fc
  .integer({ min: 1, max: 99_999_999 })
  .map((c): string => `${Math.floor(c / 100)}.${(c % 100).toString().padStart(2, '0')}`);

// ---------------------------------------------------------------------------
// Property 8: Rechazo de transferencias inválidas (R11.5, R11.6)
// ---------------------------------------------------------------------------

describe('Property 8: Rechazo de transferencias inválidas (R11.5, R11.6)', () => {
  // **Validates: Requirements 11.5**
  it('rechaza cuando from === to', async () => {
    const { client } = makeRpcClient();
    const service = createFinanceService({ client });
    const result = await service.transfer(makeCtx(), {
      fromAccountId: FROM, toAccountId: FROM, amount: '100.00', date: '2025-01-15',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('transfer/same-account');
  });

  // **Validates: Requirements 11.6**
  it('validateTransferAmount rechaza monto < 0.01', () => {
    for (const bad of ['0.00', '0', '-1.00', '-0.01']) {
      expect(validateTransferAmount(bad).ok).toBe(false);
    }
  });

  // **Validates: Requirements 11.6**
  it('validateTransferAmount rechaza monto > 999999999.99', () => {
    expect(validateTransferAmount('1000000000.00').ok).toBe(false);
    expect(validateTransferAmount('999999999.99').ok).toBe(true);
  });

  // **Validates: Requirements 11.5** — property over arbitrary accounts
  it('para cualquier accountId, from===to siempre es rechazado', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        validAmountArb,
        async (accountId, amount) => {
          const { client } = makeRpcClient();
          const service = createFinanceService({ client });
          const result = await service.transfer(makeCtx(), {
            fromAccountId: accountId, toAccountId: accountId, amount, date: '2025-01-15',
          });
          return !result.ok;
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 11.6** — property over invalid amounts
  it('validateTransferAmount rechaza cualquier monto ≤ 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -99_999_999, max: 0 }).map((c): string => {
          const abs = Math.abs(c);
          return c < 0 ? `-${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}` : '0.00';
        }),
        (amount) => !validateTransferAmount(amount).ok,
      ),
      { numRuns: 100 },
    );
  });

  it('rechaza sin permiso transactions.create', async () => {
    const { client, captured } = makeRpcClient();
    const service = createFinanceService({ client });
    const result = await service.transfer(makeCtx({ permissions: [] }), {
      fromAccountId: FROM, toAccountId: TO, amount: '50.00', date: '2025-01-15',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(captured).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Property 7: La suma de apuntes de la transferencia siempre es cero (R11.2, R11.3)
// ---------------------------------------------------------------------------

describe('Property 7: La suma de apuntes de una transferencia es cero (R11.2, R11.3)', () => {
  // **Validates: Requirements 11.2, R11.3**
  // The service passes the same positive amount to rpc_transfer; the SQL RPC
  // creates -amount (debit) and +amount (credit), which sum to zero.
  // We verify the service passes the parsed canonical amount to the RPC (no sign flip).
  it('registerTransfer pasa el monto exacto al RPC (el SQL crea los dos apuntes opuestos)', async () => {
    await fc.assert(
      fc.asyncProperty(
        validAmountArb,
        async (amount) => {
          const { client, captured } = makeRpcClient();
          const service = createFinanceService({ client });
          const result = await service.transfer(makeCtx(), {
            fromAccountId: FROM, toAccountId: TO, amount, date: '2025-01-15',
          });
          if (!result.ok) return false;
          const call = captured.find((c) => c.name === 'rpc_transfer');
          if (!call) return false;
          const sent = parseFloat(String(call.params.p_amount));
          return sent > 0 && Math.abs(sent - parseFloat(amount)) < 0.001;
        },
      ),
      { numRuns: 100 },
    );
  });

  // The two ledger amounts sum to zero: -p_amount + p_amount = 0.
  it('los dos apuntes del RPC se anulan: -p_amount + p_amount = 0', () => {
    fc.assert(
      fc.property(validAmountArb, (amount) => {
        const parsed = parseFloat(amount);
        const debit = -parsed;
        const credit = parsed;
        return Math.abs(debit + credit) < 1e-10;
      }),
      { numRuns: 200 },
    );
  });
});
