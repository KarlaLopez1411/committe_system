/**
 * Pruebas unitarias de la utilidad `Money` (Requirements 41.1).
 *
 * Cubre casos límite: exactamente dos decimales, gran magnitud, cero,
 * negativos, entradas no numéricas, más de dos decimales (rechazadas),
 * aritmética (suma/resta), comparadores y rangos.
 */

import { describe, it, expect } from 'vitest';
import {
  MoneyError,
  ZERO,
  isValid,
  parse,
  add,
  subtract,
  negate,
  abs,
  compare,
  equals,
  lessThan,
  lessThanOrEqual,
  greaterThan,
  greaterThanOrEqual,
  isZero,
  isPositive,
  isNegative,
  isWithinRange,
  clamp,
} from './money';

describe('Money.parse — normalización canónica', () => {
  it('normaliza a exactamente dos decimales', () => {
    expect(parse('150.00')).toBe('150.00');
    expect(parse('150')).toBe('150.00');
    expect(parse('150.5')).toBe('150.50');
  });

  it('acepta signo positivo explícito y lo descarta', () => {
    expect(parse('+7')).toBe('7.00');
    expect(parse('+0.01')).toBe('0.01');
  });

  it('acepta decimales sin parte entera y enteros sin parte decimal', () => {
    expect(parse('.5')).toBe('0.50');
    expect(parse('5.')).toBe('5.00');
  });

  it('recorta espacios en blanco alrededor de la entrada', () => {
    expect(parse('  42.10  ')).toBe('42.10');
  });

  it('acepta enteros numéricos y los normaliza', () => {
    expect(parse(150)).toBe('150.00');
    expect(parse(0)).toBe('0.00');
    expect(parse(-3)).toBe('-3.00');
  });
});

describe('Money — caso límite: dos decimales', () => {
  it('preserva exactamente dos decimales sin redondeo erróneo', () => {
    expect(parse('0.01')).toBe('0.01');
    expect(parse('0.99')).toBe('0.99');
    expect(parse('1234.56')).toBe('1234.56');
  });

  it('rellena un solo decimal a dos', () => {
    expect(parse('9.9')).toBe('9.90');
  });
});

describe('Money — caso límite: gran magnitud', () => {
  it('maneja el límite financiero 999,999,999.99 sin pérdida de precisión', () => {
    expect(parse('999999999.99')).toBe('999999999.99');
  });

  it('suma montos de gran magnitud exactamente', () => {
    expect(add('999999999.99', '0.01')).toBe('1000000000.00');
  });

  it('maneja magnitudes que exceden el rango de enteros seguros de float', () => {
    // 9_007_199_254_740_993 supera Number.MAX_SAFE_INTEGER; BigInt lo maneja.
    expect(add('90071992547409.91', '0.02')).toBe('90071992547409.93');
  });

  it('resta montos de gran magnitud exactamente', () => {
    expect(subtract('1000000000.00', '0.01')).toBe('999999999.99');
  });
});

describe('Money — caso límite: cero', () => {
  it('reconoce distintas formas de cero como cero', () => {
    expect(isZero('0')).toBe(true);
    expect(isZero('0.00')).toBe(true);
    expect(isZero('0.0')).toBe(true);
    expect(isZero('-0')).toBe(true);
    expect(isZero(0)).toBe(true);
  });

  it('normaliza el cero negativo a "0.00"', () => {
    expect(parse('-0')).toBe('0.00');
    expect(parse('-0.00')).toBe('0.00');
    expect(negate('0.00')).toBe('0.00');
  });

  it('expone la constante ZERO canónica', () => {
    expect(ZERO).toBe('0.00');
    expect(isZero(ZERO)).toBe(true);
  });

  it('el cero no es positivo ni negativo', () => {
    expect(isPositive('0.00')).toBe(false);
    expect(isNegative('0.00')).toBe(false);
  });
});

describe('Money — caso límite: negativos', () => {
  it('parsea y normaliza montos negativos', () => {
    expect(parse('-3.14')).toBe('-3.14');
    expect(parse('-3.1')).toBe('-3.10');
    expect(parse('-3')).toBe('-3.00');
  });

  it('niega y toma valor absoluto', () => {
    expect(negate('5.00')).toBe('-5.00');
    expect(negate('-5.00')).toBe('5.00');
    expect(abs('-7.25')).toBe('7.25');
    expect(abs('7.25')).toBe('7.25');
  });

  it('clasifica correctamente los negativos', () => {
    expect(isNegative('-0.01')).toBe(true);
    expect(isPositive('-0.01')).toBe(false);
  });

  it('suma y resta con negativos', () => {
    expect(add('-3.00', '3.00')).toBe('0.00');
    expect(subtract('-3.00', '2.00')).toBe('-5.00');
    expect(add('10.00', '-2.50')).toBe('7.50');
  });
});

describe('Money — caso límite: entradas no numéricas', () => {
  it('parse lanza MoneyError ante entradas no numéricas', () => {
    expect(() => parse('abc')).toThrow(MoneyError);
    expect(() => parse('')).toThrow(MoneyError);
    expect(() => parse('   ')).toThrow(MoneyError);
    expect(() => parse('1.2.3')).toThrow(MoneyError);
    expect(() => parse('$5.00')).toThrow(MoneyError);
    expect(() => parse('5,00')).toThrow(MoneyError);
    expect(() => parse('1e3')).toThrow(MoneyError);
  });

  it('parse rechaza number no finito o no entero', () => {
    expect(() => parse(NaN)).toThrow(MoneyError);
    expect(() => parse(Infinity)).toThrow(MoneyError);
    expect(() => parse(-Infinity)).toThrow(MoneyError);
    expect(() => parse(1.5)).toThrow(MoneyError);
  });

  it('isValid devuelve false ante entradas inválidas sin lanzar', () => {
    expect(isValid('abc')).toBe(false);
    expect(isValid('')).toBe(false);
    expect(isValid('1.2.3')).toBe(false);
    expect(isValid(NaN)).toBe(false);
    expect(isValid(1.5)).toBe(false);
    expect(isValid(null)).toBe(false);
    expect(isValid(undefined)).toBe(false);
    expect(isValid({})).toBe(false);
    expect(isValid([])).toBe(false);
    expect(isValid(true)).toBe(false);
  });

  it('isValid devuelve true ante entradas válidas', () => {
    expect(isValid('150.00')).toBe(true);
    expect(isValid('0')).toBe(true);
    expect(isValid('-3.14')).toBe(true);
    expect(isValid(150)).toBe(true);
  });
});

describe('Money — caso límite: más de dos decimales (rechazado)', () => {
  it('parse rechaza tres o más decimales', () => {
    expect(() => parse('1.234')).toThrow(MoneyError);
    expect(() => parse('0.001')).toThrow(MoneyError);
    expect(() => parse('-9.999')).toThrow(MoneyError);
  });

  it('isValid rechaza más de dos decimales', () => {
    expect(isValid('1.234')).toBe(false);
    expect(isValid('100.000')).toBe(false);
  });

  it('la aritmética rechaza operandos con más de dos decimales', () => {
    expect(() => add('1.234', '1.00')).toThrow(MoneyError);
    expect(() => subtract('5.00', '0.005')).toThrow(MoneyError);
  });
});

describe('Money — aritmética (suma/resta) sin punto flotante', () => {
  it('suma valores que producen errores clásicos de float', () => {
    // 0.1 + 0.2 en float da 0.30000000000000004; aquí es exacto.
    expect(add('0.10', '0.20')).toBe('0.30');
  });

  it('resta valores que producen errores clásicos de float', () => {
    expect(subtract('0.30', '0.10')).toBe('0.20');
  });

  it('es asociativa/acumulativa de forma exacta', () => {
    let acc = ZERO;
    for (let i = 0; i < 10; i++) {
      acc = add(acc, '0.10');
    }
    expect(acc).toBe('1.00');
  });
});

describe('Money — comparadores', () => {
  it('compare devuelve -1, 0 o 1', () => {
    expect(compare('1.00', '2.00')).toBe(-1);
    expect(compare('2.00', '2.00')).toBe(0);
    expect(compare('3.00', '2.00')).toBe(1);
  });

  it('trata representaciones equivalentes como iguales', () => {
    expect(equals('5', '5.00')).toBe(true);
    expect(equals('5.5', '5.50')).toBe(true);
    expect(compare('-0', '0.00')).toBe(0);
  });

  it('lessThan / lessThanOrEqual', () => {
    expect(lessThan('1.00', '1.01')).toBe(true);
    expect(lessThan('1.00', '1.00')).toBe(false);
    expect(lessThanOrEqual('1.00', '1.00')).toBe(true);
    expect(lessThanOrEqual('1.01', '1.00')).toBe(false);
  });

  it('greaterThan / greaterThanOrEqual', () => {
    expect(greaterThan('2.00', '1.99')).toBe(true);
    expect(greaterThan('2.00', '2.00')).toBe(false);
    expect(greaterThanOrEqual('2.00', '2.00')).toBe(true);
    expect(greaterThanOrEqual('1.99', '2.00')).toBe(false);
  });

  it('compara correctamente negativos y positivos', () => {
    expect(compare('-1.00', '1.00')).toBe(-1);
    expect(compare('-0.01', '-0.02')).toBe(1);
  });
});

describe('Money — rangos', () => {
  it('isWithinRange respeta límites inclusivos', () => {
    expect(isWithinRange('0.01', '0.01', '999999999.99')).toBe(true);
    expect(isWithinRange('999999999.99', '0.01', '999999999.99')).toBe(true);
    expect(isWithinRange('500.00', '0.01', '999999999.99')).toBe(true);
    expect(isWithinRange('0.00', '0.01', '999999999.99')).toBe(false);
    expect(isWithinRange('1000000000.00', '0.01', '999999999.99')).toBe(false);
  });

  it('isWithinRange lanza MoneyError si min > max', () => {
    expect(() => isWithinRange('5.00', '10.00', '1.00')).toThrow(MoneyError);
  });

  it('clamp restringe al límite más cercano', () => {
    expect(clamp('5.00', '10.00', '20.00')).toBe('10.00');
    expect(clamp('25.00', '10.00', '20.00')).toBe('20.00');
    expect(clamp('15.00', '10.00', '20.00')).toBe('15.00');
  });

  it('clamp lanza MoneyError si min > max', () => {
    expect(() => clamp('5.00', '10.00', '1.00')).toThrow(MoneyError);
  });
});
