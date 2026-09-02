import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Money, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';
import { isValid, greaterThanOrEqual, lessThanOrEqual, parse, add, subtract } from '@/domain/money';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { can } from '@/server/authz';

export const CASH_CLOSING_STATUSES = ['abierto', 'en_revision', 'aprobado', 'cerrado'] as const;
export type CashClosingStatus = (typeof CASH_CLOSING_STATUSES)[number];

export const REAL_BALANCE_MAX = '999999999.99';

export interface CashClosingServiceDeps { client?: SupabaseClient; }

export interface CashClosingService {
  /** Opens a monthly closing; computes theoretical balance = derived balance for the period. */
  open(ctx: Ctx, accountId: UUID, period: string): Promise<Result<{ closingId: UUID }>>;
  /** Captures the real physical balance (R22.5). */
  captureReal(ctx: Ctx, closingId: UUID, realBalance: string): Promise<Result<void>>;
  review(ctx: Ctx, closingId: UUID): Promise<Result<void>>;
  approve(ctx: Ctx, closingId: UUID): Promise<Result<void>>;
  /** Atomically transitions aprobado→cerrado via RPC (R23.2, R23.3). */
  close(ctx: Ctx, closingId: UUID): Promise<Result<void>>;
}

const PG_UNIQUE = '23505';

export function createCashClosingService(deps: CashClosingServiceDeps = {}): CashClosingService {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  async function transitionStatus(client: SupabaseClient, closingId: UUID, committeeId: UUID, fromStatus: CashClosingStatus, toStatus: CashClosingStatus): Promise<Result<void>> {
    const { data: row } = await client.from('cash_closings').select('status').eq('id', closingId).eq('committee_id', committeeId).single();
    if (!row) return err('cash_closing/not-found', 'El corte indicado no existe.');
    if ((row as { status: string }).status !== fromStatus) {
      return err('cash_closing/invalid-status', `El corte debe estar en estado "${fromStatus}" para esta operación.`);
    }
    const { error } = await client.from('cash_closings').update({ status: toStatus }).eq('id', closingId).eq('committee_id', committeeId);
    if (error) return err('cash_closing/update-failed', `No se pudo actualizar el corte: ${error.message}.`);
    return ok(undefined);
  }

  return {
    async open(ctx, accountId, period) {
      if (!can(ctx, 'cash_closings.create') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para abrir cortes de caja.');
      }
      if (!accountId?.trim() || !period?.trim()) {
        return err('cash_closing/missing-params', 'La cuenta y el periodo son obligatorios.');
      }

      const client = getClient();

      // Compute theoretical balance = opening_balance + SUM(ledger entries for this period)
      const { data: account } = await client.from('financial_accounts').select('opening_balance').eq('id', accountId).eq('committee_id', ctx.committeeId).single();
      if (!account) return err('cash_closing/account-not-found', 'La cuenta indicada no existe.');

      const opening = String((account as { opening_balance: string | number }).opening_balance);

      // Period entries: use ledger_entries joined with financial_transactions where date is within period month
      const periodStart = period; // YYYY-MM-DD (first day of month)
      const periodDate = new Date(period);
      const periodEnd = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 0).toISOString().slice(0, 10);

      const { data: entries } = await client
        .from('ledger_entries')
        .select('amount, financial_transactions!inner(transaction_date, status)')
        .eq('account_id', accountId)
        .eq('committee_id', ctx.committeeId)
        .gte('financial_transactions.transaction_date', periodStart)
        .lte('financial_transactions.transaction_date', periodEnd)
        .eq('financial_transactions.status', 'posted');

      let theoretical: Money = parse(opening);
      for (const e of (entries ?? []) as unknown[]) {
        const row = e as { amount: string | number };
        theoretical = add(theoretical, String(row.amount));
      }

      const { data: created, error } = await client
        .from('cash_closings')
        .insert({
          committee_id: ctx.committeeId,
          account_id: accountId,
          period: periodStart,
          opening_balance: opening,
          theoretical_balance: theoretical,
          status: 'abierto',
        })
        .select('id')
        .single();

      if (error || !created) {
        if (error?.code === PG_UNIQUE) {
          return err('cash_closing/duplicate', 'Ya existe un corte para esta cuenta y periodo.');
        }
        return err('cash_closing/create-failed', `No se pudo abrir el corte: ${error?.message ?? 'error desconocido'}.`);
      }

      return ok({ closingId: (created as { id: UUID }).id });
    },

    async captureReal(ctx, closingId, realBalance) {
      if (!can(ctx, 'cash_closings.capture') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para capturar el saldo real.');
      }

      if (!isValid(realBalance) || !greaterThanOrEqual(realBalance, '0.00') || !lessThanOrEqual(realBalance, REAL_BALANCE_MAX)) {
        return err('cash_closing/invalid-balance', `El saldo real debe estar entre 0.00 y ${REAL_BALANCE_MAX}.`, 'realBalance');
      }

      const client = getClient();
      const { data: row } = await client.from('cash_closings').select('theoretical_balance, status').eq('id', closingId).eq('committee_id', ctx.committeeId).single();
      if (!row) return err('cash_closing/not-found', 'El corte indicado no existe.');

      const r = row as { theoretical_balance: string | number; status: string };
      const parsedReal = parse(realBalance);
      const difference = subtract(parsedReal, String(r.theoretical_balance));

      const { error } = await client.from('cash_closings').update({ real_balance: parsedReal, difference }).eq('id', closingId).eq('committee_id', ctx.committeeId);
      if (error) return err('cash_closing/update-failed', `No se pudo capturar el saldo real: ${error.message}.`);
      return ok(undefined);
    },

    async review(ctx, closingId) {
      if (!can(ctx, 'cash_closings.review') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para revisar cortes.');
      }
      return transitionStatus(getClient(), closingId, ctx.committeeId, 'abierto', 'en_revision');
    },

    async approve(ctx, closingId) {
      if (!can(ctx, 'cash_closings.approve') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para aprobar cortes.');
      }
      return transitionStatus(getClient(), closingId, ctx.committeeId, 'en_revision', 'aprobado');
    },

    async close(ctx, closingId) {
      // R23.2: requires cash_closings.close permission
      if (!can(ctx, 'cash_closings.close') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para cerrar cortes.');
      }

      const client = getClient();
      const { error } = await client.rpc('rpc_close_cash_closing', {
        p_committee_id: ctx.committeeId,
        p_actor: ctx.userId,
        p_closing_id: closingId,
      });

      if (error) {
        const msg = error.message ?? '';
        if (msg.includes('no encontrado')) return err('cash_closing/not-found', 'El corte no existe.');
        if (msg.includes('estado actual')) return err('cash_closing/invalid-status', 'El corte debe estar en estado aprobado para cerrarse.');
        return err('cash_closing/close-failed', `No se pudo cerrar el corte: ${msg}.`);
      }

      return ok(undefined);
    },
  };
}
