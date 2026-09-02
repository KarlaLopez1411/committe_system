import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';

import { createSupabaseAdminClient } from '@/lib/supabase/server';

export interface SellerAssignment {
  bonusNumberId: UUID;
  number: number;
  dueId: UUID | null;
  dueStatus: string | null;
  dueAmount: string | null;
}

export interface SellerPortalServiceDeps { client?: SupabaseClient; }

export interface SellerRecord {
  id: UUID;
  displayName: string;
  userId: UUID | null;
}

export interface SellerPortalService {
  /** Resolves the seller record for the current user in this committee (R39.1). */
  findSeller(ctx: Ctx): Promise<Result<SellerRecord>>;
  /** Returns only numbers assigned to this seller in the active committee (R39.1, R39.7). */
  getAssignments(ctx: Ctx, sellerId: UUID, period: string): Promise<Result<SellerAssignment[]>>;
}

export function createSellerPortalService(deps: SellerPortalServiceDeps = {}): SellerPortalService {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  return {
    async findSeller(ctx) {
      const client = getClient();
      const { data, error } = await client
        .from('bonus_sellers')
        .select('id, display_name, user_id')
        .eq('user_id', ctx.userId)
        .eq('committee_id', ctx.committeeId)
        .single();
      if (error || !data) return err('portal/seller-not-found', 'No tienes un perfil de vendedor en este comité.');
      const row = data as { id: UUID; display_name: string; user_id: UUID };
      return ok({ id: row.id, displayName: row.display_name, userId: row.user_id });
    },

    async getAssignments(ctx, sellerId, period) {
      const client = getClient();

      // R39.1, R39.7: only numbers assigned to this seller in this committee
      const { data: assignments, error } = await client
        .from('bonus_seller_assignments')
        .select('bonus_number_id, bonus_numbers!inner(number)')
        .eq('seller_id', sellerId)
        .eq('committee_id', ctx.committeeId)
        .is('valid_to', null);

      if (error) return err('portal/query-failed', `No se pudieron obtener las asignaciones: ${error.message}.`);
      if (!assignments?.length) return ok([]);

      const rawAssignments = assignments as unknown as { bonus_number_id: UUID; bonus_numbers: { number: number } }[];
      const numberIds = rawAssignments.map((a) => a.bonus_number_id);

      // Get dues for this period for these numbers
      const { data: dues } = await client
        .from('bonus_monthly_dues')
        .select('id, bonus_number_id, status, amount')
        .in('bonus_number_id', numberIds)
        .eq('period', period)
        .eq('committee_id', ctx.committeeId);

      const dueMap = new Map<UUID, { id: UUID; status: string; amount: string }>();
      for (const d of (dues ?? []) as { id: UUID; bonus_number_id: UUID; status: string; amount: string }[]) {
        dueMap.set(d.bonus_number_id, { id: d.id, status: d.status, amount: d.amount });
      }

      const result: SellerAssignment[] = rawAssignments.map((a) => {
        const due = dueMap.get(a.bonus_number_id);
        return {
          bonusNumberId: a.bonus_number_id,
          number: a.bonus_numbers.number,
          dueId: due?.id ?? null,
          dueStatus: due?.status ?? null,
          dueAmount: due?.amount ?? null,
        };
      });

      return ok(result);
    },
  };
}
