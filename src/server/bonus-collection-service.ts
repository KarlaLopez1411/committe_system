import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Money, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';
import { isValid, greaterThan, ZERO, add } from '@/domain/money';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { can } from '@/server/authz';

export const DUE_STATUSES = ['pendiente', 'cobrado_vendedor', 'entregado_tesoreria', 'confirmado'] as const;

export interface SellerStatus {
  sellerId: UUID;
  assignedCount: number;
  expectedAmount: Money;
  collectedAmount: Money;
  deliveredAmount: Money;
  pendingCollect: Money;
  pendingDeliver: Money;
}

export interface BonusCollectionServiceDeps { client?: SupabaseClient; }

export interface BonusCollectionService {
  assignSellers(ctx: Ctx, campaignId: UUID, sellerId: UUID, bonusNumberIds: UUID[]): Promise<Result<void>>;
  sellerStatus(ctx: Ctx, campaignId: UUID, sellerId: UUID): Promise<Result<SellerStatus>>;
  generateMonthlyDues(ctx: Ctx, campaignId: UUID, period: string): Promise<Result<{ count: number }>>;
  recordCollection(ctx: Ctx, dueId: UUID, amount: string, sellerId: UUID): Promise<Result<{ collectionId: UUID }>>;
}

export function createBonusCollectionService(deps: BonusCollectionServiceDeps = {}): BonusCollectionService {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  return {
    async assignSellers(ctx, _campaignId, sellerId, bonusNumberIds) {
      if (!can(ctx, 'committee.manage') && !can(ctx, 'bonuses.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para asignar vendedores.');
      }

      // R27.3: limit 1–500
      if (!bonusNumberIds.length || bonusNumberIds.length > 500) {
        return err('assignment/invalid-count', 'La asignación debe incluir entre 1 y 500 números.', 'bonusNumberIds');
      }

      const today = new Date().toISOString();
      const client = getClient();

      // R27.4: close active assignments for these numbers
      for (const numId of bonusNumberIds) {
        await client.from('bonus_seller_assignments')
          .update({ valid_to: today })
          .eq('bonus_number_id', numId)
          .is('valid_to', null);
      }

      const rows = bonusNumberIds.map((id) => ({
        committee_id: ctx.committeeId,
        bonus_number_id: id,
        seller_id: sellerId,
        valid_from: today,
        valid_to: null,
      }));

      const { error } = await client.from('bonus_seller_assignments').insert(rows);
      if (error) return err('assignment/failed', `No se pudieron asignar los números: ${error.message}.`);

      return ok(undefined);
    },

    async sellerStatus(ctx, campaignId, sellerId) {
      if (!can(ctx, 'transactions.read') && !can(ctx, 'bonuses.read')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para consultar el estado del vendedor.');
      }

      const client = getClient();

      // Count assigned active numbers
      const { count: assignedCount } = await client
        .from('bonus_seller_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', sellerId)
        .eq('committee_id', ctx.committeeId)
        .is('valid_to', null);

      // Get campaign monthly amount for expected
      const { data: camp } = await client.from('bonus_campaigns').select('monthly_amount').eq('id', campaignId).eq('committee_id', ctx.committeeId).single();
      const monthlyAmount = camp ? String((camp as { monthly_amount: string | number }).monthly_amount) : '0.00';

      // Get collections for this seller in this campaign
      const { data: cols } = await client
        .from('bonus_collections')
        .select('amount, settlement_id')
        .eq('seller_id', sellerId)
        .eq('committee_id', ctx.committeeId);

      let collected: Money = ZERO;
      let delivered: Money = ZERO;

      for (const c of (cols ?? []) as { amount: string | number; settlement_id: UUID | null }[]) {
        const a = String(c.amount);
        collected = add(collected, a);
        if (c.settlement_id) delivered = add(delivered, a);
      }

      const expected = add(ZERO, String(Number(monthlyAmount) * (assignedCount ?? 0)));
      const pendingCollect = add(expected, `-${collected}`);
      const pendingDeliver = add(collected, `-${delivered}`);

      return ok({
        sellerId,
        assignedCount: assignedCount ?? 0,
        expectedAmount: expected,
        collectedAmount: collected,
        deliveredAmount: delivered,
        pendingCollect,
        pendingDeliver,
      });
    },

    async generateMonthlyDues(ctx, campaignId, period) {
      if (!can(ctx, 'committee.manage') && !can(ctx, 'bonuses.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para generar mensualidades.');
      }

      const client = getClient();

      const { data: campaign } = await client.from('bonus_campaigns').select('monthly_amount').eq('id', campaignId).eq('committee_id', ctx.committeeId).single();
      if (!campaign) return err('campaign/not-found', 'La campaña indicada no existe.');

      const amount = String((campaign as { monthly_amount: string | number }).monthly_amount);

      // Get all active numbers for this campaign
      const { data: numbers } = await client.from('bonus_numbers').select('id').eq('campaign_id', campaignId).eq('status', 'activo').eq('committee_id', ctx.committeeId);
      if (!numbers?.length) return ok({ count: 0 });

      const rows = numbers.map((n: { id: UUID }) => ({
        committee_id: ctx.committeeId,
        campaign_id: campaignId,
        bonus_number_id: n.id,
        period,
        amount,
        status: 'pendiente',
      }));

      // R29.2: UNIQUE(bonus_number_id, period) prevents duplicates — use upsert ignoreDuplicates
      const { error } = await client.from('bonus_monthly_dues').upsert(rows, { onConflict: 'bonus_number_id,period', ignoreDuplicates: true });
      if (error) return err('dues/generate-failed', `No se pudieron generar las mensualidades: ${error.message}.`);

      return ok({ count: rows.length });
    },

    async recordCollection(ctx, dueId, amount, sellerId) {
      if (!can(ctx, 'bonuses.collect') && !can(ctx, 'bonuses.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para registrar cobros.');
      }

      // R30.3: amount > 0
      if (!isValid(amount) || !greaterThan(amount, '0.00')) {
        return err('collection/invalid-amount', 'El monto del cobro debe ser mayor a 0.', 'amount');
      }

      const client = getClient();

      const { data: due } = await client.from('bonus_monthly_dues').select('status, committee_id').eq('id', dueId).single();
      if (!due) return err('due/not-found', 'La mensualidad indicada no existe.');
      const dueRow = due as { status: string; committee_id: UUID };
      if (dueRow.committee_id !== ctx.committeeId) return err('AUTHZ_FORBIDDEN', 'La mensualidad no pertenece al comité activo.');

      const { data: col, error } = await client
        .from('bonus_collections')
        .insert({
          committee_id: ctx.committeeId,
          monthly_due_id: dueId,
          seller_id: sellerId,
          amount,
          created_by: ctx.userId,
        })
        .select('id')
        .single();

      if (error || !col) return err('collection/failed', `No se pudo registrar el cobro: ${error?.message ?? 'error desconocido'}.`);

      // Transition due to cobrado_vendedor
      await client.from('bonus_monthly_dues').update({ status: 'cobrado_vendedor' }).eq('id', dueId);

      return ok({ collectionId: (col as { id: UUID }).id });
    },
  };
}
