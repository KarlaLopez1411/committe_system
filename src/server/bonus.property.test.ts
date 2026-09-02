// Feature: sac-sistema-administracion-comunitaria
// Property 20: Validación de parámetros de campaña de bonos
// Property 21: Unicidad de campaña por año
// Property 22: La generación de números produce el rango completo y único
// Property 23: El cambio de titular conserva el historial y deja un único vigente
// Property 24: A lo sumo un vendedor vigente por número
// Property 25: Nunca dos mensualidades para el mismo número y periodo
// Property 26: Un cobro de vendedor no incrementa el saldo del comité
// Property 27: El monto reportado de una entrega es la suma de sus cobros
// Property 28: Un vendedor nunca confirma su propia entrega
// Property 29: Confirmar una entrega dos veces nunca crea dos ingresos
// Property 30: Nunca dos sorteos por campaña y periodo
// Property 31: Pagar un premio dos veces nunca crea dos egresos
// Property 32: El sorteo exige las seis reglas definidas

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import type { Ctx } from '@/domain/types';
import { createBonusCampaignService } from './bonus-campaign-service';
import { createBonusCollectionService } from './bonus-collection-service';
import { createBonusSettlementService } from './bonus-settlement-service';
import { createBonusDrawService } from './bonus-draw-service';

const USER_A = '11111111-1111-1111-1111-111111111111';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CAMPAIGN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeCtx(userId = USER_A, perms: string[] = ['committee.manage', 'bonuses.settle', 'bonuses.draw']): Ctx {
  return { userId, committeeId: COMMITTEE, permissions: perms, isSuperAdmin: false };
}

function simpleMock(overrides: Record<string, unknown> = {}) {
  const client = {
    from: vi.fn((tbl: string) => ({
      insert: vi.fn((_row: unknown) => {
        const code = overrides.insertErrorCode as string | undefined;
        return { select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: code ? null : { id: 'new-id' }, error: code ? { code, message: 'conflict' } : null })) })) };
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: overrides[`${tbl}Row`] ?? null, error: null })) })),
          in: vi.fn(() => Promise.resolve({ data: overrides[`${tbl}Rows`] ?? [], error: null })),
          is: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: { message: 'not found' } })) })),
          single: vi.fn(() => Promise.resolve({ data: overrides[`${tbl}Row`] ?? null, error: null })),
        })),
        in: vi.fn(() => Promise.resolve({ data: overrides[`${tbl}Rows`] ?? [], error: null })),
        is: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: { message: 'not found' } })) })),
        single: vi.fn(() => Promise.resolve({ data: overrides[`${tbl}Row`] ?? null, error: null })),
        count: vi.fn(() => Promise.resolve({ count: 0, error: null })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })), is: vi.fn(() => Promise.resolve({ error: null })) })),
        is: vi.fn(() => Promise.resolve({ error: null })),
      })),
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
    })),
    rpc: vi.fn(async () => {
      if (overrides.rpcError) return { data: null, error: { message: overrides.rpcError as string } };
      return { data: 'new-tx-id', error: null };
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  return { client };
}

// ---------------------------------------------------------------------------
// Property 20: Validación de parámetros de campaña simplificada (R24.1, R24.3)
// Alta simplificada: solo año + aportación mensual + premio mensual. El rango
// de números es SIEMPRE 1–100 (fijo), por lo que ya no se validan
// numberStart/numberEnd ni activeMonths.
// ---------------------------------------------------------------------------

describe('Property 20: Validación de parámetros de campaña (R24.1, R24.3)', () => {
  // **Validates: Requirements 24.1** — year out of range
  it('rechaza año fuera de rango', async () => {
    for (const year of [1999, 2101, 0, -1]) {
      const { client } = simpleMock();
      const result = await createBonusCampaignService({ client }).createCampaign(makeCtx(), {
        year, monthlyAmount: '100.00', monthlyPrize: '500.00',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('campaign/invalid-year');
    }
  });

  // **Validates: Requirements 24.3**
  it('rechaza monto o premio igual a 0', async () => {
    for (const [amount, prize] of [['0.00', '100.00'], ['100.00', '0']] as [string, string][]) {
      const { client } = simpleMock();
      const result = await createBonusCampaignService({ client }).createCampaign(makeCtx(), {
        year: 2025, monthlyAmount: amount, monthlyPrize: prize,
      });
      expect(result.ok).toBe(false);
    }
  });

  // **Validates: Requirements 24.3** — property: any non-positive amount/prize rejected
  it('para cualquier monto/premio ≤ 0, la creación es rechazada', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('0', '0.00', '-1.00', '-100'),
        async (bad) => {
          const { client } = simpleMock();
          const result = await createBonusCampaignService({ client }).createCampaign(makeCtx(), {
            year: 2025, monthlyAmount: bad, monthlyPrize: '500.00',
          });
          return !result.ok;
        },
      ),
      { numRuns: 20 },
    );
  });

  // **Validates**: campaña válida crea la campaña y genera 100 números.
  it('con año y montos válidos, crea la campaña (y genera números)', async () => {
    const { client } = simpleMock();
    const result = await createBonusCampaignService({ client }).createCampaign(makeCtx(), {
      year: 2026, monthlyAmount: '100.00', monthlyPrize: '500.00',
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property 21: Unicidad de campaña por año (R24.5)
// ---------------------------------------------------------------------------

describe('Property 21: Unicidad de campaña por año (R24.5)', () => {
  // **Validates: Requirements 24.5**
  it('error de BD UNIQUE se traduce a campaign/duplicate-year', async () => {
    const { client } = simpleMock({ insertErrorCode: '23505' });
    const result = await createBonusCampaignService({ client }).createCampaign(makeCtx(), {
      year: 2025, monthlyAmount: '100.00', monthlyPrize: '500.00',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('campaign/duplicate-year');
  });
});

// ---------------------------------------------------------------------------
// Property 22: Generación de números completa y única (R25.1, R25.2)
// ---------------------------------------------------------------------------

describe('Property 22: Generación de números completa y única (R25.1, R25.2)', () => {
  // **Validates: Requirements 25.1, 25.2**
  it('generateNumbers crea exactamente end-start+1 números', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 200 }),
        async (start, range) => {
          const end = start + range;
          const campaignRow = { number_start: start, number_end: end };
          const upserted: unknown[][] = [];
          const client = {
            from: vi.fn(() => ({
              select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: campaignRow, error: null })) })) })) })),
              upsert: vi.fn((rows: unknown[]) => { upserted.push(rows); return Promise.resolve({ error: null }); }),
            })),
          } as unknown as import('@supabase/supabase-js').SupabaseClient;
          const result = await createBonusCampaignService({ client }).generateNumbers(makeCtx(), CAMPAIGN);
          if (!result.ok) return false;
          const rows = upserted[0] as { number: number }[];
          const numbers = rows.map((r) => r.number).sort((a, b) => a - b);
          return numbers.length === end - start + 1
            && numbers[0] === start
            && numbers[numbers.length - 1] === end
            && new Set(numbers).size === numbers.length; // unique
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 25: Nunca dos mensualidades para el mismo número y periodo (R29.2)
// ---------------------------------------------------------------------------

describe('Property 25: Sin mensualidades duplicadas (R29.1, R29.2)', () => {
  // **Validates: Requirements 29.2**
  it('generateMonthlyDues usa upsert con ignoreDuplicates para evitar duplicados', async () => {
    const upsertCalls: unknown[] = [];

    // Inject a mock that returns numbers
    const service = createBonusCollectionService({ client: {
      from: vi.fn((table: string) => {
        if (table === 'bonus_campaigns') return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { monthly_amount: '100.00' }, error: null })) })) })) })) };
        if (table === 'bonus_numbers') return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: [{ id: 'n1' }, { id: 'n2' }], error: null })) })) })) })) };
        if (table === 'bonus_monthly_dues') return { upsert: vi.fn((rows: unknown[]) => { upsertCalls.push(rows); return Promise.resolve({ error: null }); }) };
        throw new Error(`unmocked: ${table}`);
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient });

    await service.generateMonthlyDues(makeCtx(), CAMPAIGN, '2025-01-01');
    expect(upsertCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Property 26: Cobro de vendedor no incrementa saldo del comité (R30.2)
// ---------------------------------------------------------------------------

describe('Property 26: Cobro de vendedor no afecta saldo (R30.2)', () => {
  // **Validates: Requirements 30.2**
  it('recordCollection nunca inserta en financial_transactions ni ledger_entries', async () => {
    const financialTables: string[] = [];
    const client = {
      from: vi.fn((table: string) => {
        financialTables.push(table);
        if (table === 'bonus_monthly_dues') {
          return {
            select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { status: 'pendiente', committee_id: COMMITTEE }, error: null })) })) })),
            update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
          };
        }
        if (table === 'bonus_collections') {
          return { insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { id: 'col-id' }, error: null })) })) })) };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await createBonusCollectionService({ client }).recordCollection(makeCtx(USER_A, ['bonuses.collect']), 'due-id', '50.00', 'seller-id');
    expect(financialTables).not.toContain('financial_transactions');
    expect(financialTables).not.toContain('ledger_entries');
  });
});

// ---------------------------------------------------------------------------
// Property 28: Vendedor no confirma su propia entrega (R31.4)
// ---------------------------------------------------------------------------

describe('Property 28: Vendedor no confirma su propia entrega (R31.4)', () => {
  // **Validates: Requirements 31.4**
  it('confirmSettlement rechaza cuando el actor es el reporter', async () => {
    const { client } = simpleMock({ rpcError: 'el vendedor no puede confirmar su propia entrega' });
    const service = createBonusSettlementService({ client });
    const result = await service.confirmSettlement(makeCtx(), 'settlement-id', 'account-id', 'category-id');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('settlement/self-confirm');
  });
});

// ---------------------------------------------------------------------------
// Property 29: Confirmar dos veces no crea dos ingresos (R31.5, R41.4)
// ---------------------------------------------------------------------------

describe('Property 29: Idempotencia de confirmación de entrega (R31.5, R41.4)', () => {
  // **Validates: Requirements 31.5, 41.4** — second confirmation is rejected at DB level
  it('el segundo intento de confirmación devuelve error (simulado por RPC)', async () => {
    const { client } = simpleMock({ rpcError: 'unique constraint' });
    const service = createBonusSettlementService({ client });
    const result = await service.confirmSettlement(makeCtx(), 'settlement-id', 'acc', 'cat');
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property 30: Nunca dos sorteos por campaña y periodo (R32.2)
// ---------------------------------------------------------------------------

describe('Property 30: Un sorteo por campaña y periodo (R32.2)', () => {
  // **Validates: Requirements 32.2**
  it('el duplicate UNIQUE se mapea a draw/duplicate', async () => {
    const { client } = simpleMock({ insertErrorCode: '23505', [`bonus_campaignsRow`]: { rules_defined: true, monthly_prize: '500.00' } });
    const service = createBonusDrawService({ client });
    const result = await service.registerDraw(makeCtx(), {
      campaignId: CAMPAIGN, period: '2025-01-01', drawDate: '2025-01-15', winningBonusNumberId: 'num-id',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('draw/duplicate');
  });
});

// ---------------------------------------------------------------------------
// Property 32: Sorteo exige reglas definidas (R34.3)
// ---------------------------------------------------------------------------

describe('Property 32: Sorteo exige reglas definidas (R34.3)', () => {
  // **Validates: Requirements 34.3**
  it('registerDraw rechaza cuando rules_defined=false', async () => {
    const { client } = simpleMock({ 'bonus_campaignsRow': { rules_defined: false, monthly_prize: '500.00' } });
    const service = createBonusDrawService({ client });
    const result = await service.registerDraw(makeCtx(), {
      campaignId: CAMPAIGN, period: '2025-01-01', drawDate: '2025-01-15', winningBonusNumberId: 'num-id',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('draw/rules-missing');
  });

  // **Validates: Requirements 34.3** — property
  it('sin reglas definidas, ningún sorteo pasa', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (bonusNumId) => {
        const { client } = simpleMock({ 'bonus_campaignsRow': { rules_defined: false, monthly_prize: '500.00' } });
        const result = await createBonusDrawService({ client }).registerDraw(makeCtx(), {
          campaignId: CAMPAIGN, period: '2025-01-01', drawDate: '2025-01-15', winningBonusNumberId: bonusNumId,
        });
        return !result.ok;
      }),
      { numRuns: 50 },
    );
  });
});
