/**
 * Categorías básicas de ingresos y egresos que se crean por defecto al dar de
 * alta un comité nuevo (R13.x). El comité puede editarlas o eliminarlas después.
 *
 * La tabla `transaction_categories` es una lista plana por comité (nombre único
 * por comité), por lo que estas etiquetas cubren conceptos comunes de ambos
 * flujos: ingresos y egresos.
 *
 * Mantener esta lista alineada con la migración
 * `0018_default_transaction_categories.sql`, que siembra las mismas categorías
 * para los comités existentes.
 */
export const DEFAULT_CATEGORIES: readonly string[] = [
  // Ingresos comunes
  'Cuotas',
  'Aportaciones',
  'Donaciones',
  'Actividades',
  'Bonos',
  'Otros ingresos',
  // Egresos comunes
  'Mantenimiento',
  'Servicios',
  'Papelería',
  'Eventos',
  'Premios',
  'Otros egresos',
];
