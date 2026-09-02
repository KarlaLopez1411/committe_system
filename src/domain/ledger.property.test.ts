// Feature: sac-sistema-administracion-comunitaria, Property 6: El saldo derivado siempre iguala la suma del ledger

/**
 * Prueba de propiedad: el saldo derivado siempre iguala la suma del ledger
 * **Validates: Requirements 10.1, 10.3**
 *
 * Verifica que getDerivedBalance(opening, entries) produce exactamente el
 * mismo resultado que reducir los apuntes con Money.add partiendo del saldo
 * inicial, para cualquier combinación válida de montos de dominio.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { add, equals } from './money';
import { getDerivedBalance } from './ledger';
import type { Money } from './types';

// ---------------------------------------------------------------------------
// Generador de montos válidos: cadenas decimales con exactamente 0–2 decimales,
// que representan centavos enteros en el rango −999_999_999..999_999_999.
// ---------------------------------------------------------------------------

/**
 * Genera centavos enteros (BigInt) en el rango [−999_999_999_99 .. 999_999_999_99]
 * y los convierte a la representación canónica de Money para que `money.ts`
 * los acepte sin error.
 */
const moneyArb: fc.Arbitrary<Money> = fc
  .bigInt({ min: -99_999_999_999n, max: 99_999_999_999n })
  .map((cents): Money => {
    const negative = cents < 0n;
    const abs = negative ? -cents : cents;
    const intPart = abs / 100n;
    const fracPart = abs % 100n;
    const fracStr = fracPart.toString().padStart(2, '0');
    const body = `${intPart}.${fracStr}`;
    // Normalizar cero negativo
    return negative && cents !== 0n ? (`-${body}` as Money) : (body as Money);
  });

// ---------------------------------------------------------------------------
// Propiedad 6
// ---------------------------------------------------------------------------

describe('Property 6: El saldo derivado siempre iguala la suma del ledger (R10.1, R10.3)', () => {
  // **Validates: Requirements 10.1, 10.3**
  it('getDerivedBalance(opening, entries) === entries.reduce(add, opening) para cualquier opening y entries válidos', () => {
    fc.assert(
      fc.property(
        // Tupla: saldo inicial + array de apuntes
        fc.tuple(moneyArb, fc.array(moneyArb, { minLength: 0, maxLength: 50 })),
        ([opening, entries]) => {
          const derived = getDerivedBalance(opening, entries);
          const expected = entries.reduce<Money>(
            (acc, entry) => add(acc, entry),
            opening,
          );
          return equals(derived, expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  // **Validates: Requirements 10.1**
  it('con lista de apuntes vacía, el saldo derivado es igual al saldo inicial', () => {
    fc.assert(
      fc.property(moneyArb, (opening) => {
        const derived = getDerivedBalance(opening, []);
        return equals(derived, opening);
      }),
      { numRuns: 200 },
    );
  });

  // **Validates: Requirements 10.3**
  it('agregar un apunte adicional incrementa (o decrementa) el saldo exactamente en ese monto', () => {
    fc.assert(
      fc.property(
        fc.tuple(moneyArb, fc.array(moneyArb, { minLength: 0, maxLength: 20 }), moneyArb),
        ([opening, entries, extraEntry]) => {
          const baseBalance = getDerivedBalance(opening, entries);
          const newBalance = getDerivedBalance(opening, [...entries, extraEntry]);
          const expected = add(baseBalance, extraEntry);
          return equals(newBalance, expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  // **Validates: Requirements 10.1**
  it('el saldo derivado es asociativo: el orden de reducción no altera el resultado', () => {
    fc.assert(
      fc.property(
        fc.tuple(moneyArb, fc.array(moneyArb, { minLength: 1, maxLength: 20 })),
        ([opening, entries]) => {
          // Partir la lista a la mitad y reducir por partes
          const mid = Math.floor(entries.length / 2);
          const firstHalf = entries.slice(0, mid);
          const secondHalf = entries.slice(mid);

          const fullResult = getDerivedBalance(opening, entries);
          const midBalance = getDerivedBalance(opening, firstHalf);
          const splitResult = getDerivedBalance(midBalance, secondHalf);

          return equals(fullResult, splitResult);
        },
      ),
      { numRuns: 200 },
    );
  });
});
