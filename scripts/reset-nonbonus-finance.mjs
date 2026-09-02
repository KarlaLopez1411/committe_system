#!/usr/bin/env node
// =============================================================================
// Reset selectivo de finanzas de UN comité, conservando los bonos (salvo agosto).
//
// Qué hace (en una sola transacción lógica; dry-run por defecto):
//   1. Borra TODAS las transacciones financieras que NO sean de bono
//      (source_type distinto de 'bonus' y 'bonus_prize'), junto con sus
//      ledger_entries, transfers y transaction_attachments. Esto incluye las
//      aportaciones (source_type='contribution') y cualquier ingreso/egreso
//      capturado a mano.
//   2. Borra los BONOS DE AGOSTO: las transacciones de bono (source_type IN
//      ('bonus','bonus_prize')) cuya transaction_date cae en agosto del año
//      indicado, con sus ledger_entries/attachments; desmarca el mes 8 en
//      bonus_number_ledger.pagos; y borra las entregas de premio de agosto en
//      bonus_prize_deliveries. NO toca asignaciones (números↔vendedor,
//      beneficiarios) ni el resto de meses.
//   3. Borra los registros de la tabla `contributions` (aportaciones), SIN
//      borrar miembros.
//   4. Borra los cortes de caja (cash_closings + cash_closing_details).
//   5. Ajusta la caja principal (caja_general activa) para que su SALDO FINAL
//      derivado quede EXACTAMENTE en TARGET: opening_balance = TARGET - (suma de
//      los ledger_entries de bono que se conservan en esa cuenta).
//
// El saldo de las cuentas es DERIVADO (opening_balance + SUM(ledger_entries)),
// así que no hay "campo saldo" que resetear: al borrar apuntes, el saldo baja solo.
//
// SEGURIDAD:
//   - Dry-run por defecto. Requiere --apply para escribir.
//   - Aborta si existen filas legacy en bonus_settlements / bonus_prize_payments
//     (tienen FK real a financial_transactions y romperían el borrado).
//   - Exige COMMITTEE (uuid) o COMMITTEE_CODE para acotar a un solo comité.
//
// USO:
//   set -a; source .env.local; set +a
//   COMMITTEE_CODE=ABCD YEAR=2026 CASH_TARGET=1240 node scripts/reset-nonbonus-finance.mjs
//   COMMITTEE_CODE=ABCD YEAR=2026 CASH_TARGET=1240 node scripts/reset-nonbonus-finance.mjs --apply
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SRK) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Ejecuta:\n  set -a; source .env.local; set +a');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const COMMITTEE = process.env.COMMITTEE ?? null;
const COMMITTEE_CODE = process.env.COMMITTEE_CODE ?? null;
const YEAR = Number(process.env.YEAR ?? new Date().getFullYear());
const CASH_TARGET = process.env.CASH_TARGET ?? process.env.OPENING_BALANCE ?? '1240';
const BONUS_SOURCES = ['bonus', 'bonus_prize'];
const AUG_MONTH = 8;

const admin = createClient(URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } });

// Formato de dinero de dos decimales, en centavos enteros para evitar flotantes.
function toCents(numStr) {
  const [i, d = ''] = String(numStr).split('.');
  const cents = (d + '00').slice(0, 2);
  const sign = i.trim().startsWith('-') ? -1 : 1;
  const whole = Math.abs(parseInt(i, 10) || 0);
  return sign * (whole * 100 + parseInt(cents, 10));
}
function fromCents(c) {
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

async function resolveCommittee() {
  if (COMMITTEE) {
    const { data } = await admin.from('committees').select('id, name, code').eq('id', COMMITTEE).maybeSingle();
    return data;
  }
  if (COMMITTEE_CODE) {
    const { data } = await admin
      .from('committees')
      .select('id, name, code')
      .eq('code', COMMITTEE_CODE.toUpperCase())
      .maybeSingle();
    return data;
  }
  return null;
}

// Devuelve los IDs de transacciones que cumplen un filtro sobre financial_transactions.
async function txIds(committeeId, build) {
  let q = admin.from('financial_transactions').select('id, source_type, type, transaction_date').eq('committee_id', committeeId);
  q = build(q);
  const { data, error } = await q;
  if (error) throw new Error(`consulta de transacciones: ${error.message}`);
  return data ?? [];
}

// Borra en orden seguro las transacciones dadas (con hijos).
async function deleteTransactions(committeeId, ids, label) {
  if (ids.length === 0) {
    console.log(`  ${label}: 0 transacciones.`);
    return;
  }
  if (!APPLY) {
    console.log(`  ${label}: se borrarían ${ids.length} transacción(es).`);
    return;
  }
  // Hijos primero (RESTRICT en todas las FK):
  const del = async (table, col) => {
    const { error } = await admin.from(table).delete().in(col, ids).eq('committee_id', committeeId);
    if (error && !/Could not find the table/.test(error.message)) {
      throw new Error(`${table}: ${error.message}`);
    }
  };
  await del('transaction_attachments', 'transaction_id');
  await del('transfers', 'transaction_id');
  await del('ledger_entries', 'transaction_id');
  // contributions puede referenciar estas transacciones (FK financial_transaction_id):
  {
    const { error } = await admin
      .from('contributions')
      .update({ financial_transaction_id: null })
      .in('financial_transaction_id', ids)
      .eq('committee_id', committeeId);
    if (error) throw new Error(`contributions unlink: ${error.message}`);
  }
  // donations idem (por si hubiera monetarias vinculadas):
  {
    const { error } = await admin
      .from('donations')
      .update({ financial_transaction_id: null })
      .in('financial_transaction_id', ids)
      .eq('committee_id', committeeId);
    if (error && !/Could not find the table/.test(error.message)) {
      throw new Error(`donations unlink: ${error.message}`);
    }
  }
  const { error } = await admin.from('financial_transactions').delete().in('id', ids).eq('committee_id', committeeId);
  if (error) throw new Error(`financial_transactions: ${error.message}`);
  console.log(`  ${label}: ${ids.length} transacción(es) borradas.`);
}

async function main() {
  console.log(`\n=== Reset selectivo de finanzas ${APPLY ? '(EN VIVO)' : '(DRY RUN — nada se borra)'} ===`);

  const committee = await resolveCommittee();
  if (!committee) {
    console.error('No se encontró el comité. Define COMMITTEE=<uuid> o COMMITTEE_CODE=<código>.');
    process.exit(1);
  }
  const cid = committee.id;
  console.log(`Comité: ${committee.name} (code=${committee.code}, id=${cid})`);
  console.log(`Año para bonos de agosto: ${YEAR} | saldo final caja principal: $${CASH_TARGET}\n`);

  // ── Guardas: filas legacy con FK a financial_transactions ─────────────────
  for (const legacy of ['bonus_settlements', 'bonus_prize_payments']) {
    const { count, error } = await admin
      .from(legacy)
      .select('id', { count: 'exact', head: true })
      .eq('committee_id', cid);
    if (error) {
      if (/Could not find the table/.test(error.message)) continue;
      console.error(`No se pudo verificar ${legacy}: ${error.message}`);
      process.exit(1);
    }
    if ((count ?? 0) > 0) {
      console.error(`ABORTO: existen ${count} filas en ${legacy} (FK a transacciones). Límpialas antes de continuar.`);
      process.exit(1);
    }
  }

  const augFrom = `${YEAR}-08-01`;
  const augTo = `${YEAR}-09-01`;

  // ── 1. Transacciones NO-bono (todas las fechas) ───────────────────────────
  const nonBonus = await txIds(cid, (q) =>
    q.or(`source_type.is.null,source_type.not.in.(${BONUS_SOURCES.join(',')})`),
  );
  // Nota: el filtro .or de arriba incluye source_type NULL y cualquier valor que
  // no sea bono/bonus_prize (aportaciones, capturas manuales, transferencias).

  // ── 2. Transacciones de BONO de agosto ────────────────────────────────────
  const bonusAug = await txIds(cid, (q) =>
    q.in('source_type', BONUS_SOURCES).gte('transaction_date', augFrom).lt('transaction_date', augTo),
  );

  console.log('Plan de borrado de transacciones:');
  await deleteTransactions(cid, nonBonus.map((r) => r.id), 'No-bono (aportaciones, capturas, transferencias)');
  await deleteTransactions(cid, bonusAug.map((r) => r.id), `Bonos de agosto ${YEAR}`);

  // ── 3. Desmarcar agosto en el libro de bonos + borrar entregas de agosto ──
  console.log('\nBonos de agosto (control, sin tocar asignaciones):');
  {
    const { data: rows, error } = await admin
      .from('bonus_number_ledger')
      .select('bonus_number_id, pagos')
      .eq('committee_id', cid);
    if (error) throw new Error(`bonus_number_ledger: ${error.message}`);
    const toClear = (rows ?? []).filter((r) => r.pagos && r.pagos[String(AUG_MONTH)]);
    if (toClear.length === 0) {
      console.log('  pagos[8]: ningún número con agosto marcado.');
    } else if (!APPLY) {
      console.log(`  pagos[8]: se desmarcaría agosto en ${toClear.length} número(s).`);
    } else {
      for (const r of toClear) {
        const pagos = { ...(r.pagos ?? {}) };
        delete pagos[String(AUG_MONTH)];
        const { error: uErr } = await admin
          .from('bonus_number_ledger')
          .update({ pagos, updated_at: new Date().toISOString() })
          .eq('bonus_number_id', r.bonus_number_id)
          .eq('committee_id', cid);
        if (uErr) throw new Error(`bonus_number_ledger update: ${uErr.message}`);
      }
      console.log(`  pagos[8]: agosto desmarcado en ${toClear.length} número(s).`);
    }
  }
  {
    const { data: dels, error } = await admin
      .from('bonus_prize_deliveries')
      .select('id')
      .eq('committee_id', cid)
      .eq('month', AUG_MONTH);
    if (error && !/Could not find the table/.test(error.message)) throw new Error(`bonus_prize_deliveries: ${error.message}`);
    const ids = (dels ?? []).map((d) => d.id);
    if (ids.length === 0) {
      console.log('  entregas de premio (agosto): 0.');
    } else if (!APPLY) {
      console.log(`  entregas de premio (agosto): se borrarían ${ids.length}.`);
    } else {
      const { error: dErr } = await admin.from('bonus_prize_deliveries').delete().in('id', ids).eq('committee_id', cid);
      if (dErr) throw new Error(`bonus_prize_deliveries delete: ${dErr.message}`);
      console.log(`  entregas de premio (agosto): ${ids.length} borrada(s).`);
    }
  }

  // ── 4. Tabla contributions (aportaciones) + cortes de caja ────────────────
  console.log('\nAportaciones y cortes de caja:');
  {
    const { count } = await admin.from('contributions').select('id', { count: 'exact', head: true }).eq('committee_id', cid);
    if ((count ?? 0) === 0) console.log('  contributions: 0.');
    else if (!APPLY) console.log(`  contributions: se borrarían ${count}.`);
    else {
      const { error } = await admin.from('contributions').delete().eq('committee_id', cid);
      if (error) throw new Error(`contributions delete: ${error.message}`);
      console.log(`  contributions: ${count} borrada(s). (miembros intactos)`);
    }
  }
  {
    const { data: closings } = await admin.from('cash_closings').select('id').eq('committee_id', cid);
    const ids = (closings ?? []).map((c) => c.id);
    if (ids.length === 0) console.log('  cash_closings: 0.');
    else if (!APPLY) console.log(`  cash_closings: se borrarían ${ids.length} (con su desglose).`);
    else {
      await admin.from('cash_closing_details').delete().in('cash_closing_id', ids).eq('committee_id', cid);
      const { error } = await admin.from('cash_closings').delete().in('id', ids).eq('committee_id', cid);
      if (error) throw new Error(`cash_closings delete: ${error.message}`);
      console.log(`  cash_closings: ${ids.length} borrado(s).`);
    }
  }

  // ── 5. Ajustar caja principal para que el saldo final derivado sea TARGET ──
  console.log('\nCaja principal:');
  {
    const { data: acct } = await admin
      .from('financial_accounts')
      .select('id, name, opening_balance')
      .eq('committee_id', cid)
      .eq('type', 'caja_general')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!acct) {
      console.log('  No hay caja_general activa; nada que ajustar.');
    } else {
      // Suma de los apuntes que QUEDARÁN en esa cuenta = transacciones de bono
      // que NO son de agosto (lo único que se conserva). Calculado sobre el
      // estado actual para que el número sea correcto también en dry-run.
      const { data: keepTx } = await admin
        .from('financial_transactions')
        .select('id')
        .eq('committee_id', cid)
        .in('source_type', BONUS_SOURCES)
        .or(`transaction_date.lt.${augFrom},transaction_date.gte.${augTo}`);
      const keepIds = new Set((keepTx ?? []).map((t) => t.id));
      const { data: entries } = await admin
        .from('ledger_entries')
        .select('amount, transaction_id')
        .eq('committee_id', cid)
        .eq('account_id', acct.id);
      const sumCents = (entries ?? [])
        .filter((e) => keepIds.has(e.transaction_id))
        .reduce((acc, e) => acc + toCents(e.amount), 0);
      const targetCents = toCents(CASH_TARGET);
      const newOpeningCents = targetCents - sumCents;
      const newOpening = fromCents(newOpeningCents);
      console.log(`  Cuenta: ${acct.name}`);
      console.log(`  Apuntes de bono conservados en la cuenta: $${fromCents(sumCents)}`);
      console.log(`  opening_balance actual: $${acct.opening_balance} → nuevo: $${newOpening}  (saldo final derivado = $${CASH_TARGET})`);
      if (APPLY) {
        const { error } = await admin.from('financial_accounts').update({ opening_balance: newOpening }).eq('id', acct.id);
        if (error) throw new Error(`opening_balance update: ${error.message}`);
        console.log('  opening_balance actualizado.');
      }
    }
  }

  console.log(`\n=== ${APPLY ? 'Reset completado' : 'Previsualización completa (no se borró nada). Repite con --apply para aplicar.'} ===`);
  console.log('Conservado: números/asignaciones/beneficiarios de bonos y pagos de meses distintos a agosto.');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
