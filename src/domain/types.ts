/**
 * Tipos de dominio compartidos de SAC.
 *
 * Estos tipos concretan las "Convenciones comunes" del documento de diseño y
 * se usan de forma transversal en los servicios de aplicación. Los montos NUNCA
 * se representan con `number` de punto flotante: se usan como cadenas decimales
 * exactas mediante el tipo `Money` (Requirements 41.1).
 */

/** Identificador universal (UUID v4) representado como cadena. */
export type UUID = string;

/**
 * Monto monetario decimal exacto representado como cadena, ej. "150.00".
 *
 * Nunca es un `number` de punto flotante. Se persiste en PostgreSQL como
 * `NUMERIC(16,2)`. La aritmética y validación se realizan mediante las
 * utilidades de `@/domain/money` (Requirements 41.1).
 */
export type Money = string;

/**
 * Periodo mensual con formato 'YYYY-MM'. Se materializa como el primer día del
 * periodo (DATE) al persistirse.
 */
export type Period = string;

/**
 * Contexto autenticado resuelto en el servidor. Toda operación de escritura lo
 * recibe y debe validar la membresía activa al comité y los permisos efectivos
 * antes de tocar datos (Requirements 2.4, 2.6, 6.2).
 */
export interface Ctx {
  /** Usuario autenticado. */
  userId: UUID;
  /** Comité activo del contexto. */
  committeeId: UUID;
  /** Permisos efectivos (unión de los permisos de los roles asignados). */
  permissions: string[];
  /** Indica si el usuario es superadministrador de plataforma. */
  isSuperAdmin: boolean;
}

/**
 * Error estructurado devuelto por una operación fallida.
 */
export interface ResultError {
  /** Código de error estable para consumo programático. */
  code: string;
  /** Mensaje legible para el usuario. */
  message: string;
  /** Campo asociado al error de validación, cuando aplique. */
  field?: string;
}

/**
 * Resultado discriminado de una operación: éxito con valor o fallo con error.
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ResultError };

/** Construye un resultado exitoso. */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Construye un resultado fallido. */
export function err<T = never>(
  code: string,
  message: string,
  field?: string,
): Result<T> {
  return { ok: false, error: field ? { code, message, field } : { code, message } };
}
