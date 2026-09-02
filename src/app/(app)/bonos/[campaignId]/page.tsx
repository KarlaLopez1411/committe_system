import Link from 'next/link';
import { notFound } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolvePagePerms } from '@/server/actions/page-perms';
import {
  bonusMonthlyCutAction,
  getCampaignLedgerAction,
  listPrizeDeliveriesAction,
  listSellersAction,
  listSellersWithAssignmentsAction,
  listUnassignedNumbersAction,
} from '@/server/actions/bonus-actions';

import type { UUID } from '@/domain/types';

import { SellerManager } from './seller-manager';
import { CampaignNumbersTable } from './campaign-numbers-table';
import { GenerateNumbersButton } from './generate-numbers-button';
import { MonthlyPaidReport } from './monthly-paid-report';
import { PrizeDeliveries } from './prize-deliveries';
import { CampaignTabs } from './campaign-tabs';

export const dynamic = 'force-dynamic';

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;

  const supabase = await createSupabaseServerClient();
  const perms = await resolvePagePerms();
  const { data: campaign } = await supabase
    .from('bonus_campaigns')
    .select('id, name, year, monthly_amount, monthly_prize, status')
    .eq('id', campaignId)
    .maybeSingle();

  if (!campaign) {
    notFound();
  }

  const c = campaign as {
    id: string; name: string; year: number;
    monthly_amount: string | number; monthly_prize: string | number; status: string;
  };

  const [numbersResult, sellersResult, sellersWithResult, unassignedResult, monthlyCutResult, deliveriesResult] = await Promise.all([
    getCampaignLedgerAction(campaignId),
    listSellersAction(),
    listSellersWithAssignmentsAction(campaignId),
    listUnassignedNumbersAction(campaignId),
    bonusMonthlyCutAction(campaignId),
    listPrizeDeliveriesAction(campaignId),
  ]);

  const numbers = numbersResult.ok ? numbersResult.value : [];
  const sellers = sellersResult.ok ? sellersResult.value : [];
  const sellersWithAssignments = sellersWithResult.ok ? sellersWithResult.value : [];
  const unassignedNumbers = unassignedResult.ok ? unassignedResult.value : [];
  const monthlyCut = monthlyCutResult.ok ? monthlyCutResult.value : [];
  const prizeDeliveries = deliveriesResult.ok ? deliveriesResult.value : [];

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/bonos" className="text-sm font-medium text-brand hover:underline">← Campañas</Link>
        <h1 className="text-xl font-bold">{c.name} ({c.year})</h1>
        <p className="text-sm text-gray-500">
          Aportación mensual ${c.monthly_amount} · Premio mensual ${c.monthly_prize} · Estado: {c.status}
        </p>
      </div>

      {!numbersResult.ok ? (
        <p role="alert" className="text-sm text-red-600">
          No se pudieron cargar los números: {numbersResult.error.message}
        </p>
      ) : null}

      {numbersResult.ok && numbers.length === 0 ? (
        // Campaña sin números (creada antes de la generación automática).
        perms.canManageCommittee ? (
          <GenerateNumbersButton campaignId={c.id as UUID} />
        ) : (
          <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Esta campaña aún no tiene números.
          </p>
        )
      ) : (
        <CampaignTabs
          tabs={[
            {
              id: 'responsables',
              label: 'Responsables',
              content: (
                <SellerManager
                  campaignId={c.id as UUID}
                  sellers={sellersWithAssignments}
                  unassignedNumbers={unassignedNumbers}
                  canManage={perms.canManageBonuses}
                />
              ),
            },
            {
              id: 'numeros',
              label: 'Números',
              content: (
                <CampaignNumbersTable
                  rows={numbers}
                  sellers={sellers}
                  canEditBeneficiary={perms.canManageBonuses}
                  canTogglePaid={perms.canCollectBonuses}
                />
              ),
            },
            {
              id: 'corte',
              label: 'Corte por mes',
              content: <MonthlyPaidReport rows={monthlyCut} />,
            },
            {
              id: 'entregas',
              label: 'Entregas',
              content: (
                <PrizeDeliveries
                  campaignId={c.id as UUID}
                  deliveries={prizeDeliveries}
                  canManage={perms.canDrawBonuses}
                />
              ),
            },
          ]}
        />
      )}
    </section>
  );
}
