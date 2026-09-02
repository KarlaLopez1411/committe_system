// Feature: sac-sistema-administracion-comunitaria
// Property 14: El valor estimado de una donación en especie no altera el saldo de efectivo
// Property 15: Validación de fechas de actividad
// Property 16: El resultado de una actividad suma solo movimientos aprobados
// Property 17: Cierre de corte de actividad solo desde estado finalizada y una sola vez
// Property 18: Cálculo del corte mensual de caja
// Property 19: Un corte no se cierra dos veces

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import type { Ctx } from '@/domain/types';
import {
  createDonationService,
  DONATION_TYPES, DONATION_ORIGINS,
} from './donation-service';
import { createActivityService } from './activity-service';
import { createCashClosingService } from './cash-closing-service';

const USER = '11111111-1111-1111-1111-111111111111';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return { userId: USER, committeeId: COMMITTEE, permissions: ['transactions.create', 'transactions.read', 'transactions.approve', 'committee.manage', 'cash_closings.close', 'cash_closings.approve', 'cash_closings.review', 'cash_closings.capture', 'cash_closings.create'], isSuperAdmin: false, ...overrides };
}

function makeInsertClient(opts: { insertedId?: string; insertError?: string | null } = {}) {
  const { insertedId = 'new-id', insertError = null } = opts;
  const inserts: unknown[] = [];
  const client = {
    from: vi.fn((_table: string) => ({
      insert: vi.fn((row: unknown) => {
        inserts.push(row);
        return { select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: insertError ? null : { id: insertedId }, error: insertError ? { message: insertError, code: '99999' } : null })) })) };
      }),
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: null, error: { message: 'not found' } })) })) })),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) })),
    })),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  return { client, inserts };
}

// ---------------------------------------------------------------------------
// Property 14: estimated value of in-kind donation does NOT affect balance (R18.5)
// ---------------------------------------------------------------------------

describe('Property 14: Donación en especie no altera saldo (R18.5)', () => {
  // **Validates: Requirements 18.5**
  it('register nunca inserta financial_transaction para donación en especie', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DONATION_TYPES.filter((t) => t !== 'dinero')),
        fc.constantFrom(...DONATION_ORIGINS),
        async (type, origin) => {
          const { client, inserts } = makeInsertClient();
          const service = createDonationService({ client });
          await service.register(makeCtx(), { type, origin, description: 'Donación test', estimatedValue: '500.00', destination: 'Escuela' });
          // Only donations table insert — never financial_transactions
          const txInserts = inserts.filter((r) => {
            const row = r as Record<string, unknown>;
            return row.type === 'income' || row.type === 'expense';
          });
          return txInserts.length === 0;
        },
      ),
      { numRuns: 50 },
    );
  });

  // **Validates: Requirements 18.5** — is_estimated flag is always set when estimated_value is provided
  it('el flag is_estimated se activa cuando hay valor estimado', async () => {
    const { client, inserts } = makeInsertClient();
    const service = createDonationService({ client });
    await service.register(makeCtx(), { type: 'material', origin: 'persona', estimatedValue: '1000.00' });
    const row = inserts[0] as Record<string, unknown>;
    expect(row.is_estimated).toBe(true);
    expect(row.estimated_value).toBe('1000.00');
  });

  it('sin valor estimado, is_estimated es false', async () => {
    const { client, inserts } = makeInsertClient();
    const service = createDonationService({ client });
    await service.register(makeCtx(), { type: 'material', origin: 'persona' });
    const row = inserts[0] as Record<string, unknown>;
    expect(row.is_estimated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property 15: Validación de fechas de actividad (R19.2)
// ---------------------------------------------------------------------------

describe('Property 15: Validación de fechas de actividad (R19.2)', () => {
  // **Validates: Requirements 19.2**
  it('create rechaza cuando end < start', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 365 }),
        async (daysBefore) => {
          const start = '2025-06-15';
          const end = new Date(new Date(start).getTime() - daysBefore * 86400000).toISOString().slice(0, 10);
          const { client } = makeInsertClient();
          const service = createActivityService({ client });
          const result = await service.create(makeCtx(), { name: 'Test', startDate: start, endDate: end });
          return !result.ok && (result.error?.code === 'activity/invalid-dates');
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 19.2**
  it('create acepta cuando end >= start', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 365 }),
        async (daysAfter) => {
          const start = new Date('2025-01-01');
          const end = new Date(start.getTime() + daysAfter * 86400000).toISOString().slice(0, 10);
          const { client } = makeInsertClient();
          const service = createActivityService({ client });
          const result = await service.create(makeCtx(), { name: 'Test', startDate: '2025-01-01', endDate: end });
          return result.ok;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17: Cierre de actividad solo desde finalizada y una vez (R21.4, R21.5)
// ---------------------------------------------------------------------------

function makeActivityClient(currentStatus: string) {
  const updates: string[] = [];
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'activities') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { status: currentStatus }, error: null })) })) })) })),
          update: vi.fn((data: Record<string, unknown>) => {
            updates.push(String(data.status));
            return { eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) };
          }),
          insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { id: 'new-id' }, error: null })) })) })),
        };
      }
      if (table === 'financial_transactions') {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: [], error: null })) })) })) })) })) };
      }
      throw new Error(`unmocked: ${table}`);
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  return { client, updates };
}

describe('Property 17: Cierre de actividad (R21.4, R21.5)', () => {
  // **Validates: Requirements 21.1, 21.4**
  it('closeCut rechaza cuando status no es finalizada', async () => {
    for (const status of ['planeada', 'activa', 'cerrada']) {
      const { client } = makeActivityClient(status);
      const service = createActivityService({ client });
      const result = await service.closeCut(makeCtx(), 'act-id');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('activity/invalid-status');
    }
  });

  // **Validates: Requirements 21.1**
  it('closeCut transiciona a cerrada desde finalizada', async () => {
    const { client, updates } = makeActivityClient('finalizada');
    const service = createActivityService({ client });
    const result = await service.closeCut(makeCtx(), 'act-id');
    expect(result.ok).toBe(true);
    expect(updates).toContain('cerrada');
  });

  // **Validates: Requirements 21.5** — once cerrada, cannot close again
  it('closeCut rechaza si la actividad ya está cerrada', async () => {
    const { client } = makeActivityClient('cerrada');
    const service = createActivityService({ client });
    const result = await service.closeCut(makeCtx(), 'act-id');
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property 19: Un corte no se cierra dos veces (R23.3)
// ---------------------------------------------------------------------------

function makeClosingClient(opts: { status?: string; rpcError?: string } = {}) {
  const { status = 'aprobado', rpcError } = opts;
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'cash_closings') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { status }, error: null })) })) })) })),
          update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) })),
          insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { id: 'new-id' }, error: null })) })) })),
        };
      }
      throw new Error(`unmocked: ${table}`);
    }),
    rpc: vi.fn(async () => ({ data: null, error: rpcError ? { message: rpcError } : null })),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  return { client };
}

describe('Property 19: Un corte no se cierra dos veces (R23.3)', () => {
  // **Validates: Requirements 23.3**
  it('close rechaza cuando el corte no está aprobado', async () => {
    for (const status of ['abierto', 'en_revision', 'cerrado']) {
      const { client } = makeClosingClient({ rpcError: `estado actual: ${status}` });
      const service = createCashClosingService({ client });
      const result = await service.close(makeCtx(), 'closing-id');
      expect(result.ok).toBe(false);
    }
  });

  it('close pasa cuando el corte está aprobado', async () => {
    const { client } = makeClosingClient({ status: 'aprobado' });
    const service = createCashClosingService({ client });
    const result = await service.close(makeCtx(), 'closing-id');
    expect(result.ok).toBe(true);
  });

  // **Validates: Requirements 6.2, 23.2** — no permission
  it('close rechaza sin permiso cash_closings.close', async () => {
    const { client } = makeClosingClient();
    const service = createCashClosingService({ client });
    const result = await service.close(makeCtx({ permissions: ['transactions.create'] }), 'closing-id');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ_FORBIDDEN');
  });
});
