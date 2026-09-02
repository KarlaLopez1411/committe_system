'use server';

import { revalidatePath } from 'next/cache';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err } from '@/domain/types';

import { resolveActionCtx } from '@/server/actions/resolve-ctx';
import {
  createBonusCampaignService,
  type CampaignInput,
  type EligibilityRules,
  type SellerInput,
  type SellerRow,
  type SellerWithAssignments,
  type UnassignedNumber,
} from '@/server/bonus-campaign-service';
import { createBonusCollectionService } from '@/server/bonus-collection-service';
import { createBonusSettlementService, type SettlementReportInput } from '@/server/bonus-settlement-service';
import { createBonusDrawService, type DrawInput } from '@/server/bonus-draw-service';
import {
  createBonusLedgerService,
  type LedgerRow,
  type MonthlyCutRow,
  type PrizeDeliveryInput,
  type PrizeDeliveryRow,
} from '@/server/bonus-ledger-service';

async function resolveCtx(): Promise<Ctx | null> {
  return resolveActionCtx();
}

function unauth<T>(): Result<T> { return err('auth/unauthenticated', 'No hay una sesión de comité activa.'); }

const BONUS_PATHS = ['/bonos'] as const;
function revalidateBonus() {
  for (const p of BONUS_PATHS) revalidatePath(p);
  // Revalida también las páginas de detalle por campaña.
  revalidatePath('/bonos/[campaignId]', 'page');
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

export async function createCampaignAction(data: CampaignInput): Promise<Result<{ campaignId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusCampaignService().createCampaign(ctx, data);
  if (result.ok) revalidateBonus();
  return result;
}

/** Da de alta un responsable (vendedor) del comité, con teléfono y números opcionales. */
export async function createSellerAction(data: SellerInput): Promise<Result<{ sellerId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusCampaignService().createSeller(ctx, data);
  if (result.ok) revalidateBonus();
  return result;
}

/** Edita el nombre y/o teléfono de un responsable. */
export async function updateSellerAction(sellerId: UUID, data: { displayName: string; phone?: string | null }): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusCampaignService().updateSeller(ctx, sellerId, data);
  if (result.ok) revalidateBonus();
  return result;
}

/** Reconcilia los números asignados de un responsable en una campaña. */
export async function setSellerNumbersAction(sellerId: UUID, campaignId: UUID, bonusNumberIds: UUID[]): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusCampaignService().setSellerNumbers(ctx, sellerId, campaignId, bonusNumberIds);
  if (result.ok) revalidateBonus();
  return result;
}

/** Elimina un responsable y libera sus números asignados. */
export async function deleteSellerAction(sellerId: UUID): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusCampaignService().deleteSeller(ctx, sellerId);
  if (result.ok) revalidateBonus();
  return result;
}

/** Lista los responsables del comité. */
export async function listSellersAction(): Promise<Result<SellerRow[]>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  return createBonusCampaignService().listSellers(ctx);
}

/** Responsables de una campaña con sus números asignados y el total. */
export async function listSellersWithAssignmentsAction(campaignId: UUID): Promise<Result<SellerWithAssignments[]>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  return createBonusCampaignService().listSellersWithAssignments(ctx, campaignId);
}

/** Números de la campaña sin responsable vigente (para el combobox de asignación). */
export async function listUnassignedNumbersAction(campaignId: UUID): Promise<Result<UnassignedNumber[]>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  return createBonusCampaignService().listUnassignedNumbers(ctx, campaignId);
}

/** Libro de la campaña: número, beneficiario, responsable, pagos {mes:bool}. */
export async function getCampaignLedgerAction(campaignId: UUID): Promise<Result<LedgerRow[]>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  return createBonusLedgerService().getCampaignLedger(ctx, campaignId);
}

/** Marca/desmarca un mes (1–12) como pagado para un número. */
export async function setMonthPaidAction(bonusNumberId: UUID, month: number, paid: boolean): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusLedgerService().setMonthPaid(ctx, bonusNumberId, month, paid);
  if (result.ok) revalidateBonus();
  return result;
}

/**
 * Registra el pago de un mes para un responsable: marca ese mes como pagado en
 * todos sus números y genera un ingreso a la caja principal por el total.
 */
export async function paySellerMonthAction(
  sellerId: UUID,
  campaignId: UUID,
  month: number,
): Promise<Result<{ amount: string; count: number; transactionId: UUID | null }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusLedgerService().paySellerMonth(ctx, sellerId, campaignId, month);
  if (result.ok) revalidateBonus();
  return result;
}

/** Corte por mes de la campaña: pagados/pendientes por mes. */
export async function bonusMonthlyCutAction(campaignId: UUID): Promise<Result<MonthlyCutRow[]>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  return createBonusLedgerService().monthlyCut(ctx, campaignId);
}

/** Registra la entrega del premio de un mes (número ganador, fecha, responsable). */
export async function recordPrizeDeliveryAction(
  campaignId: UUID,
  data: PrizeDeliveryInput,
): Promise<Result<{ deliveryId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusLedgerService().recordPrizeDelivery(ctx, campaignId, data);
  if (result.ok) revalidateBonus();
  return result;
}

/** Histórico de entregas de premio de la campaña. */
export async function listPrizeDeliveriesAction(campaignId: UUID): Promise<Result<PrizeDeliveryRow[]>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  return createBonusLedgerService().listPrizeDeliveries(ctx, campaignId);
}

export async function generateNumbersAction(campaignId: UUID): Promise<Result<{ count: number }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusCampaignService().generateNumbers(ctx, campaignId);
  if (result.ok) revalidateBonus();
  return result;
}

export async function assignHolderAction(bonusNumberId: UUID, beneficiaryName: string, memberId?: UUID | null): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusCampaignService().assignHolder(ctx, bonusNumberId, beneficiaryName, memberId);
  if (result.ok) revalidateBonus();
  return result;
}

export async function saveEligibilityRulesAction(campaignId: UUID, rules: EligibilityRules): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusCampaignService().saveEligibilityRules(ctx, campaignId, rules);
  if (result.ok) revalidateBonus();
  return result;
}

// ── Collections ────────────────────────────────────────────────────────────────

export async function assignSellersAction(campaignId: UUID, sellerId: UUID, bonusNumberIds: UUID[]): Promise<Result<void>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusCollectionService().assignSellers(ctx, campaignId, sellerId, bonusNumberIds);
  if (result.ok) revalidateBonus();
  return result;
}

export async function generateMonthlyDuesAction(campaignId: UUID, period: string): Promise<Result<{ count: number }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusCollectionService().generateMonthlyDues(ctx, campaignId, period);
  if (result.ok) revalidateBonus();
  return result;
}

export async function recordCollectionAction(dueId: UUID, amount: string, sellerId: UUID): Promise<Result<{ collectionId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusCollectionService().recordCollection(ctx, dueId, amount, sellerId);
  if (result.ok) revalidateBonus();
  return result;
}

// ── Settlements ────────────────────────────────────────────────────────────────

export async function reportSettlementAction(data: SettlementReportInput): Promise<Result<{ settlementId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusSettlementService().report(ctx, data);
  if (result.ok) revalidateBonus();
  return result;
}

export async function confirmSettlementAction(settlementId: UUID, accountId: UUID, categoryId: UUID): Promise<Result<{ transactionId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusSettlementService().confirmSettlement(ctx, settlementId, accountId, categoryId);
  if (result.ok) revalidateBonus();
  return result;
}

// ── Draws ──────────────────────────────────────────────────────────────────────

export async function registerDrawAction(data: DrawInput): Promise<Result<{ drawId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusDrawService().registerDraw(ctx, data);
  if (result.ok) revalidateBonus();
  return result;
}

export async function payPrizeAction(drawId: UUID, accountId: UUID, categoryId: UUID): Promise<Result<{ transactionId: UUID }>> {
  const ctx = await resolveCtx();
  if (!ctx) return unauth();
  const result = await createBonusDrawService().payPrize(ctx, drawId, accountId, categoryId);
  if (result.ok) revalidateBonus();
  return result;
}
