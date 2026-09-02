import { describe, expect, it } from 'vitest';

import { emailValidator, minLengthValidator } from './form-field';

/**
 * Pruebas unitarias de los validadores puros usados para la validación
 * inmediata de formularios (Requirement 42.2). Verifican la lógica pura sin
 * renderizar el componente.
 */
describe('emailValidator', () => {
  it('acepta un correo con formato válido', () => {
    expect(emailValidator('persona@ejemplo.com')).toBeNull();
  });

  it('ignora el valor vacío (la obligatoriedad la gestiona `required`)', () => {
    expect(emailValidator('')).toBeNull();
    expect(emailValidator('   ')).toBeNull();
  });

  it('rechaza correos sin arroba', () => {
    expect(emailValidator('personaejemplo.com')).toBe(
      'Ingresa un correo electrónico válido.',
    );
  });

  it('rechaza correos sin dominio de nivel superior', () => {
    expect(emailValidator('persona@ejemplo')).toBe(
      'Ingresa un correo electrónico válido.',
    );
  });

  it('rechaza correos con espacios', () => {
    expect(emailValidator('per sona@ejemplo.com')).toBe(
      'Ingresa un correo electrónico válido.',
    );
  });
});

describe('minLengthValidator', () => {
  it('acepta valores con la longitud mínima o mayor', () => {
    const validate = minLengthValidator(3);
    expect(validate('abc')).toBeNull();
    expect(validate('abcd')).toBeNull();
  });

  it('ignora el valor vacío', () => {
    const validate = minLengthValidator(3);
    expect(validate('')).toBeNull();
  });

  it('rechaza valores por debajo de la longitud mínima', () => {
    const validate = minLengthValidator(3);
    expect(validate('ab')).toBe('Debe tener al menos 3 caracteres.');
  });
});
