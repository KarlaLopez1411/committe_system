import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Money, Result } from '@/domain/types';
import { ok } from '@/domain/types';
import { add, subtract, ZERO } from '@/domain/money';

import { createSupabaseAdminClient } from '@/lib/supabase/server';

export interface AccountBalance { accountId: string; name: string; balance: Money; }

export interface DashboardIndicators {
  consolidatedBalance: Money;
  accountBalances: AccountBalance[];
  monthIncomeTotal: Money;
  monthExpenseTotal: Money;
  monthNetResult: Money;
  activeMembersCount: number;
  bonusCollectedAmount: Money;
  bonusDeliveredAmount: Money;
  bonusPendingDeliverAmount: Money;
}

export interface DashboardServiceDeps { client?: SupabaseClient; }

export function createDashboardService(deps: DashboardServiceDeps = {}) {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  return {
    async getIndicators(ctx: Ctx): Promise<Result<DashboardIndicators>> {
      const client = getClient();
      const cid = ctx.committeeId;

      // account balances via derived_balance view
      const { data: accounts } = await client
        .from('account_derived_balances')
        .select('account_id, name, derived_balance')
        .eq('committee_id', cid)
        .eq('status', 'active');

      const accountBalances: AccountBalance[] = (accounts ?? []).map((a: Record<string, unknown>) => ({
        accountId: a.account_id as string,
        name: a.name as string,
        balance: String(a.derived_balance ?? '0.00') as Money,
      }));
      const consolidatedBalance = accountBalances.reduce((sum, a) => add(sum, a.balance), ZERO);

      // current month bounds
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const monthEnd = new Date(nextMonth.getTime() - 1).toISOString().slice(0, 10);

      const getMonthTotal = async (type: 'income' | 'expense'): Promise<Money> => {
        const { data: txs } = await client
          .from('financial_transactions')
          .select('id')
          .eq('committee_id', cid)
          .eq('type', type)
          .eq('status', 'posted')
          .gte('transaction_date', monthStart)
          .lte('transaction_date', monthEnd);

        const ids = (txs ?? []).map((t: { id: string }) => t.id);
        if (!ids.length) return ZERO;

        const { data: entries } = await client
          .from('ledger_entries')
          .select('amount')
          .in('transaction_id', ids)
          .eq('committee_id', cid);

        let total = ZERO;
        for (const e of (entries ?? []) as { amount: string | number }[]) {
          const a = String(e.amount);
          total = add(total, a.startsWith('-') ? a.slice(1) : a);
        }
        return total;
      };

      const [monthIncomeTotal, monthExpenseTotal] = await Promise.all([
        getMonthTotal('income'),
        getMonthTotal('expense'),
      ]);
      const monthNetResult = subtract(monthIncomeTotal, monthExpenseTotal);

      const { count: activeMembersCount } = await client
        .from('members')
        .select('id', { count: 'exact', head: true })
        .eq('committee_id', cid)
        .eq('status', 'activo');

      // bonus: aggregate collections for current committee
      const { data: colRows } = await client
        .from('bonus_collections')
        .select('amount, settlement_id')
        .eq('committee_id', cid);

      let bonusCollectedAmount = ZERO;
      let bonusDeliveredAmount = ZERO;
      for (const c of (colRows ?? []) as { amount: string | number; settlement_id: string | null }[]) {
        bonusCollectedAmount = add(bonusCollectedAmount, String(c.amount));
        if (c.settlement_id) bonusDeliveredAmount = add(bonusDeliveredAmount, String(c.amount));
      }
      const bonusPendingDeliverAmount = subtract(bonusCollectedAmount, bonusDeliveredAmount);

      return ok({
        consolidatedBalance,
        accountBalances,
        monthIncomeTotal,
        monthExpenseTotal,
        monthNetResult,
        activeMembersCount: activeMembersCount ?? 0,
        bonusCollectedAmount,
        bonusDeliveredAmount,
        bonusPendingDeliverAmount,
      });
    },
  };
}
