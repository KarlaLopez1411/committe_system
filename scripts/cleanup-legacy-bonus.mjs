#!/usr/bin/env node
// =============================================================================
// Limpieza de tablas LEGADAS del modelo de bonos (Opción 1).
//
// Borra SOLO las tablas del modelo viejo, que ya no son fuente de verdad tras
// migrar a bonus_number_ledger (pagos JSON por número):
//   - bonus_month_payments   (pago mensual por responsable — obsoleto)
//   - bonus_due_transitions  (bitácora de transiciones de dues — obsoleto)
//   - bonus_collections      (cobros ligados a dues — obsoleto)
//   - bonus_monthly_dues      (mensualidad por número/periodo — obsoleto)
//
// NO toca: bonus_number_ledger (nuevo), ni las transacciones financieras
// (ingresos "Pago bono" / egresos "Premio bono") que representan el dinero real
// en caja. El saldo de caja NO cambia.
//
// Se borra en orden por dependencias (hijos antes que padres).
//
// USO:
//   set -a; source .env.local; set +a
//   node scripts/cleanup-legacy-bonus.mjs --dry-run   # muestra qué borraría
//   node scripts/cleanup-legacy-bonus.mjs             # borra de verdad
//
//   Acotar a un comité (por defecto: todos):
//     BONUS_COMMITTEE_ID=<uuid> node scripts/cleanup-legacy-bonus.mjs
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SRK) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Ejecuta:\n  set -a; source .env.local; set +a');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_COMMITTEE = process.env.BONUS_COMMITTEE_ID ?? null;
const admin = createClient(URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } });

// Orden de borrado: hijos → padres (respeta las FK).
const TABLES = [
  'bonus_month_payments',
  'bonus_due_transitions',
  'bonus_collections',
  'bonus_monthly_dues',
];

async function countRows(table) {
  let q = admin.from(table).select('id', { count: 'exact', head: true });
  if (ONLY_COMMITTEE) q = q.eq('committee_id', ONLY_COMMITTEE);
  const { count, error } = await q;
  if (error) return { error };
  return { count: count ?? 0 };
}

async function main() {
  console.log(`\n=== Limpieza de tablas legadas de bonos ${DRY_RUN ? '(DRY RUN)' : '(EN VIVO)'} ===`);
  console.log(ONLY_COMMITTEE ? `Comité: ${ONLY_COMMITTEE}\n` : 'Alcance: TODOS los comités\n');

  // Verificación de seguridad: no debe haber liquidaciones (settlements) que
  // dependan de collections; si las hubiera, abortamos para no romper FKs.
  {
    let q = admin.from('bonus_settlements').select('id', { count: 'exact', head: true });
    if (ONLY_COMMITTEE) q = q.eq('committee_id', ONLY_COMMITTEE);
    const { count } = await q;
    if ((count ?? 0) > 0) {
      console.error(`ABORTO: existen ${count} bonus_settlements. Revisa antes de borrar collections/dues.`);
      process.exit(1);
    }
  }

  for (const table of TABLES) {
    const { count, error } = await countRows(table);
    if (error) {
      // Tabla inexistente: se ignora.
      if (error.code === 'PGRST205' || /Could not find the table/.test(error.message)) {
        console.log(`  ${table}: (no existe, se omite)`);
        continue;
      }
      console.error(`  ${table}: error al contar: ${error.message}`);
      continue;
    }

    if (count === 0) { console.log(`  ${table}: 0 filas, nada que borrar.`); continue; }

    if (DRY_RUN) {
      console.log(`  ${table}: se borrarían ${count} fila(s).`);
      continue;
    }

    let del = admin.from(table).delete();
    del = ONLY_COMMITTEE
      ? del.eq('committee_id', ONLY_COMMITTEE)
      : del.not('id', 'is', null); // condición que matchea todo (evita delete sin filtro)
    const { error: delErr } = await del;
    if (delErr) console.error(`  ${table}: error al borrar: ${delErr.message}`);
    else console.log(`  ${table}: ${count} fila(s) borradas.`);
  }

  console.log(`\n=== ${DRY_RUN ? 'Previsualización completa (no se borró nada)' : 'Limpieza completada'} ===`);
  console.log('El libro bonus_number_ledger y las transacciones de caja se conservan intactos.');
}

main().catch((e) => { console.error(e); process.exit(1); });
