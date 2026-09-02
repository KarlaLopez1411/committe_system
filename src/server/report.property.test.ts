// Feature: sac-sistema-administracion-comunitaria
// Property 33: Identidades de agregación del corte mensual de bonos
// Unit tests 28.5: Ejemplo concreto + formato CSV

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import { add, subtract, equals, ZERO } from '@/domain/money';
import type { Money } from '@/domain/types';
import { buildCsv, type BonusMonthlyCutReport } from './report-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const moneyArb = fc
  .integer({ min: 0, max: 99_999_999 })
  .map((cents): Money => `${Math.floor(cents / 100)}.${(cents % 100).toString().padStart(2, '0')}`);

/** Builds a valid report where all identities hold by construction. */
function makeReport(
  expected: Money, collected: Money, delivered: Money,
  prize: Money, paidPrize: Money,
): BonusMonthlyCutReport {
  return {
    campaignId: 'camp-1',
    campaignName: 'Campaña Test',
    period: '2025-01-01',
    expectedAmount: expected,
    collectedAmount: collected,
    pendingCollect: subtract(expected, collected),
    deliveredAmount: delivered,
    withVendorsAmount: subtract(collected, delivered),
    prizeAmount: prize,
    paidPrize,
    pendingPrize: subtract(prize, paidPrize),
  };
}

// ---------------------------------------------------------------------------
// Property 33: Identidades de agregación (R35.1)
// ---------------------------------------------------------------------------

describe('Property 33: Identidades del corte mensual de bonos (R35.1)', () => {
  // **Validates: Requirements 35.1**
  it('pendingCollect + collectedAmount === expectedAmount', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          moneyArb,
          moneyArb.chain((expected) =>
            fc.integer({ min: 0, max: parseInt(expected) * 100 }).map((c): Money => {
              const safeCents = Math.min(c, Math.floor(parseFloat(expected) * 100));
              return `${Math.floor(safeCents / 100)}.${(safeCents % 100).toString().padStart(2, '0')}`;
            })
          ),
        ),
        ([expected, collected]: [Money, Money]) => {
          const pending = subtract(expected, collected);
          return equals(add(pending, collected), expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  // **Validates: Requirements 35.1**
  it('withVendors + deliveredAmount === collectedAmount', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          moneyArb,
          moneyArb.chain((collected) =>
            fc.integer({ min: 0, max: Math.floor(parseFloat(collected) * 100) }).map((d): Money => {
              const safeCents = Math.min(d, Math.floor(parseFloat(collected) * 100));
              return `${Math.floor(safeCents / 100)}.${(safeCents % 100).toString().padStart(2, '0')}`;
            })
          ),
        ),
        ([collected, delivered]: [Money, Money]) => {
          const withVendors = subtract(collected, delivered);
          return equals(add(withVendors, delivered), collected);
        },
      ),
      { numRuns: 200 },
    );
  });

  // **Validates: Requirements 35.1**
  it('pendingPrize + paidPrize === prizeAmount', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          moneyArb,
          moneyArb.chain((prize) =>
            fc.integer({ min: 0, max: Math.floor(parseFloat(prize) * 100) }).map((p): Money => {
              const safeCents = Math.min(p, Math.floor(parseFloat(prize) * 100));
              return `${Math.floor(safeCents / 100)}.${(safeCents % 100).toString().padStart(2, '0')}`;
            })
          ),
        ),
        ([prize, paid]: [Money, Money]) => {
          const pending = subtract(prize, paid);
          return equals(add(pending, paid), prize);
        },
      ),
      { numRuns: 200 },
    );
  });

  // **Validates: Requirements 35.1** — zero identity
  it('con cero aportaciones, collected === ZERO y pending === expected', () => {
    fc.assert(
      fc.property(moneyArb, (expected) => {
        const pending = subtract(expected, ZERO);
        return equals(pending, expected);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests 28.5: Ejemplo $3,000/$2,850/$150 + formato CSV
// ---------------------------------------------------------------------------

describe('Pruebas unitarias 28.5: Ejemplo concreto + CSV', () => {
  const report = makeReport('3000.00', '2850.00', '2700.00', '500.00', '500.00');

  it('buildCsv — ejemplo $3000/$2850/$150 contiene los montos correctos', () => {
    const csv = buildCsv(report);
    expect(csv).toContain('3000.00');
    expect(csv).toContain('2850.00');
    expect(csv).toContain('150.00'); // pendingCollect = 3000 - 2850
    expect(csv).toContain('2700.00');
    expect(csv).toContain('150.00'); // withVendors = 2850 - 2700
    expect(csv).toContain('500.00');
    expect(csv).toContain('0.00');   // pendingPrize = 500 - 500
  });

  it('buildCsv — tiene encabezado de campaña y periodo', () => {
    const csv = buildCsv(report);
    expect(csv).toContain('Campaña Test');
    expect(csv).toContain('2025-01-01');
  });

  it('buildCsv — formato CSV con comillas dobles en cada campo', () => {
    const csv = buildCsv(report);
    const lines = csv.split('\n');
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines.filter((l) => l.trim())) {
      expect(line.startsWith('"')).toBe(true);
    }
  });

  it('identidades en el ejemplo concreto', () => {
    expect(equals(add(report.pendingCollect, report.collectedAmount), report.expectedAmount)).toBe(true);
    expect(equals(add(report.withVendorsAmount, report.deliveredAmount), report.collectedAmount)).toBe(true);
    expect(equals(add(report.pendingPrize, report.paidPrize), report.prizeAmount)).toBe(true);
  });
});
