/**
 * Utilidad `Money` — aritmética monetaria de decimales exactos.
 *
 * Los montos se representan como cadenas decimales con exactamente dos
 * decimales (ej. "150.00"). Internamente la aritmética opera sobre centavos
 * usando `BigInt`, de modo que NUNCA se usa aritmética de punto flotante y se
 * soportan magnitudes arbitrariamente grandes sin pérdida de precisión
 * (Requirements 41.1).
 *
 * Reglas de dominio:
 * - Un `Money` válido tiene como máximo 2 decimales.
 * - La representación canónica siempre incluye exactamente 2 decimales.
 * - El cero negativo se normaliza a "0.00".
 */

import type { Money } from './types';

/** Número de decimales de la moneda. */
const SCALE = 2;
/** Factor de escala en centavos (10^SCALE). */
const SCALE_FACTOR = 100n;

/**
 * Expresión regular para un decimal con signo opcional y hasta 2 decimales.
 * Acepta: "150", "150.5", "150.50", "-3.14", "+0", ".5", "5.".
 */
const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Error lanzado cuando una entrada no es un monto válido. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Convierte una entrada (cadena o número entero seguro) en centavos `BigInt`.
 * Rechaza entradas con más de 2 decimales, no numéricas, NaN o infinitas.
 */
function toCents(input: Money | number): bigint {
  let text: string;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new MoneyError(`Monto numérico inválido: ${input}`);
    }
    // Solo se aceptan enteros como number para evitar imprecisión de float.
    if (!Number.isInteger(input)) {
      throw new MoneyError(
        'Los montos numéricos deben ser enteros; use una cadena decimal para valores con decimales.',
      );
    }
    text = input.toString();
  } else if (typeof input === 'string') {
    text = input.trim();
  } else {
    throw new MoneyError('El monto debe ser una cadena o un entero.');
  }

  if (text === '' || !DECIMAL_RE.test(text)) {
    throw new MoneyError(`Monto inválido: "${String(input)}"`);
  }

  let sign = 1n;
  if (text.startsWith('+')) {
    text = text.slice(1);
  } else if (text.startsWith('-')) {
    sign = -1n;
    text = text.slice(1);
  }

  const dotIndex = text.indexOf('.');
  let intPart: string;
  let fracPart: string;
  if (dotIndex === -1) {
    intPart = text;
    fracPart = '';
  } else {
    intPart = text.slice(0, dotIndex);
    fracPart = text.slice(dotIndex + 1);
  }

  if (fracPart.length > SCALE) {
    throw new MoneyError(
      `El monto no puede tener más de ${SCALE} decimales: "${String(input)}"`,
    );
  }

  // Normaliza a exactamente SCALE decimales rellenando con ceros a la derecha.
  const fracPadded = fracPart.padEnd(SCALE, '0');
  const intDigits = intPart === '' ? '0' : intPart;

  const cents = BigInt(intDigits) * SCALE_FACTOR + BigInt(fracPadded);
  return sign * cents;
}

/** Convierte centavos `BigInt` en la representación canónica `Money`. */
function fromCents(cents: bigint): Money {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const intPart = abs / SCALE_FACTOR;
  const fracPart = abs % SCALE_FACTOR;
  const fracStr = fracPart.toString().padStart(SCALE, '0');
  const body = `${intPart.toString()}.${fracStr}`;
  // Normaliza el cero negativo a positivo.
  return negative && cents !== 0n ? `-${body}` : body;
}

/**
 * Indica si una entrada es un monto válido (cadena decimal con ≤2 decimales o
 * entero). No lanza excepciones.
 */
export function isValid(input: unknown): input is Money | number {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return false;
  }
  try {
    toCents(input as Money | number);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parsea y normaliza un monto a la representación canónica `Money` con
 * exactamente 2 decimales. Lanza `MoneyError` si la entrada es inválida.
 */
export function parse(input: Money | number): Money {
  return fromCents(toCents(input));
}

/** Suma dos montos sin punto flotante. */
export function add(a: Money | number, b: Money | number): Money {
  return fromCents(toCents(a) + toCents(b));
}

/** Resta `b` de `a` sin punto flotante. */
export function subtract(a: Money | number, b: Money | number): Money {
  return fromCents(toCents(a) - toCents(b));
}

/** Niega un monto. */
export function negate(a: Money | number): Money {
  return fromCents(-toCents(a));
}

/** Valor absoluto de un monto. */
export function abs(a: Money | number): Money {
  const cents = toCents(a);
  return fromCents(cents < 0n ? -cents : cents);
}

/**
 * Compara dos montos. Devuelve -1 si a<b, 0 si a==b, 1 si a>b.
 */
export function compare(a: Money | number, b: Money | number): -1 | 0 | 1 {
  const ca = toCents(a);
  const cb = toCents(b);
  if (ca < cb) return -1;
  if (ca > cb) return 1;
  return 0;
}

/** `a === b` en valor monetario. */
export function equals(a: Money | number, b: Money | number): boolean {
  return compare(a, b) === 0;
}

/** `a < b`. */
export function lessThan(a: Money | number, b: Money | number): boolean {
  return compare(a, b) === -1;
}

/** `a <= b`. */
export function lessThanOrEqual(a: Money | number, b: Money | number): boolean {
  return compare(a, b) !== 1;
}

/** `a > b`. */
export function greaterThan(a: Money | number, b: Money | number): boolean {
  return compare(a, b) === 1;
}

/** `a >= b`. */
export function greaterThanOrEqual(
  a: Money | number,
  b: Money | number,
): boolean {
  return compare(a, b) !== -1;
}

/** Indica si el monto es cero. */
export function isZero(a: Money | number): boolean {
  return toCents(a) === 0n;
}

/** Indica si el monto es estrictamente positivo (> 0). */
export function isPositive(a: Money | number): boolean {
  return toCents(a) > 0n;
}

/** Indica si el monto es estrictamente negativo (< 0). */
export function isNegative(a: Money | number): boolean {
  return toCents(a) < 0n;
}

/**
 * Indica si `value` está dentro del rango inclusivo [min, max].
 * Lanza `MoneyError` si `min > max` o si algún argumento es inválido.
 */
export function isWithinRange(
  value: Money | number,
  min: Money | number,
  max: Money | number,
): boolean {
  const cmin = toCents(min);
  const cmax = toCents(max);
  if (cmin > cmax) {
    throw new MoneyError('El límite inferior del rango no puede exceder al superior.');
  }
  const v = toCents(value);
  return v >= cmin && v <= cmax;
}

/**
 * Restringe `value` al rango inclusivo [min, max] devolviendo el límite más
 * cercano cuando queda fuera. Lanza `MoneyError` si `min > max`.
 */
export function clamp(
  value: Money | number,
  min: Money | number,
  max: Money | number,
): Money {
  const cmin = toCents(min);
  const cmax = toCents(max);
  if (cmin > cmax) {
    throw new MoneyError('El límite inferior del rango no puede exceder al superior.');
  }
  const v = toCents(value);
  if (v < cmin) return fromCents(cmin);
  if (v > cmax) return fromCents(cmax);
  return fromCents(v);
}

/** Cero monetario canónico. */
export const ZERO: Money = '0.00';
