import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { can } from '@/server/authz';

export interface DrawInput {
  campaignId: UUID;
  period: string;           // YYYY-MM-DD (first day)
  drawDate: string;         // YYYY-MM-DD
  winningBonusNumberId: UUID;
  evidencePath?: string | null;
  responsible?: string | null;
}

export interface BonusDrawServiceDeps { client?: SupabaseClient; }

export interface BonusDrawService {
  /** Registers a monthly draw result (R32.1, R32.2); requires 6 rules defined (R34.3). */
  registerDraw(ctx: Ctx, data: DrawInput): Promise<Result<{ drawId: UUID }>>;
  /** Pays prize atomically via RPC; prevents double payment (R33.1–33.4). */
  payPrize(ctx: Ctx, drawId: UUID, accountId: UUID, categoryId: UUID): Promise<Result<{ transactionId: UUID }>>;
}

const PG_UNIQUE = '23505';

export function createBonusDrawService(deps: BonusDrawServiceDeps = {}): BonusDrawService {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  return {
    async registerDraw(ctx, data) {
      if (!can(ctx, 'bonuses.draw') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para registrar sorteos.');
      }

      const client = getClient();

      // R34.3: verify rules are defined
      const { data: campaign } = await client
        .from('bonus_campaigns')
        .select('rules_defined, monthly_prize')
        .eq('id', data.campaignId)
        .eq('committee_id', ctx.committeeId)
        .single();

      if (!campaign) return err('campaign/not-found', 'La campaña indicada no existe.');
      const c = campaign as { rules_defined: boolean; monthly_prize: string | number };
      if (!c.rules_defined) {
        return err('draw/rules-missing', 'Debe definir las 6 reglas de elegibilidad antes de registrar un sorteo.');
      }

      // Get current holder snapshot
      const { data: holder } = await client
        .from('bonus_holder_assignments')
        .select('beneficiary_name')
        .eq('bonus_number_id', data.winningBonusNumberId)
        .is('valid_to', null)
        .single();

      const beneficiarySnapshot = holder
        ? (holder as { beneficiary_name: string }).beneficiary_name
        : 'Sin titular vigente';

      const { data: draw, error } = await client
        .from('bonus_draws')
        .insert({
          committee_id: ctx.committeeId,
          campaign_id: data.campaignId,
          period: data.period,
          draw_date: data.drawDate,
          winning_bonus_number_id: data.winningBonusNumberId,
          beneficiary_snapshot: beneficiarySnapshot,
          prize_amount: c.monthly_prize,
          evidence_path: data.evidencePath ?? null,
          responsible: data.responsible ?? null,
          status: 'registrado',
        })
        .select('id')
        .single();

      if (error || !draw) {
        if (error?.code === PG_UNIQUE) return err('draw/duplicate', 'Ya existe un sorteo para esta campaña y periodo.');
        return err('draw/create-failed', `No se pudo registrar el sorteo: ${error?.message ?? 'error desconocido'}.`);
      }

      return ok({ drawId: (draw as { id: UUID }).id });
    },

    async payPrize(ctx, drawId, accountId, categoryId) {
      if (!can(ctx, 'bonuses.draw') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para pagar premios.');
      }

      const client = getClient();
      const { data: txId, error } = await client.rpc('rpc_pay_prize', {
        p_committee_id: ctx.committeeId,
        p_actor: ctx.userId,
        p_draw_id: drawId,
        p_account_id: accountId,
        p_category_id: categoryId,
      });

      if (error) {
        const msg = error.message ?? '';
        if (msg.includes('no encontrado')) return err('draw/not-found', 'El sorteo indicado no existe.');
        if (msg.includes('anulado')) return err('draw/voided', 'El sorteo está anulado.');
        if (msg.includes('unique') || msg.includes('already')) return err('draw/already-paid', 'El premio ya fue pagado para este sorteo.');
        return err('prize/pay-failed', `No se pudo pagar el premio: ${msg}.`);
      }

      return ok({ transactionId: txId as UUID });
    },
  };
}
