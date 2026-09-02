// Feature: sac-sistema-administracion-comunitaria
// Property 9: Correspondencia monto–apunte en ingresos y egresos
// Property 10: Validación de monto de ingresos y egresos
// Property 5: Los movimientos contra cuentas inactivas se rechazan

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import type { Ctx } from '@/domain/types';
import {
  createFinanceService,
  validateIncomeAmount,
  validateExpenseAmount,
} from './finance-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER = '11111111-1111-1111-1111-111111111111';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CATEGORY = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const TX_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    userId: USER,
    committeeId: COMMITTEE,
    permissions: ['transactions.create', 'transactions.read'],
    isSuperAdmin: false,
    ...overrides,
  };
}

/**
 * Builds an in-memory Supabase client that records the last RPC call and
 * returns configurable results. `accountStatus` controls whether the account
 * appears active or inactive (R9.4, R14.5).
 */
function makeRpcClient(opts: {
  accountStatus?: 'active' | 'inactive';
  rpcError?: string | null;
} = {}) {
  const { accountStatus = 'active', rpcError = null } = opts;
  const captured: { name: string; params: Record<string, unknown> }[] = [];

  const client = {
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      captured.push({ name, params });
      if (rpcError) {
        return { data: null, error: { message: rpcError } };
      }
      // Simulate inactive account error from the RPC layer
      if (accountStatus === 'inactive') {
        return { data: null, error: { message: 'la cuenta receptora no está activa' } };
      }
      return { data: TX_ID, error: null };
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  return { client, captured };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a valid positive money string with ≤2 decimals, e.g. "1234.56". */
const positiveMoneyArb = fc
  .integer({ min: 1, max: 99_999_999_999 })
  .map((cents): string => {
    const intPart = Math.floor(cents / 100);
    const fracPart = cents % 100;
    return `${intPart}.${fracPart.toString().padStart(2, '0')}`;
  });

/** Generates a valid money string within expense bounds [0.01, 999999999.99]. */
const expenseMoneyArb = fc
  .integer({ min: 1, max: 99_999_999_999 })
  .map((cents): string => {
    const intPart = Math.floor(cents / 100);
    const fracPart = cents % 100;
    return `${intPart}.${fracPart.toString().padStart(2, '0')}`;
  });

/** Generates non-positive money strings (zero or negative). */
const nonPositiveMoneyArb = fc.oneof(
  fc.constant('0.00'),
  fc.constant('0'),
  fc.integer({ min: -99_999_999, max: -1 }).map((cents): string => {
    const abs = Math.abs(cents);
    const intPart = Math.floor(abs / 100);
    const fracPart = abs % 100;
    return `-${intPart}.${fracPart.toString().padStart(2, '0')}`;
  }),
);

// ---------------------------------------------------------------------------
// Property 10: Validación de monto de ingresos y egresos (R12.2, R14.2)
// ---------------------------------------------------------------------------

describe('Property 10: Validación de monto de ingresos y egresos (R12.2, R14.2)', () => {
  // **Validates: Requirements 12.2**
  it('validateIncomeAmount acepta montos válidos > 0 con ≤2 decimales', () => {
    fc.assert(
      fc.property(positiveMoneyArb, (amount) => {
        return validateIncomeAmount(amount).ok;
      }),
      { numRuns: 200 },
    );
  });

  // **Validates: Requirements 12.2**
  it('validateIncomeAmount rechaza monto 0 o negativo', () => {
    fc.assert(
      fc.property(nonPositiveMoneyArb, (amount) => {
        return !validateIncomeAmount(amount).ok;
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 12.2**
  it('validateIncomeAmount rechaza entradas no numéricas', () => {
    for (const bad of ['', 'abc', 'null', '1.2.3', undefined, null, {}]) {
      expect(validateIncomeAmount(bad).ok).toBe(false);
    }
  });

  // **Validates: Requirements 14.2**
  it('validateExpenseAmount acepta montos en rango [0.01, 999999999.99]', () => {
    fc.assert(
      fc.property(expenseMoneyArb, (amount) => {
        return validateExpenseAmount(amount).ok;
      }),
      { numRuns: 200 },
    );
  });

  // **Validates: Requirements 14.2**
  it('validateExpenseAmount rechaza monto < 0.01', () => {
    for (const bad of ['0.00', '0', '-1.00', '-0.01']) {
      expect(validateExpenseAmount(bad).ok).toBe(false);
    }
  });

  // **Validates: Requirements 14.2**
  it('validateExpenseAmount rechaza monto > límite', () => {
    expect(validateExpenseAmount('1000000000.00').ok).toBe(false);
    expect(validateExpenseAmount('999999999.99').ok).toBe(true);
  });

  // **Validates: Requirements 12.2, 14.2**
  it('ambos validadores rechazan montos con más de 2 decimales', () => {
    for (const bad of ['1.001', '0.123', '99.999']) {
      expect(validateIncomeAmount(bad).ok).toBe(false);
      expect(validateExpenseAmount(bad).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 9: Correspondencia monto–apunte en ingresos y egresos (R12.5, R14.4)
// ---------------------------------------------------------------------------

describe('Property 9: Correspondencia monto–apunte en ingresos y egresos (R12.5, R14.4)', () => {
  // **Validates: Requirements 12.5**
  it('registerIncome pasa el monto exacto (sin signo) al RPC rpc_register_income', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 99_999_999 }).map((c): string => `${Math.floor(c / 100)}.${(c % 100).toString().padStart(2, '0')}`),
        async (amount) => {
          const { client, captured } = makeRpcClient();
          const service = createFinanceService({ client });
          const result = await service.registerIncome(makeCtx(), {
            accountId: ACCOUNT, amount, date: '2025-01-15',
          });
          if (!result.ok) return false;
          const call = captured.find((c) => c.name === 'rpc_register_income');
          if (!call) return false;
          const sent = String(call.params.p_amount);
          return Math.abs(parseFloat(sent) - parseFloat(amount)) < 0.001;
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 14.4**
  it('registerExpense pasa el monto exacto (sin signo) al RPC rpc_register_expense', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 99_999_999 }).map((c): string => `${Math.floor(c / 100)}.${(c % 100).toString().padStart(2, '0')}`),
        async (amount) => {
          const { client, captured } = makeRpcClient();
          const service = createFinanceService({ client });
          const result = await service.registerExpense(makeCtx(), {
            accountId: ACCOUNT, categoryId: CATEGORY, amount,
            date: '2025-01-15', beneficiary: 'Proveedor X',
            description: 'Compra de materiales', paymentMethod: 'efectivo',
          });
          if (!result.ok) return false;
          const call = captured.find((c) => c.name === 'rpc_register_expense');
          if (!call) return false;
          const sent = String(call.params.p_amount);
          return Math.abs(parseFloat(sent) - parseFloat(amount)) < 0.001;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Los movimientos contra cuentas inactivas se rechazan (R9.4, R14.5)
// ---------------------------------------------------------------------------

describe('Property 5: Los movimientos contra cuentas inactivas se rechazan (R9.4, R14.5)', () => {
  // **Validates: Requirements 9.4, 12.4**
  it('registerIncome rechaza cuando la cuenta está inactiva', async () => {
    const { client } = makeRpcClient({ accountStatus: 'inactive' });
    const service = createFinanceService({ client });
    const result = await service.registerIncome(makeCtx(), {
      accountId: ACCOUNT,
      amount: '100.00',
      date: '2025-01-15',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('income/account-inactive');
  });

  // **Validates: Requirements 14.5**
  it('registerExpense rechaza cuando la cuenta está inactiva', async () => {
    // Simulate inactive account error from rpc_register_expense
    const { client } = makeRpcClient({
      rpcError: 'rpc_register_expense: la cuenta de origen no está activa',
    });
    const service = createFinanceService({ client });
    const result = await service.registerExpense(makeCtx(), {
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      amount: '50.00',
      date: '2025-01-15',
      beneficiary: 'Proveedor',
      description: 'Material',
      paymentMethod: 'efectivo',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('expense/account-inactive');
  });

  // **Validates: Requirements 9.4, 14.5** — property over arbitrary valid amounts
  it('ningún monto válido supera el rechazo de cuenta inactiva en ingresos', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 99_999_999 }).map((c): string => `${Math.floor(c / 100)}.${(c % 100).toString().padStart(2, '0')}`),
        async (amount) => {
          const { client } = makeRpcClient({ accountStatus: 'inactive' });
          const service = createFinanceService({ client });
          const result = await service.registerIncome(makeCtx(), {
            accountId: ACCOUNT, amount, date: '2025-01-15',
          });
          return !result.ok;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// RBAC: sin permiso se rechaza sin tocar la BD
// ---------------------------------------------------------------------------

describe('RBAC — registerIncome y registerExpense sin permiso', () => {
  it('registerIncome devuelve AUTHZ_FORBIDDEN sin permiso transactions.create', async () => {
    const { client, captured } = makeRpcClient();
    const service = createFinanceService({ client });
    const result = await service.registerIncome(
      makeCtx({ permissions: [] }),
      { accountId: ACCOUNT, amount: '10.00', date: '2025-01-15' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(captured).toHaveLength(0);
  });

  it('registerExpense devuelve AUTHZ_FORBIDDEN sin permiso transactions.create', async () => {
    const { client, captured } = makeRpcClient();
    const service = createFinanceService({ client });
    const result = await service.registerExpense(
      makeCtx({ permissions: [] }),
      {
        accountId: ACCOUNT, categoryId: CATEGORY, amount: '10.00', date: '2025-01-15',
        beneficiary: 'X', description: 'Y', paymentMethod: 'efectivo',
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(captured).toHaveLength(0);
  });
});
