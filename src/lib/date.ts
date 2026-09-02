/**
 * Utilidades de fecha para formularios.
 *
 * Los campos `<input type="date">` esperan el formato `YYYY-MM-DD`. Usamos la
 * fecha LOCAL del navegador (no UTC) para evitar el desfase de un día que
 * introduce `toISOString()` cerca de la medianoche según la zona horaria.
 */

/** Fecha de hoy en formato `YYYY-MM-DD` según la zona horaria local. */
export function todayIso(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Primer día del mes en curso en formato `YYYY-MM-DD` (para periodos mensuales). */
export function firstOfMonthIso(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/** Mes en curso en formato `YYYY-MM` (para `<input type="month">`). */
export function currentMonthValue(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Normaliza un periodo al primer día de su mes: acepta `YYYY-MM` o
 * `YYYY-MM-DD` y devuelve siempre `YYYY-MM-01`. Devuelve el mes en curso si el
 * valor no es válido.
 */
export function periodFirstOfMonth(value: string | null | undefined): string {
  const m = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})/) : null;
  if (!m) return firstOfMonthIso();
  return `${m[1]}-${m[2]}-01`;
}
