import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Money, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';
import { add, ZERO } from '@/domain/money';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { can } from '@/server/authz';
import { createFinanceService } from '@/server/finance-service';

/** Categoría usada para los ingresos/egresos de bonos. */
const BONUS_CATEGORY_NAME = 'Bonos';

/** Nombres de meses (1–12) en español para conceptos de transacción. */
const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Mapa de pagos por mes: clave '1'..'12' → pagado (true). */
export type PagosMap = Record<string, boolean>;

/** Fila del libro de un número de la campaña. */
export interface LedgerRow {
  bonusNumberId: UUID;
  number: number;
  beneficiary: string | null;
  sellerId: UUID | null;
  sellerName: string | null;
  /** Meses pagados como mapa { '1': true, ... }. */
  pagos: PagosMap;
}

/** Entrega del premio mensual de una campaña. */
export interface PrizeDeliveryRow {
  id: UUID;
  month: number;
  winningNumber: number;
  deliveryDate: string;
  responsible: string | null;
  notes: string | null;
}

/** Datos para registrar una entrega de premio. */
export interface PrizeDeliveryInput {
  month: number;
  winningNumber: number;
  deliveryDate: string;
  responsible?: string | null;
  notes?: string | null;
}

/** Resumen de un mes para el corte: pagados vs pendientes (en número y monto). */
export interface MonthlyCutRow {
  /** Mes 1–12. */
  month: number;
  paidCount: number;
  pendingCount: number;
  /** paidCount × monthly_amount. */
  paidAmount: Money;
  /** pendingCount × monthly_amount. */
  pendingAmount: Money;
  /** Premio del mes (monthly_prize de la campaña). */
  prizeAmount: Money;
  /** true si ya se registró la entrega del premio de ese mes. */
  prizeDelivered: boolean;
}

export interface BonusLedgerServiceDeps { client?: SupabaseClient; }

export interface BonusLedgerService {
  /** Filas del libro (número, beneficiario, responsable, pagos por mes) de la campaña. */
  getCampaignLedger(ctx: Ctx, campaignId: UUID): Promise<Result<LedgerRow[]>>;
  /** Marca/desmarca un mes (1–12) como pagado para un número. */
  setMonthPaid(ctx: Ctx, bonusNumberId: UUID, month: number, paid: boolean): Promise<Result<void>>;
  /**
   * Marca un mes como pagado para TODOS los números de un responsable y genera
   * UN ingreso a caja por el total de ese responsable en ese mes.
   */
  paySellerMonth(
    ctx: Ctx,
    sellerId: UUID,
    campaignId: UUID,
    month: number,
  ): Promise<Result<{ amount: Money; count: number; transactionId: UUID | null }>>;
  /** Corte por mes de la campaña: pagados/pendientes por mes (número y monto). */
  monthlyCut(ctx: Ctx, campaignId: UUID): Promise<Result<MonthlyCutRow[]>>;
  /** Registra la entrega del premio de un mes (número ganador, fecha, responsable). */
  recordPrizeDelivery(ctx: Ctx, campaignId: UUID, data: PrizeDeliveryInput): Promise<Result<{ deliveryId: UUID }>>;
  /** Histórico de entregas de premio de la campaña (por mes). */
  listPrizeDeliveries(ctx: Ctx, campaignId: UUID): Promise<Result<PrizeDeliveryRow[]>>;
}

/** Convierte 'YYYY-MM-01' a partir de año+mes. */
function periodFor(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Suma exacta: monthlyAmount × count usando aritmética Money. */
function multiplyMoney(monthlyAmount: string, count: number): Money {
  let total: Money = ZERO;
  for (let i = 0; i < count; i++) total = add(total, monthlyAmount);
  return total;
}

/** Caja principal activa (caja_general) del comité, o null. */
async function mainCashAccountId(client: SupabaseClient, committeeId: UUID): Promise<UUID | null> {
  const { data } = await client
    .from('financial_accounts')
    .select('id')
    .eq('committee_id', committeeId)
    .eq('type', 'caja_general')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? (data as { id: UUID }).id : null;
}

/** Categoría "Bonos" del comité (find-or-create), o null. */
async function bonusCategoryId(client: SupabaseClient, committeeId: UUID): Promise<UUID | null> {
  const { data: cat } = await client
    .from('transaction_categories')
    .select('id')
    .eq('committee_id', committeeId)
    .eq('name', BONUS_CATEGORY_NAME)
    .maybeSingle();
  if (cat) return (cat as { id: UUID }).id;
  const { data: created } = await client
    .from('transaction_categories')
    .insert({ committee_id: committeeId, name: BONUS_CATEGORY_NAME })
    .select('id')
    .maybeSingle();
  return created ? (created as { id: UUID }).id : null;
}

/**
 * Registra el ingreso a caja de un pago de bono individual (número/mes), si no
 * existe ya uno para ese número y periodo. Idempotente por
 * (source_type='bonus', source_id=bonusNumberId, transaction_date=period).
 */
async function createBonusMonthIncome(
  client: SupabaseClient,
  ctx: Ctx,
  args: { bonusNumberId: UUID; amount: Money; period: string; description: string },
): Promise<void> {
  // Evita duplicar si ya hay un ingreso para este número/periodo.
  const { data: existing } = await client
    .from('financial_transactions')
    .select('id')
    .eq('committee_id', ctx.committeeId)
    .eq('source_type', 'bonus')
    .eq('source_id', args.bonusNumberId)
    .eq('transaction_date', args.period)
    .limit(1)
    .maybeSingle();
  if (existing) return;

  const accountId = await mainCashAccountId(client, ctx.committeeId);
  if (!accountId) return; // sin caja activa no se puede reflejar; el toggle ya quedó guardado
  const categoryId = await bonusCategoryId(client, ctx.committeeId);

  const finance = createFinanceService({ client });
  await finance.registerIncome(ctx, {
    accountId,
    categoryId,
    amount: args.amount,
    date: args.period,
    description: args.description,
    sourceType: 'bonus',
    sourceId: args.bonusNumberId,
    paymentMethod: 'efectivo',
  });
}

/**
 * Elimina el ingreso a caja del pago de bono de un número/periodo (al desmarcar
 * el mes). Borra la transacción y sus apuntes de ledger, de modo que el saldo
 * vuelve a excluir ese pago. Coincide por (source_type, source_id, fecha).
 */
async function removeBonusMonthIncome(
  client: SupabaseClient,
  ctx: Ctx,
  args: { bonusNumberId: UUID; period: string },
): Promise<void> {
  const { data: txs } = await client
    .from('financial_transactions')
    .select('id')
    .eq('committee_id', ctx.committeeId)
    .eq('source_type', 'bonus')
    .eq('source_id', args.bonusNumberId)
    .eq('transaction_date', args.period);
  const ids = ((txs ?? []) as { id: UUID }[]).map((t) => t.id);
  if (ids.length === 0) return;
  await client.from('ledger_entries').delete().eq('committee_id', ctx.committeeId).in('transaction_id', ids);
  await client.from('financial_transactions').delete().eq('committee_id', ctx.committeeId).in('id', ids);
}

export function createBonusLedgerService(deps: BonusLedgerServiceDeps = {}): BonusLedgerService {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  async function loadLedger(client: SupabaseClient, ctx: Ctx, campaignId: UUID) {
    const { data, error } = await client
      .from('bonus_number_ledger')
      .select('bonus_number_id, number, beneficiary, seller_id, pagos')
      .eq('committee_id', ctx.committeeId)
      .eq('campaign_id', campaignId)
      .order('number', { ascending: true });
    if (error) return { error };
    return { rows: (data ?? []) as {
      bonus_number_id: UUID; number: number; beneficiary: string | null;
      seller_id: UUID | null; pagos: PagosMap | null;
    }[] };
  }

  return {
    async getCampaignLedger(ctx, campaignId) {
      if (!can(ctx, 'bonuses.read') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para consultar los bonos.');
      }
      const client = getClient();
      const res = await loadLedger(client, ctx, campaignId);
      if (res.error) return err('ledger/list-failed', `No se pudo cargar el libro: ${res.error.message}.`);

      // Nombres de responsables.
      const sellerIds = [...new Set(res.rows.map((r) => r.seller_id).filter(Boolean))] as UUID[];
      const nameById = new Map<string, string>();
      if (sellerIds.length > 0) {
        const { data: sellers } = await client
          .from('bonus_sellers')
          .select('id, display_name')
          .in('id', sellerIds);
        for (const s of (sellers ?? []) as { id: UUID; display_name: string }[]) {
          nameById.set(s.id, s.display_name);
        }
      }

      const rows: LedgerRow[] = res.rows.map((r) => ({
        bonusNumberId: r.bonus_number_id,
        number: r.number,
        beneficiary: r.beneficiary ?? null,
        sellerId: r.seller_id ?? null,
        sellerName: r.seller_id ? (nameById.get(r.seller_id) ?? null) : null,
        pagos: r.pagos ?? {},
      }));
      return ok(rows);
    },

    async setMonthPaid(ctx, bonusNumberId, month, paid) {
      if (!can(ctx, 'bonuses.collect') && !can(ctx, 'bonuses.manage') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para actualizar pagos.');
      }
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        return err('ledger/invalid-month', 'El mes debe estar entre 1 y 12.', 'month');
      }
      const client = getClient();

      const { data: row } = await client
        .from('bonus_number_ledger')
        .select('pagos, campaign_id, number, beneficiary')
        .eq('bonus_number_id', bonusNumberId)
        .eq('committee_id', ctx.committeeId)
        .maybeSingle();
      if (!row) return err('ledger/not-found', 'El número indicado no existe en el libro.');

      const ledgerRow = row as {
        pagos: PagosMap | null;
        campaign_id: UUID;
        number: number;
        beneficiary: string | null;
      };
      const pagos: PagosMap = { ...(ledgerRow.pagos ?? {}) };
      const key = String(month);
      const wasPaid = Boolean(pagos[key]);

      if (paid) pagos[key] = true;
      else delete pagos[key];

      const { error } = await client
        .from('bonus_number_ledger')
        .update({ pagos, updated_at: new Date().toISOString() })
        .eq('bonus_number_id', bonusNumberId)
        .eq('committee_id', ctx.committeeId);
      if (error) return err('ledger/update-failed', `No se pudo actualizar el pago: ${error.message}.`);

      // ── Reflejar el pago individual en la caja (ingreso), igual que el pago
      // por responsable. Idempotente por (source_type='bonus', source_id=número,
      // transaction_date=periodo del mes): un ingreso por número/mes.
      const { data: campaign } = await client
        .from('bonus_campaigns')
        .select('monthly_amount, year')
        .eq('id', ledgerRow.campaign_id)
        .eq('committee_id', ctx.committeeId)
        .maybeSingle();
      if (!campaign) return ok(undefined); // sin campaña no se puede derivar el monto; el toggle ya quedó guardado
      const monthlyAmount = String((campaign as { monthly_amount: string | number }).monthly_amount);
      const year = (campaign as { year: number }).year;
      const period = periodFor(year, month);

      if (paid && !wasPaid) {
        await createBonusMonthIncome(client, ctx, {
          bonusNumberId,
          amount: monthlyAmount,
          period,
          description: `Pago bono #${ledgerRow.number}${ledgerRow.beneficiary ? ` - ${ledgerRow.beneficiary}` : ''} (${MONTH_NAMES_ES[month - 1]})`,
        });
      } else if (!paid && wasPaid) {
        await removeBonusMonthIncome(client, ctx, { bonusNumberId, period });
      }

      return ok(undefined);
    },

    async paySellerMonth(ctx, sellerId, campaignId, month) {
      if (!can(ctx, 'bonuses.collect') && !can(ctx, 'bonuses.manage') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para registrar pagos de bonos.');
      }
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        return err('ledger/invalid-month', 'El mes debe estar entre 1 y 12.', 'month');
      }
      const client = getClient();

      const { data: campaign } = await client
        .from('bonus_campaigns')
        .select('monthly_amount, year')
        .eq('id', campaignId)
        .eq('committee_id', ctx.committeeId)
        .single();
      if (!campaign) return err('campaign/not-found', 'La campaña indicada no existe.');
      const monthlyAmount = String((campaign as { monthly_amount: string | number }).monthly_amount);
      const year = (campaign as { year: number }).year;

      const { data: seller } = await client
        .from('bonus_sellers')
        .select('display_name')
        .eq('id', sellerId)
        .eq('committee_id', ctx.committeeId)
        .single();
      if (!seller) return err('seller/not-found', 'El responsable indicado no existe.');
      const sellerName = (seller as { display_name: string }).display_name;

      // Filas del libro de este responsable en la campaña.
      const { data: rows } = await client
        .from('bonus_number_ledger')
        .select('bonus_number_id, pagos')
        .eq('committee_id', ctx.committeeId)
        .eq('campaign_id', campaignId)
        .eq('seller_id', sellerId);

      const ledgerRows = (rows ?? []) as { bonus_number_id: UUID; pagos: PagosMap | null }[];
      if (ledgerRows.length === 0) {
        return err('payment/no-numbers', 'El responsable no tiene números asignados en esta campaña.');
      }

      // Marca el mes en cada número que aún no lo tenga.
      const key = String(month);
      let newlyPaid = 0;
      for (const r of ledgerRows) {
        const pagos: PagosMap = { ...(r.pagos ?? {}) };
        if (pagos[key]) continue; // ya estaba pagado ese mes
        pagos[key] = true;
        newlyPaid += 1;
        const { error } = await client
          .from('bonus_number_ledger')
          .update({ pagos, updated_at: new Date().toISOString() })
          .eq('bonus_number_id', r.bonus_number_id)
          .eq('committee_id', ctx.committeeId);
        if (error) return err('ledger/update-failed', `No se pudo marcar el pago: ${error.message}.`);
      }

      if (newlyPaid === 0) {
        return err('payment/already-paid', 'Todos los números de este responsable ya estaban pagados en ese mes.');
      }

      // Ingreso a caja principal por el total recién marcado.
      const total = multiplyMoney(monthlyAmount, newlyPaid);
      const period = periodFor(year, month);
      let transactionId: UUID | null = null;

      const { data: account } = await client
        .from('financial_accounts')
        .select('id')
        .eq('committee_id', ctx.committeeId)
        .eq('type', 'caja_general')
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (account) {
        const accountId = (account as { id: UUID }).id;
        // Categoría "Bonos" (find-or-create).
        const { data: cat } = await client
          .from('transaction_categories')
          .select('id')
          .eq('committee_id', ctx.committeeId)
          .eq('name', BONUS_CATEGORY_NAME)
          .maybeSingle();
        let categoryId: UUID | null = cat ? (cat as { id: UUID }).id : null;
        if (!categoryId) {
          const { data: created } = await client
            .from('transaction_categories')
            .insert({ committee_id: ctx.committeeId, name: BONUS_CATEGORY_NAME })
            .select('id')
            .maybeSingle();
          categoryId = created ? (created as { id: UUID }).id : null;
        }

        const finance = createFinanceService({ client });
        const income = await finance.registerIncome(ctx, {
          accountId,
          categoryId,
          amount: total,
          date: period,
          description: `Pago bono - ${sellerName}`,
          sourceType: 'bonus',
          paymentMethod: 'efectivo',
        });
        if (!income.ok) {
          return err('payment/income-failed', `No se pudo registrar el ingreso: ${income.error.message}.`);
        }
        transactionId = income.value.transactionId;
      }

      return ok({ amount: total, count: newlyPaid, transactionId });
    },

    async monthlyCut(ctx, campaignId) {
      if (!can(ctx, 'bonuses.read') && !can(ctx, 'committee.manage') && !can(ctx, 'reports.read')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para consultar el corte.');
      }
      const client = getClient();

      const { data: campaign } = await client
        .from('bonus_campaigns')
        .select('monthly_amount, monthly_prize')
        .eq('id', campaignId)
        .eq('committee_id', ctx.committeeId)
        .single();
      if (!campaign) return err('campaign/not-found', 'La campaña indicada no existe.');
      const monthlyAmount = String((campaign as { monthly_amount: string | number }).monthly_amount);
      const prize = String((campaign as { monthly_prize: string | number }).monthly_prize);

      const res = await loadLedger(client, ctx, campaignId);
      if (res.error) return err('ledger/list-failed', `No se pudo cargar el corte: ${res.error.message}.`);

      // Meses con entrega de premio ya registrada.
      const { data: deliveries } = await client
        .from('bonus_prize_deliveries')
        .select('month')
        .eq('committee_id', ctx.committeeId)
        .eq('campaign_id', campaignId);
      const deliveredMonths = new Set(
        ((deliveries ?? []) as { month: number }[]).map((d) => d.month),
      );

      const total = res.rows.length; // total de números de la campaña
      const paidByMonth = new Map<number, number>();
      for (const r of res.rows) {
        const pagos = r.pagos ?? {};
        for (let m = 1; m <= 12; m++) {
          if (pagos[String(m)]) paidByMonth.set(m, (paidByMonth.get(m) ?? 0) + 1);
        }
      }

      const rows: MonthlyCutRow[] = [];
      for (let m = 1; m <= 12; m++) {
        const paidCount = paidByMonth.get(m) ?? 0;
        const pendingCount = total - paidCount;
        rows.push({
          month: m,
          paidCount,
          pendingCount,
          paidAmount: multiplyMoney(monthlyAmount, paidCount),
          pendingAmount: multiplyMoney(monthlyAmount, pendingCount),
          prizeAmount: prize,
          prizeDelivered: deliveredMonths.has(m),
        });
      }
      return ok(rows);
    },

    async recordPrizeDelivery(ctx, campaignId, data) {
      if (!can(ctx, 'bonuses.draw') && !can(ctx, 'bonuses.manage') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para registrar entregas de premio.');
      }
      const month = Number(data?.month);
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        return err('prize/invalid-month', 'El mes debe estar entre 1 y 12.', 'month');
      }
      const winning = Number(data?.winningNumber);
      if (!Number.isInteger(winning) || winning < 1) {
        return err('prize/invalid-number', 'El número ganador no es válido.', 'winningNumber');
      }
      if (!data?.deliveryDate) {
        return err('prize/missing-date', 'La fecha de entrega es obligatoria.', 'deliveryDate');
      }

      const client = getClient();

      // Valida que la campaña pertenezca al comité y toma el premio y el año.
      const { data: campaign } = await client
        .from('bonus_campaigns')
        .select('id, year, monthly_prize')
        .eq('id', campaignId)
        .eq('committee_id', ctx.committeeId)
        .maybeSingle();
      if (!campaign) return err('campaign/not-found', 'La campaña indicada no existe.');
      const prize = String((campaign as { monthly_prize: string | number }).monthly_prize);

      const { data: row, error } = await client
        .from('bonus_prize_deliveries')
        .insert({
          committee_id: ctx.committeeId,
          campaign_id: campaignId,
          month,
          winning_number: winning,
          delivery_date: data.deliveryDate,
          responsible: (data.responsible ?? '').trim() || null,
          notes: (data.notes ?? '').trim() || null,
          created_by: ctx.userId,
        })
        .select('id')
        .single();

      if (error || !row) {
        if (error?.code === '23505') {
          return err('prize/already-delivered', 'Ya se registró la entrega del premio de ese mes.');
        }
        return err('prize/delivery-failed', `No se pudo registrar la entrega: ${error?.message ?? 'error desconocido'}.`);
      }
      const deliveryId = (row as { id: UUID }).id;

      // Genera el EGRESO del premio a la caja principal (marca el premio pagado).
      const { data: account } = await client
        .from('financial_accounts')
        .select('id')
        .eq('committee_id', ctx.committeeId)
        .eq('type', 'caja_general')
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (account) {
        const accountId = (account as { id: UUID }).id;
        // Categoría "Bonos" (find-or-create).
        const { data: cat } = await client
          .from('transaction_categories')
          .select('id')
          .eq('committee_id', ctx.committeeId)
          .eq('name', BONUS_CATEGORY_NAME)
          .maybeSingle();
        let categoryId: UUID | null = cat ? (cat as { id: UUID }).id : null;
        if (!categoryId) {
          const { data: created } = await client
            .from('transaction_categories')
            .insert({ committee_id: ctx.committeeId, name: BONUS_CATEGORY_NAME })
            .select('id')
            .maybeSingle();
          categoryId = created ? (created as { id: UUID }).id : null;
        }

        const finance = createFinanceService({ client });
        const expense = await finance.registerExpense(ctx, {
          accountId,
          categoryId: categoryId as UUID,
          amount: prize,
          date: data.deliveryDate,
          beneficiary: `Ganador bono #${winning}`,
          description: `Premio bono - ${MONTH_NAMES_ES[month - 1]}`,
          paymentMethod: 'efectivo',
          sourceType: 'bonus_prize',
        });
        // Si falla el egreso no revertimos la entrega (queda registrada); se avisa.
        if (!expense.ok) {
          return err('prize/expense-failed', `Entrega registrada, pero no se pudo generar el egreso del premio: ${expense.error.message}.`);
        }
      }

      return ok({ deliveryId });
    },

    async listPrizeDeliveries(ctx, campaignId) {
      if (!can(ctx, 'bonuses.read') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para consultar las entregas.');
      }
      const client = getClient();
      const { data, error } = await client
        .from('bonus_prize_deliveries')
        .select('id, month, winning_number, delivery_date, responsible, notes')
        .eq('committee_id', ctx.committeeId)
        .eq('campaign_id', campaignId)
        .order('month', { ascending: true });

      if (error) return err('prize/list-failed', `No se pudo cargar el histórico: ${error.message}.`);
      const rows: PrizeDeliveryRow[] = (data ?? []).map((r) => ({
        id: (r as { id: UUID }).id,
        month: (r as { month: number }).month,
        winningNumber: (r as { winning_number: number }).winning_number,
        deliveryDate: String((r as { delivery_date: string }).delivery_date).slice(0, 10),
        responsible: (r as { responsible: string | null }).responsible ?? null,
        notes: (r as { notes: string | null }).notes ?? null,
      }));
      return ok(rows);
    },
  };
}
