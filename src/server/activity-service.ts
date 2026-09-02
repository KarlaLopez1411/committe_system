import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Money, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';
import { add, ZERO } from '@/domain/money';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { can } from '@/server/authz';

export const ACTIVITY_STATUSES = ['planeada', 'activa', 'finalizada', 'cerrada'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export interface ActivityInput {
  name: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD; must be >= startDate (R19.2). */
  endDate: string;
  objective?: string | null;
  responsible?: string | null;
  description?: string | null;
  status?: ActivityStatus;
}

export interface ActivityResult {
  incomeTotal: Money;
  expenseTotal: Money;
  /** incomeTotal − expenseTotal */
  netResult: Money;
}

export interface ActivityServiceDeps { client?: SupabaseClient; }

export interface ActivityService {
  create(ctx: Ctx, data: ActivityInput): Promise<Result<{ activityId: UUID }>>;
  updateStatus(ctx: Ctx, activityId: UUID, status: ActivityStatus): Promise<Result<void>>;
  associateTransaction(ctx: Ctx, activityId: UUID, transactionId: UUID): Promise<Result<void>>;
  computeResult(ctx: Ctx, activityId: UUID): Promise<Result<ActivityResult>>;
  /** Transitions from 'finalizada' → 'cerrada'; blocks double closure (R21.4, R21.5). */
  closeCut(ctx: Ctx, activityId: UUID): Promise<Result<{ summary: ActivityResult }>>;
}

export function createActivityService(deps: ActivityServiceDeps = {}): ActivityService {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  async function getResult(client: SupabaseClient, activityId: UUID, committeeId: UUID): Promise<ActivityResult> {
    const { data } = await client
      .from('financial_transactions')
      .select('type, ledger_entries(amount)')
      .eq('activity_id', activityId)
      .eq('committee_id', committeeId)
      .eq('status', 'posted')
      .in('type', ['income', 'expense']);

    let income: Money = ZERO;
    let expense: Money = ZERO;

    for (const tx of (data ?? []) as unknown[]) {
      const row = tx as { type: string; ledger_entries: { amount: string | number }[] };
      const entryAmounts = (row.ledger_entries ?? []).map((e) => String(e.amount));
      for (const a of entryAmounts) {
        if (row.type === 'income') income = add(income, a);
        else if (row.type === 'expense') expense = add(expense, a.startsWith('-') ? a.slice(1) : a);
      }
    }

    return { incomeTotal: income, expenseTotal: expense, netResult: add(income, `-${expense}`) };
  }

  return {
    async create(ctx, data) {
      if (!can(ctx, 'committee.manage') && !can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para crear actividades.');
      }

      if (!data?.name?.trim()) {
        return err('activity/missing-name', 'El nombre de la actividad es obligatorio.', 'name');
      }
      if (!data?.startDate || !data?.endDate) {
        return err('activity/missing-dates', 'Las fechas de inicio y fin son obligatorias.');
      }
      // R19.2: end_date >= start_date
      if (data.endDate < data.startDate) {
        return err('activity/invalid-dates', 'La fecha de fin debe ser igual o posterior a la fecha de inicio.', 'endDate');
      }

      const client = getClient();
      const { data: row, error } = await client
        .from('activities')
        .insert({
          committee_id: ctx.committeeId,
          name: data.name.trim(),
          start_date: data.startDate,
          end_date: data.endDate,
          objective: data.objective ?? null,
          responsible: data.responsible ?? null,
          description: data.description ?? null,
          status: data.status ?? 'planeada',
        })
        .select('id')
        .single();

      if (error || !row) {
        return err('activity/create-failed', `No se pudo crear la actividad: ${error?.message ?? 'error desconocido'}.`);
      }

      return ok({ activityId: (row as { id: UUID }).id });
    },

    async updateStatus(ctx, activityId, status) {
      if (!can(ctx, 'committee.manage') && !can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para actualizar actividades.');
      }
      if (!ACTIVITY_STATUSES.includes(status)) {
        return err('activity/invalid-status', 'Estado de actividad no válido.', 'status');
      }

      const client = getClient();
      const { error } = await client
        .from('activities')
        .update({ status })
        .eq('id', activityId)
        .eq('committee_id', ctx.committeeId);

      if (error) return err('activity/update-failed', `No se pudo actualizar la actividad: ${error.message}.`);
      return ok(undefined);
    },

    async associateTransaction(ctx, activityId, transactionId) {
      if (!can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para asociar movimientos.');
      }

      const client = getClient();

      // R20.2: activity must not be 'cerrada'
      const { data: act } = await client.from('activities').select('status').eq('id', activityId).eq('committee_id', ctx.committeeId).single();
      if (!act) return err('activity/not-found', 'La actividad indicada no existe.');
      if ((act as { status: string }).status === 'cerrada') {
        return err('activity/closed', 'No se pueden asociar movimientos a una actividad cerrada.');
      }

      const { error } = await client
        .from('financial_transactions')
        .update({ activity_id: activityId })
        .eq('id', transactionId)
        .eq('committee_id', ctx.committeeId);

      if (error) return err('activity/associate-failed', `No se pudo asociar el movimiento: ${error.message}.`);
      return ok(undefined);
    },

    async computeResult(ctx, activityId) {
      if (!can(ctx, 'transactions.read')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para consultar el resultado.');
      }
      const client = getClient();
      return ok(await getResult(client, activityId, ctx.committeeId));
    },

    async closeCut(ctx, activityId) {
      if (!can(ctx, 'committee.manage') && !can(ctx, 'transactions.approve')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para cerrar actividades.');
      }

      const client = getClient();

      const { data: act } = await client.from('activities').select('status').eq('id', activityId).eq('committee_id', ctx.committeeId).single();
      if (!act) return err('activity/not-found', 'La actividad indicada no existe.');

      const currentStatus = (act as { status: string }).status;
      // R21.1: only from 'finalizada'
      if (currentStatus !== 'finalizada') {
        return err('activity/invalid-status', `Solo se puede cerrar una actividad en estado "finalizada" (estado actual: ${currentStatus}).`);
      }

      const summary = await getResult(client, activityId, ctx.committeeId);

      const { error } = await client
        .from('activities')
        .update({ status: 'cerrada' })
        .eq('id', activityId)
        .eq('committee_id', ctx.committeeId);

      if (error) return err('activity/close-failed', `No se pudo cerrar la actividad: ${error.message}.`);

      return ok({ summary });
    },
  };
}
