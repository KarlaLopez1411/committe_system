import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Money, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';
import { isValid, greaterThan, add, ZERO } from '@/domain/money';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { periodFirstOfMonth } from '@/lib/date';
import { can } from '@/server/authz';
import { createFinanceService } from '@/server/finance-service';

/** Categoría usada para el ingreso de aportaciones. */
const CONTRIBUTION_CATEGORY_NAME = 'Aportaciones';

export const CONTRIBUTION_STATUSES = ['registrada', 'sin_aportacion', 'exento', 'no_aplica'] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export interface ContributionInput {
  memberId: UUID;
  /** First day of the period, YYYY-MM-DD. */
  period: string;
  contributedAt: string;
  /** Positive Money string; required when status is 'registrada'. */
  amount?: string | null;
  method?: string | null;
  accountId?: UUID | null;
  status: ContributionStatus;
}

export interface ContributionServiceDeps { client?: SupabaseClient; }

/** Datos para registrar aportaciones de varios miembros a la vez. */
export interface ContributionBatchInput {
  /** Miembros a los que se registra la aportación del periodo. */
  memberIds: UUID[];
  /** Primer día del mes 'YYYY-MM-DD'. */
  period: string;
  /** Fecha de la aportación 'YYYY-MM-DD'. */
  contributedAt: string;
  /** Monto por miembro (por defecto $100). */
  amountPerMember?: string | null;
  method?: string | null;
}

export interface ContributionService {
  register(ctx: Ctx, data: ContributionInput): Promise<Result<{ contributionId: UUID }>>;
  /** Registra la aportación de varios miembros y genera UN ingreso a caja por el total. */
  registerBatch(ctx: Ctx, data: ContributionBatchInput): Promise<Result<{ count: number; total: string; transactionId: UUID | null }>>;
  /** Links exactly one posted income transaction — rejects double link (R17.4, R17.5). */
  confirmMonetary(ctx: Ctx, contributionId: UUID, transactionId: UUID): Promise<Result<void>>;
}

const PG_UNIQUE = '23505';

export function createContributionService(deps: ContributionServiceDeps = {}): ContributionService {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  return {
    async register(ctx, data) {
      if (!can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para registrar aportaciones.');
      }

      if (!CONTRIBUTION_STATUSES.includes(data?.status)) {
        return err('contribution/invalid-status', 'El estado de la aportación no es válido.', 'status');
      }
      if (!data?.memberId?.trim()) {
        return err('contribution/missing-member', 'El miembro es obligatorio.', 'memberId');
      }
      if (!data?.period?.trim() || !data?.contributedAt?.trim()) {
        return err('contribution/missing-date', 'El periodo y la fecha son obligatorios.');
      }

      // R17.2: amount > 0 when present
      if (data.amount != null) {
        if (!isValid(data.amount) || !greaterThan(data.amount, '0.00')) {
          return err('contribution/invalid-amount', 'El monto de la aportación debe ser mayor a 0.', 'amount');
        }
      }

      const client = getClient();
      const { data: row, error } = await client
        .from('contributions')
        .insert({
          committee_id: ctx.committeeId,
          member_id: data.memberId,
          period: periodFirstOfMonth(data.period), // siempre primer día del mes
          contributed_at: data.contributedAt,
          amount: data.amount ?? null,
          method: data.method ?? null,
          account_id: data.accountId ?? null,
          status: data.status,
        })
        .select('id')
        .single();

      if (error || !row) {
        return err('contribution/create-failed', `No se pudo registrar la aportación: ${error?.message ?? 'error desconocido'}.`);
      }

      return ok({ contributionId: (row as { id: UUID }).id });
    },

    async registerBatch(ctx, data) {
      if (!can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para registrar aportaciones.');
      }
      const memberIds = (data?.memberIds ?? []).filter(Boolean);
      if (memberIds.length === 0) {
        return err('contribution/no-members', 'Selecciona al menos un miembro.', 'memberIds');
      }
      if (!data?.period?.trim() || !data?.contributedAt?.trim()) {
        return err('contribution/missing-date', 'El periodo y la fecha son obligatorios.');
      }

      // Monto por miembro (por defecto $100).
      const amount = data.amountPerMember != null && String(data.amountPerMember) !== '' ? String(data.amountPerMember) : '100.00';
      if (!isValid(amount) || !greaterThan(amount, '0.00')) {
        return err('contribution/invalid-amount', 'El monto de la aportación debe ser mayor a 0.', 'amountPerMember');
      }

      const client = getClient();

      // Una fila de aportación 'registrada' por miembro.
      const normalizedPeriod = periodFirstOfMonth(data.period); // siempre primer día del mes
      const rows = memberIds.map((memberId) => ({
        committee_id: ctx.committeeId,
        member_id: memberId,
        period: normalizedPeriod,
        contributed_at: data.contributedAt,
        amount,
        method: data.method ?? 'efectivo',
        status: 'registrada' as ContributionStatus,
      }));
      const { error: insErr } = await client.from('contributions').insert(rows);
      if (insErr) {
        return err('contribution/create-failed', `No se pudieron registrar las aportaciones: ${insErr.message}.`);
      }

      // Total = amount × cantidad de miembros (aritmética exacta).
      let total: Money = ZERO;
      for (let i = 0; i < memberIds.length; i++) total = add(total, amount);

      // Ingreso a la caja principal por el total.
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
        // Categoría "Aportaciones" (find-or-create).
        const { data: cat } = await client
          .from('transaction_categories')
          .select('id')
          .eq('committee_id', ctx.committeeId)
          .eq('name', CONTRIBUTION_CATEGORY_NAME)
          .maybeSingle();
        let categoryId: UUID | null = cat ? (cat as { id: UUID }).id : null;
        if (!categoryId) {
          const { data: created } = await client
            .from('transaction_categories')
            .insert({ committee_id: ctx.committeeId, name: CONTRIBUTION_CATEGORY_NAME })
            .select('id')
            .maybeSingle();
          categoryId = created ? (created as { id: UUID }).id : null;
        }

        const finance = createFinanceService({ client });
        const income = await finance.registerIncome(ctx, {
          accountId,
          categoryId,
          amount: total,
          date: data.contributedAt,
          description: `Aportaciones voluntarias (${memberIds.length} miembro${memberIds.length === 1 ? '' : 's'})`,
          sourceType: 'contribution',
          paymentMethod: data.method ?? 'efectivo',
        });
        if (!income.ok) {
          return err('contribution/income-failed', `Aportaciones registradas, pero no se pudo generar el ingreso: ${income.error.message}.`);
        }
        transactionId = income.value.transactionId;
      }

      return ok({ count: memberIds.length, total, transactionId });
    },

    async confirmMonetary(ctx, contributionId, transactionId) {
      if (!can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para confirmar aportaciones.');
      }

      const client = getClient();

      // Verify transaction is an income and belongs to this committee.
      const { data: tx, error: txErr } = await client
        .from('financial_transactions')
        .select('type, committee_id, status')
        .eq('id', transactionId)
        .single();

      if (txErr || !tx) return err('transaction/not-found', 'La transacción indicada no existe.');
      const txRow = tx as { type: string; committee_id: UUID; status: string };
      if (txRow.committee_id !== ctx.committeeId) {
        return err('AUTHZ_FORBIDDEN', 'La transacción no pertenece al comité activo.');
      }
      if (txRow.type !== 'income') {
        return err('contribution/wrong-type', 'Solo se puede vincular una transacción de tipo ingreso.');
      }

      const { error } = await client
        .from('contributions')
        .update({ financial_transaction_id: transactionId })
        .eq('id', contributionId)
        .eq('committee_id', ctx.committeeId);

      if (error) {
        if (error.code === PG_UNIQUE) {
          return err('contribution/duplicate-link', 'Esta transacción ya está vinculada a otra aportación.');
        }
        return err('contribution/confirm-failed', `No se pudo confirmar la aportación: ${error.message}.`);
      }

      return ok(undefined);
    },
  };
}
