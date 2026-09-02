/**
 * Ledger — cálculo de saldo derivado.
 *
 * El saldo de una cuenta NUNCA se asigna directamente: se deriva sumando el
 * saldo inicial más todos los apuntes del ledger. La aritmética usa
 * `Money.add` sobre centavos BigInt, por lo que nunca se emplea punto
 * flotante (Requirements 10.1, 10.3, 41.1).
 */

import type { Money } from './types';
import { add } from './money';

/**
 * Calcula el saldo derivado de una cuenta a partir de su saldo inicial y la
 * lista de apuntes del ledger.
 *
 * @param openingBalance - Saldo inicial de la cuenta (balance de apertura).
 * @param entries        - Lista de apuntes del ledger (pueden ser positivos o
 *                         negativos según sea ingreso o egreso).
 * @returns El saldo derivado = openingBalance + Σ entries.
 *
 * Requirements 10.1, 10.3
 */
export function getDerivedBalance(
  openingBalance: Money,
  entries: Money[],
): Money {
  return entries.reduce<Money>((acc, entry) => add(acc, entry), openingBalance);
}
