#!/usr/bin/env node
// Verifica qué objetos de esquema recientes existen en la BD (Cloud), para
// deducir qué migraciones ya se aplicaron. Solo lectura; no modifica nada.
//   set -a; source .env.local; set +a
//   node scripts/check-schema.mjs
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SRK) { console.error('Faltan env vars (set -a; source .env.local; set +a)'); process.exit(1); }
const db = createClient(URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } });

// Cada check: intenta seleccionar una columna/tabla que introdujo una migración.
const checks = [
  { label: '0016 committees.code', table: 'committees', column: 'code' },
  { label: '0022 bonus_number_ledger', table: 'bonus_number_ledger', column: 'pagos' },
  { label: '0023 bonus_prize_deliveries', table: 'bonus_prize_deliveries', column: 'winning_number' },
  { label: '0024 members.monthly_commitment', table: 'members', column: 'monthly_commitment' },
  { label: '0024 members.monthly_amount', table: 'members', column: 'monthly_amount' },
];

async function main() {
  console.log('\n=== Verificación de esquema (Cloud) ===\n');
  for (const c of checks) {
    const { error } = await db.from(c.table).select(c.column).limit(1);
    if (!error) console.log(`  ✅ ${c.label} — existe`);
    else if (/column .* does not exist|does not exist|Could not find/i.test(error.message))
      console.log(`  ❌ ${c.label} — FALTA (${error.message})`);
    else console.log(`  ⚠️  ${c.label} — no se pudo verificar: ${error.message}`);
  }

  // Rol 'member' con permisos de lectura (0025).
  const { data: roleRows, error: rErr } = await db
    .from('roles')
    .select('id, role_permissions(permissions(key))')
    .eq('key', 'member');
  if (rErr) {
    console.log(`  ⚠️  0025 member perms — no verificable: ${rErr.message}`);
  } else {
    const perms = [];
    for (const r of roleRows ?? []) {
      for (const rp of r.role_permissions ?? []) {
        const p = Array.isArray(rp.permissions) ? rp.permissions[0] : rp.permissions;
        if (p?.key) perms.push(p.key);
      }
    }
    const has = (k) => perms.includes(k);
    const ok = has('members.read') && has('transactions.read') && has('bonuses.read');
    console.log(`  ${ok ? '✅' : '❌'} 0025 member readonly perms — [${perms.join(', ') || 'ninguno'}]`);
  }
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
