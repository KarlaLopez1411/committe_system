#!/usr/bin/env node
// =============================================================================
// Backfill de pagos mensuales de bonos (enero–julio por defecto) — modelo JSON.
//
// Usa el LIBRO bonus_number_ledger (una fila por número con pagos {mes:bool}).
// Para cada responsable con números en la campaña y para cada mes del rango:
//   1) Marca pagos[mes]=true en los números del responsable que aún no lo tengan.
//   2) Genera UN ingreso a la Caja General (rpc_register_income) por el total de
//      los números recién marcados: 'Pago bono - {responsable}'.
// Y por cada mes del rango, un egreso del premio mensual (monthly_prize):
//   'Premio bono - {Mes} {Año}' (source_type='bonus_prize'). --no-prize lo omite.
//
// Idempotente: los meses ya marcados en el JSON se saltan (no se re-cobran); el
// egreso del premio se salta si ya existe uno 'bonus_prize' para ese comité/fecha.
//
// USO:
//   set -a; source .env.local; set +a
//   node scripts/backfill-bonus-payments.mjs --dry-run     # previsualiza
//   node scripts/backfill-bonus-payments.mjs               # aplica
//   node scripts/backfill-bonus-payments.mjs --no-prize    # sin egreso de premio
//   BONUS_FROM_MONTH=1 BONUS_TO_MONTH=7 BONUS_YEAR=2026 node scripts/backfill-bonus-payments.mjs
//
// REQUISITOS: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY en el entorno,
// y las migraciones aplicadas (incluida 0022 bonus_number_ledger).
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SRK) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Ejecuta:\n  set -a; source .env.local; set +a');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const NO_PRIZE = process.argv.includes('--no-prize');
const YEAR = Number(process.env.BONUS_YEAR ?? 2026);
const FROM_MONTH = Number(process.env.BONUS_FROM_MONTH ?? 1);
const TO_MONTH = Number(process.env.BONUS_TO_MONTH ?? 7);
const ONLY_CAMPAIGN = process.env.BONUS_CAMPAIGN_ID ?? null;
const BONUS_CATEGORY_NAME = 'Bonos';

const admin = createClient(URL, SRK, { auth: { persistSession: false, autoRefreshToken: false } });

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const periodFor = (year, m) => `${year}-${String(m).padStart(2, '0')}-01`;
const totalStr = (monthlyAmount, count) => ((Math.round(Number(monthlyAmount) * 100) * count) / 100).toFixed(2);

async function findCategory(committeeId) {
  const { data: cat } = await admin
    .from('transaction_categories').select('id')
    .eq('committee_id', committeeId).eq('name', BONUS_CATEGORY_NAME).maybeSingle();
  if (cat?.id) return cat.id;
  if (DRY_RUN) return null;
  const { data: created } = await admin
    .from('transaction_categories')
    .insert({ committee_id: committeeId, name: BONUS_CATEGORY_NAME })
    .select('id').maybeSingle();
  return created?.id ?? null;
}

async function main() {
  console.log(`\n=== Backfill pagos de bonos — ${MONTHS[FROM_MONTH - 1]}–${MONTHS[TO_MONTH - 1]} ${YEAR} ${DRY_RUN ? '(DRY RUN)' : '(EN VIVO)'} ===\n`);

  // Verifica que exista el libro (migración 0022).
  {
    const { error } = await admin.from('bonus_number_ledger').select('id').limit(1);
    if (error && (error.code === 'PGRST205' || /bonus_number_ledger/.test(error.message))) {
      console.error('ERROR: la tabla bonus_number_ledger no existe. Aplica las migraciones primero:');
      console.error("  SUPABASE_DB_PASSWORD='...' npm run db:update");
      process.exit(1);
    }
  }

  let campQuery = admin.from('bonus_campaigns').select('id, name, year, monthly_amount, monthly_prize, committee_id');
  if (ONLY_CAMPAIGN) campQuery = campQuery.eq('id', ONLY_CAMPAIGN);
  const { data: campaigns, error: campErr } = await campQuery;
  if (campErr) { console.error('No se pudieron leer las campañas:', campErr.message); process.exit(1); }
  if (!campaigns?.length) { console.error('No hay campañas.'); process.exit(1); }

  let grandTotal = '0.00';
  let grandCount = 0;
  let prizeTotal = '0.00';
  let prizeCount = 0;

  for (const camp of campaigns) {
    const monthly = String(camp.monthly_amount);
    const prize = String(camp.monthly_prize);
    console.log(`Campaña "${camp.name}" (${camp.year}) — aportación $${monthly}/mes · premio $${prize}/mes`);

    const { data: cu } = await admin
      .from('committee_users').select('user_id')
      .eq('committee_id', camp.committee_id).eq('status', 'active').limit(1).maybeSingle();
    const actor = cu?.user_id ?? null;

    const { data: account } = await admin
      .from('financial_accounts').select('id')
      .eq('committee_id', camp.committee_id).eq('type', 'caja_general').eq('status', 'active')
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (!account) console.warn('  ⚠ Sin cuenta caja_general activa: se marcarán pagos SIN generar ingreso.');
    const categoryId = account ? await findCategory(camp.committee_id) : null;

    // Libro de la campaña: número → {id, seller_id, pagos}.
    const { data: ledger } = await admin
      .from('bonus_number_ledger')
      .select('bonus_number_id, seller_id, pagos')
      .eq('committee_id', camp.committee_id).eq('campaign_id', camp.id);

    // Agrupa por responsable.
    const bySeller = new Map();
    for (const r of ledger ?? []) {
      if (!r.seller_id) continue;
      const list = bySeller.get(r.seller_id) ?? [];
      list.push(r);
      bySeller.set(r.seller_id, list);
    }

    const sellerIds = [...bySeller.keys()];
    const { data: sellers } = await admin
      .from('bonus_sellers').select('id, display_name')
      .in('id', sellerIds.length ? sellerIds : ['00000000-0000-0000-0000-000000000000']);
    const nameById = new Map((sellers ?? []).map((s) => [s.id, s.display_name]));

    for (let m = FROM_MONTH; m <= TO_MONTH; m++) {
      const monthKey = String(m);
      const period = periodFor(camp.year, m);
      console.log(`  ${MONTHS[m - 1]}:`);

      for (const [sellerId, rows] of bySeller) {
        const name = nameById.get(sellerId) ?? sellerId;
        // Números del responsable que aún NO tienen pagado este mes.
        const toPay = rows.filter((r) => !(r.pagos && r.pagos[monthKey]));
        if (toPay.length === 0) { console.log(`    · ${name}: ya pagado, se omite.`); continue; }

        const total = totalStr(monthly, toPay.length);
        console.log(`    · ${name}: ${toPay.length} número(s) · $${total}${DRY_RUN ? '' : ' → aplicando…'}`);
        grandTotal = (Number(grandTotal) + Number(total)).toFixed(2);
        grandCount += 1;
        if (DRY_RUN) continue;

        // 1) Marca pagos[mes]=true en cada número.
        for (const r of toPay) {
          const pagos = { ...(r.pagos ?? {}), [monthKey]: true };
          const { error: upErr } = await admin
            .from('bonus_number_ledger')
            .update({ pagos, updated_at: new Date().toISOString() })
            .eq('bonus_number_id', r.bonus_number_id).eq('committee_id', camp.committee_id);
          if (upErr) { console.error(`      ✗ libro: ${upErr.message}`); continue; }
          r.pagos = pagos; // refleja en memoria para idempotencia intra-corrida
        }

        // 2) Ingreso a Caja General.
        if (account && actor) {
          const { error: rpcErr } = await admin.rpc('rpc_register_income', {
            p_committee_id: camp.committee_id, p_actor: actor, p_account_id: account.id,
            p_category_id: categoryId, p_activity_id: null, p_amount: Number(total),
            p_date: period, p_description: `Pago bono - ${name}`, p_source_type: 'bonus',
            p_source_id: null, p_origin: null, p_payment_method: 'efectivo',
          });
          if (rpcErr) console.error(`      ✗ ingreso: ${rpcErr.message}`);
        }
      }

      // Egreso del premio mensual (uno por campaña/mes).
      if (!NO_PRIZE && Number(prize) > 0) {
        const { data: existingPrize } = await admin
          .from('financial_transactions').select('id')
          .eq('committee_id', camp.committee_id).eq('type', 'expense')
          .eq('source_type', 'bonus_prize').eq('transaction_date', period)
          .limit(1).maybeSingle();
        if (existingPrize) {
          console.log('    premio: ya registrado, se omite.');
        } else if (!account || !actor) {
          console.warn('    premio: sin cuenta/actor, se omite.');
        } else {
          console.log(`    premio: $${prize}${DRY_RUN ? '' : ' → aplicando…'}`);
          prizeTotal = (Number(prizeTotal) + Number(prize)).toFixed(2);
          prizeCount += 1;
          if (!DRY_RUN) {
            const { error: expErr } = await admin.rpc('rpc_register_expense', {
              p_committee_id: camp.committee_id, p_actor: actor, p_account_id: account.id,
              p_category_id: categoryId, p_activity_id: null, p_amount: Number(prize),
              p_date: period, p_beneficiary: 'Ganador del sorteo',
              p_description: `Premio bono - ${MONTHS[m - 1]} ${camp.year}`,
              p_payment_method: 'efectivo', p_source_type: 'bonus_prize', p_source_id: null,
            });
            if (expErr) console.error(`      ✗ premio: ${expErr.message}`);
          }
        }
      }
    }
  }

  console.log(`\n=== ${DRY_RUN ? 'Previsualización' : 'Backfill completado'} ===`);
  console.log(`  Ingresos (pagos de responsables): ${grandCount}, total $${grandTotal}`);
  console.log(`  Egresos (premios mensuales):      ${prizeCount}, total $${prizeTotal}`);
  console.log(`  Neto a caja:                      $${(Number(grandTotal) - Number(prizeTotal)).toFixed(2)}`);
  if (DRY_RUN) console.log('Ejecuta sin --dry-run para aplicar.');
}

main().catch((e) => { console.error(e); process.exit(1); });
