import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';
import { isValid, greaterThan, lessThanOrEqual } from '@/domain/money';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { can } from '@/server/authz';

export interface SettlementReportInput {
  campaignId: UUID;
  sellerId: UUID;
  collectionIds: UUID[];
  reference?: string | null;
}

export interface BonusSettlementServiceDeps { client?: SupabaseClient; }

export interface BonusSettlementService {
  /** Seller reports a batch of collections (R31.1, R31.2). */
  report(ctx: Ctx, data: SettlementReportInput): Promise<Result<{ settlementId: UUID }>>;
  /** Treasury confirms atomically via RPC — reporter ≠ confirmer (R31.3–31.6, R41.2). */
  confirmSettlement(ctx: Ctx, settlementId: UUID, accountId: UUID, categoryId: UUID): Promise<Result<{ transactionId: UUID }>>;
}

export function createBonusSettlementService(deps: BonusSettlementServiceDeps = {}): BonusSettlementService {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  return {
    async report(ctx, data) {
      if (!can(ctx, 'bonuses.collect') && !can(ctx, 'bonuses.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para reportar entregas.');
      }

      if (!data?.collectionIds?.length) {
        return err('settlement/empty-collections', 'Debe incluir al menos un cobro en la entrega.');
      }

      const client = getClient();

      // Compute total from collections
      const { data: cols } = await client
        .from('bonus_collections')
        .select('amount')
        .in('id', data.collectionIds)
        .eq('committee_id', ctx.committeeId);

      if (!cols?.length) return err('settlement/collections-not-found', 'No se encontraron los cobros indicados.');

      let total = 0;
      for (const c of cols as { amount: string | number }[]) total += parseFloat(String(c.amount));

      const totalStr = total.toFixed(2);
      if (!isValid(totalStr) || !greaterThan(totalStr, '0.00') || !lessThanOrEqual(totalStr, '999999999.99')) {
        return err('settlement/invalid-amount', 'El monto total de la entrega no es válido.');
      }

      const { data: settlement, error } = await client
        .from('bonus_settlements')
        .insert({
          committee_id: ctx.committeeId,
          campaign_id: data.campaignId,
          seller_id: data.sellerId,
          reported_by: ctx.userId,
          reported_amount: totalStr,
          reference: data.reference ?? null,
          status: 'reportada',
        })
        .select('id')
        .single();

      if (error || !settlement) {
        return err('settlement/create-failed', `No se pudo crear la entrega: ${error?.message ?? 'error desconocido'}.`);
      }

      const settlementId = (settlement as { id: UUID }).id;

      // Link collections to settlement
      const items = data.collectionIds.map((id) => ({ settlement_id: settlementId, collection_id: id, committee_id: ctx.committeeId }));
      await client.from('bonus_settlement_items').insert(items);

      return ok({ settlementId });
    },

    async confirmSettlement(ctx, settlementId, accountId, categoryId) {
      // R31.3: requires bonuses.settle permission
      if (!can(ctx, 'bonuses.settle') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para confirmar entregas.');
      }

      const client = getClient();
      const { data: txId, error } = await client.rpc('rpc_confirm_settlement', {
        p_committee_id: ctx.committeeId,
        p_actor: ctx.userId,
        p_settlement_id: settlementId,
        p_account_id: accountId,
        p_category_id: categoryId,
      });

      if (error) {
        const msg = error.message ?? '';
        if (msg.includes('no puede confirmar su propia')) return err('settlement/self-confirm', 'El vendedor no puede confirmar su propia entrega.');
        if (msg.includes('no encontrada')) return err('settlement/not-found', 'La entrega indicada no existe.');
        if (msg.includes('estado actual')) return err('settlement/invalid-status', 'La entrega debe estar en estado reportada.');
        return err('settlement/confirm-failed', `No se pudo confirmar la entrega: ${msg}.`);
      }

      return ok({ transactionId: txId as UUID });
    },
  };
}
