import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';
import { isValid, greaterThan } from '@/domain/money';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { can } from '@/server/authz';

export const CAMPAIGN_YEAR_MIN = 2000;
export const CAMPAIGN_YEAR_MAX = 2100;
export const CAMPAIGN_MONTHS_MIN = 1;
export const CAMPAIGN_MONTHS_MAX = 12;

/**
 * Los bonos se manejan por año y son SIEMPRE 100 números (1–100).
 * Estos valores fijos ya no se solicitan en el alta de campaña.
 */
export const BONUS_NUMBER_START = 1;
export const BONUS_NUMBER_END = 100;
export const BONUS_NUMBER_COUNT = BONUS_NUMBER_END - BONUS_NUMBER_START + 1;
export const BONUS_ACTIVE_MONTHS = 12;

/**
 * Alta de campaña simplificada: solo año, aportación mensual y premio mensual.
 * El nombre y el rango de números (1–100) se derivan automáticamente.
 */
export interface CampaignInput {
  /** 2000–2100 (R24.1). */
  year: number;
  /** > 0 (R24.3). Aportación mensual por número. */
  monthlyAmount: string;
  /** > 0 (R24.3). Premio mensual. */
  monthlyPrize: string;
}

/** Fila de la tabla de la campaña: número, beneficiario, responsable, pagado. */
export interface CampaignNumberRow {
  bonusNumberId: UUID;
  number: number;
  beneficiary: string | null;
  seller: string | null;
  paid: boolean;
}

/** Vendedor/responsable del comité. */
export interface SellerRow {
  id: UUID;
  displayName: string;
}

/** Datos de alta de un responsable (vendedor). */
export interface SellerInput {
  /** Nombre del responsable (2–150 chars). */
  displayName: string;
  /** Teléfono de contacto opcional. */
  phone?: string | null;
  /** Números de bono (ids) a asignar al responsable al momento del alta. */
  bonusNumberIds?: UUID[];
}

/** Responsable con sus números asignados vigentes en una campaña. */
export interface SellerWithAssignments {
  id: UUID;
  displayName: string;
  phone: string | null;
  /** Números de bono asignados vigentes (valores, ordenados) — para mostrar. */
  assignedNumbers: number[];
  /** Números asignados vigentes con su id — para editar la asignación. */
  assigned: { bonusNumberId: UUID; number: number }[];
  /** Total de números asignados (= assignedNumbers.length). */
  totalNumbers: number;
}

/** Número de campaña disponible (sin responsable vigente) para asignar. */
export interface UnassignedNumber {
  bonusNumberId: UUID;
  number: number;
}

export interface EligibilityRules {
  minPaymentPercent: number;
  minConsecutiveMonths: number;
  allowPartialPayment: boolean;
  excludeDebtors: boolean;
  maxMissedMonths: number;
  requireActiveStatus: boolean;
}

export interface BonusCampaignServiceDeps { client?: SupabaseClient; }

export interface BonusCampaignService {
  /** Crea la campaña del año (nombre y rango 1–100 automáticos) y genera sus 100 números. */
  createCampaign(ctx: Ctx, data: CampaignInput): Promise<Result<{ campaignId: UUID }>>;
  /** Creates numberEnd − numberStart + 1 unique numbers for the campaign (R25.1, R25.2). */
  generateNumbers(ctx: Ctx, campaignId: UUID): Promise<Result<{ count: number }>>;
  /** Preserves previous holder with valid_to; max 1 active holder (R26.1, R26.2). */
  assignHolder(ctx: Ctx, bonusNumberId: UUID, beneficiaryName: string, memberId?: UUID | null, validFrom?: string): Promise<Result<void>>;
  /** Persists 6 eligibility params with attribution (R34.1, R34.2). */
  saveEligibilityRules(ctx: Ctx, campaignId: UUID, rules: EligibilityRules): Promise<Result<void>>;
  /**
   * Da de alta un responsable (vendedor) del comité con teléfono opcional y,
   * si se indican, le asigna de inmediato los números de bono seleccionados.
   */
  createSeller(ctx: Ctx, data: SellerInput): Promise<Result<{ sellerId: UUID }>>;
  /** Edita el nombre y/o teléfono de un responsable. */
  updateSeller(ctx: Ctx, sellerId: UUID, data: { displayName: string; phone?: string | null }): Promise<Result<void>>;
  /**
   * Reconcilia los números asignados vigentes de un responsable en una campaña
   * al conjunto EXACTO indicado: cierra los que ya no están, asigna los nuevos
   * (reasignándolos desde otro responsable si hiciera falta).
   */
  setSellerNumbers(ctx: Ctx, sellerId: UUID, campaignId: UUID, bonusNumberIds: UUID[]): Promise<Result<void>>;
  /**
   * Elimina un responsable. Libera primero sus números asignados vigentes
   * (para que vuelvan a estar disponibles) y luego borra el responsable.
   */
  deleteSeller(ctx: Ctx, sellerId: UUID): Promise<Result<void>>;
  /** Lista los responsables del comité. */
  listSellers(ctx: Ctx): Promise<Result<SellerRow[]>>;
  /** Responsables de una campaña con sus números asignados y el total. */
  listSellersWithAssignments(ctx: Ctx, campaignId: UUID): Promise<Result<SellerWithAssignments[]>>;
  /** Números de la campaña que no tienen responsable vigente. */
  listUnassignedNumbers(ctx: Ctx, campaignId: UUID): Promise<Result<UnassignedNumber[]>>;
  /** Marca/desmarca un número como pagado. */
  setNumberPaid(ctx: Ctx, bonusNumberId: UUID, paid: boolean): Promise<Result<void>>;
  /** Tabla de la campaña: número, beneficiario, responsable, pagado. */
  listCampaignNumbers(ctx: Ctx, campaignId: UUID): Promise<Result<CampaignNumberRow[]>>;
}

const PG_UNIQUE = '23505';

/**
 * Asegura que exista una fila en bonus_number_ledger por cada número de la
 * campaña (fuente de verdad del nuevo modelo). Idempotente.
 */
async function syncLedgerForCampaign(client: SupabaseClient, committeeId: UUID, campaignId: UUID): Promise<void> {
  const { data: numbers } = await client
    .from('bonus_numbers')
    .select('id, number')
    .eq('committee_id', committeeId)
    .eq('campaign_id', campaignId);
  const rows = (numbers ?? []).map((n) => ({
    committee_id: committeeId,
    campaign_id: campaignId,
    bonus_number_id: (n as { id: UUID }).id,
    number: (n as { number: number }).number,
    pagos: {},
  }));
  if (rows.length > 0) {
    await client.from('bonus_number_ledger').upsert(rows, { onConflict: 'bonus_number_id', ignoreDuplicates: true });
  }
}

export function createBonusCampaignService(deps: BonusCampaignServiceDeps = {}): BonusCampaignService {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  return {
    async createCampaign(ctx, data) {
      if (!can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para crear campañas de bonos.');
      }

      // R24.1: year 2000–2100
      if (!Number.isInteger(data.year) || data.year < CAMPAIGN_YEAR_MIN || data.year > CAMPAIGN_YEAR_MAX) {
        return err('campaign/invalid-year', `El año debe estar entre ${CAMPAIGN_YEAR_MIN} y ${CAMPAIGN_YEAR_MAX}.`, 'year');
      }

      // R24.3: amounts > 0
      if (!isValid(data.monthlyAmount) || !greaterThan(data.monthlyAmount, '0.00')) {
        return err('campaign/invalid-amount', 'La aportación mensual debe ser mayor a 0.', 'monthlyAmount');
      }
      if (!isValid(data.monthlyPrize) || !greaterThan(data.monthlyPrize, '0.00')) {
        return err('campaign/invalid-prize', 'El premio mensual debe ser mayor a 0.', 'monthlyPrize');
      }

      const client = getClient();
      // Nombre y rango fijos: los bonos son siempre 100 números (1–100) por año.
      const { data: row, error } = await client
        .from('bonus_campaigns')
        .insert({
          committee_id: ctx.committeeId,
          name: `Bonos ${data.year}`,
          year: data.year,
          number_start: BONUS_NUMBER_START,
          number_end: BONUS_NUMBER_END,
          monthly_amount: data.monthlyAmount,
          monthly_prize: data.monthlyPrize,
          active_months: BONUS_ACTIVE_MONTHS,
          status: 'activa',
        })
        .select('id')
        .single();

      if (error || !row) {
        if (error?.code === PG_UNIQUE) return err('campaign/duplicate-year', 'Ya existe una campaña para ese año.', 'year');
        return err('campaign/create-failed', `No se pudo crear la campaña: ${error?.message ?? 'error desconocido'}.`);
      }

      const campaignId = (row as { id: UUID }).id;

      // Genera automáticamente los 100 números de la campaña.
      const numberRows = [];
      for (let n = BONUS_NUMBER_START; n <= BONUS_NUMBER_END; n++) {
        numberRows.push({ committee_id: ctx.committeeId, campaign_id: campaignId, number: n, status: 'activo' });
      }
      const { error: numErr } = await client
        .from('bonus_numbers')
        .upsert(numberRows, { onConflict: 'campaign_id,number', ignoreDuplicates: true });
      if (numErr) {
        return err('campaign/generate-failed', `La campaña se creó pero no se pudieron generar los números: ${numErr.message}.`);
      }

      await syncLedgerForCampaign(client, ctx.committeeId, campaignId);

      return ok({ campaignId });
    },

    async generateNumbers(ctx, campaignId) {
      if (!can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para generar números de bono.');
      }

      const client = getClient();

      const { data: campaign } = await client.from('bonus_campaigns').select('number_start, number_end').eq('id', campaignId).eq('committee_id', ctx.committeeId).single();
      if (!campaign) return err('campaign/not-found', 'La campaña indicada no existe.');

      const c = campaign as { number_start: number; number_end: number };
      const rows = [];
      for (let n = c.number_start; n <= c.number_end; n++) {
        rows.push({ committee_id: ctx.committeeId, campaign_id: campaignId, number: n, status: 'activo' });
      }

      // upsert to be idempotent against re-run
      const { error } = await client.from('bonus_numbers').upsert(rows, { onConflict: 'campaign_id,number', ignoreDuplicates: true });
      if (error) return err('campaign/generate-failed', `No se pudieron generar los números: ${error.message}.`);

      await syncLedgerForCampaign(client, ctx.committeeId, campaignId);

      return ok({ count: rows.length });
    },

    async assignHolder(ctx, bonusNumberId, beneficiaryName, memberId, validFrom) {
      if (!can(ctx, 'committee.manage') && !can(ctx, 'bonuses.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para asignar titulares.');
      }
      if (!beneficiaryName?.trim()) return err('holder/missing-name', 'El nombre del beneficiario es obligatorio.');

      const today = validFrom ?? new Date().toISOString().slice(0, 10);
      const client = getClient();

      // R26.2: close current active assignment
      await client.from('bonus_holder_assignments')
        .update({ valid_to: today })
        .eq('bonus_number_id', bonusNumberId)
        .is('valid_to', null);

      const { error } = await client.from('bonus_holder_assignments').insert({
        committee_id: ctx.committeeId,
        bonus_number_id: bonusNumberId,
        beneficiary_name: beneficiaryName.trim(),
        member_id: memberId ?? null,
        valid_from: today,
        valid_to: null,
        created_by: ctx.userId,
      });

      if (error) return err('holder/assign-failed', `No se pudo asignar el titular: ${error.message}.`);

      // Sincroniza el beneficiario en el libro (fuente de verdad del nuevo modelo).
      await client.from('bonus_number_ledger')
        .update({ beneficiary: beneficiaryName.trim(), updated_at: new Date().toISOString() })
        .eq('bonus_number_id', bonusNumberId)
        .eq('committee_id', ctx.committeeId);

      return ok(undefined);
    },

    async saveEligibilityRules(ctx, campaignId, rules) {
      if (!can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para definir reglas de elegibilidad.');
      }

      const client = getClient();
      const { error } = await client.from('bonus_campaigns').update({
        rules: { ...rules, updated_by: ctx.userId, updated_at: new Date().toISOString() },
        rules_defined: true,
      }).eq('id', campaignId).eq('committee_id', ctx.committeeId);

      if (error) return err('campaign/rules-failed', `No se pudieron guardar las reglas: ${error.message}.`);
      return ok(undefined);
    },

    async createSeller(ctx, data) {
      if (!can(ctx, 'committee.manage') && !can(ctx, 'bonuses.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para dar de alta responsables.');
      }
      const name = (data?.displayName ?? '').trim();
      if (name.length < 2 || name.length > 150) {
        return err('seller/invalid-name', 'El nombre del responsable debe tener entre 2 y 150 caracteres.', 'displayName');
      }
      const phone = (data?.phone ?? '').trim();
      if (phone.length > 30) {
        return err('seller/invalid-phone', 'El teléfono no puede exceder 30 caracteres.', 'phone');
      }

      const client = getClient();
      const { data: row, error } = await client
        .from('bonus_sellers')
        .insert({ committee_id: ctx.committeeId, display_name: name, phone: phone || null })
        .select('id')
        .single();

      if (error || !row) {
        return err('seller/create-failed', `No se pudo dar de alta al responsable: ${error?.message ?? 'error desconocido'}.`);
      }
      const sellerId = (row as { id: UUID }).id;

      // Asignación opcional de números al momento del alta (máx. 1 vendedor
      // vigente por número: se cierra cualquier asignación previa).
      const numberIds = (data?.bonusNumberIds ?? []).filter(Boolean);
      if (numberIds.length > 0) {
        const now = new Date().toISOString();
        for (const numId of numberIds) {
          await client.from('bonus_seller_assignments')
            .update({ valid_to: now })
            .eq('bonus_number_id', numId)
            .eq('committee_id', ctx.committeeId)
            .is('valid_to', null);
        }
        const rows = numberIds.map((id) => ({
          committee_id: ctx.committeeId,
          bonus_number_id: id,
          seller_id: sellerId,
          valid_from: now,
          valid_to: null,
        }));
        const { error: assignErr } = await client.from('bonus_seller_assignments').insert(rows);
        if (assignErr) {
          return err('seller/assign-failed', `El responsable se creó pero no se pudieron asignar los números: ${assignErr.message}.`);
        }
        // Sincroniza responsable en el libro.
        for (const numId of numberIds) {
          await client.from('bonus_number_ledger')
            .update({ seller_id: sellerId, updated_at: now })
            .eq('bonus_number_id', numId)
            .eq('committee_id', ctx.committeeId);
        }
      }

      return ok({ sellerId });
    },

    async updateSeller(ctx, sellerId, data) {
      if (!can(ctx, 'committee.manage') && !can(ctx, 'bonuses.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para editar responsables.');
      }
      const name = (data?.displayName ?? '').trim();
      if (name.length < 2 || name.length > 150) {
        return err('seller/invalid-name', 'El nombre del responsable debe tener entre 2 y 150 caracteres.', 'displayName');
      }
      const phone = (data?.phone ?? '').trim();
      if (phone.length > 30) {
        return err('seller/invalid-phone', 'El teléfono no puede exceder 30 caracteres.', 'phone');
      }

      const client = getClient();
      const { error } = await client
        .from('bonus_sellers')
        .update({ display_name: name, phone: phone || null })
        .eq('id', sellerId)
        .eq('committee_id', ctx.committeeId);

      if (error) return err('seller/update-failed', `No se pudo editar al responsable: ${error.message}.`);
      return ok(undefined);
    },

    async setSellerNumbers(ctx, sellerId, campaignId, bonusNumberIds) {
      if (!can(ctx, 'committee.manage') && !can(ctx, 'bonuses.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para asignar números.');
      }

      const desired = new Set((bonusNumberIds ?? []).filter(Boolean));
      const client = getClient();
      const now = new Date().toISOString();

      // Números que este responsable tiene asignados vigentes en la campaña.
      const { data: current, error: curErr } = await client
        .from('bonus_seller_assignments')
        .select('bonus_number_id, bonus_numbers!inner(campaign_id)')
        .eq('committee_id', ctx.committeeId)
        .eq('seller_id', sellerId)
        .is('valid_to', null);
      if (curErr) return err('assignment/failed', `No se pudieron resolver las asignaciones: ${curErr.message}.`);

      const currentIds = new Set<string>();
      for (const r of (current ?? []) as { bonus_number_id: UUID; bonus_numbers: unknown }[]) {
        const rel = r.bonus_numbers;
        const bn = Array.isArray(rel) ? rel[0] : rel;
        if (bn && (bn as { campaign_id?: string }).campaign_id === campaignId) {
          currentIds.add(r.bonus_number_id);
        }
      }

      const toRemove = [...currentIds].filter((id) => !desired.has(id));
      const toAdd = [...desired].filter((id) => !currentIds.has(id));

      // Cierra (libera) los números quitados.
      for (const numId of toRemove) {
        await client.from('bonus_seller_assignments')
          .update({ valid_to: now })
          .eq('bonus_number_id', numId)
          .eq('seller_id', sellerId)
          .eq('committee_id', ctx.committeeId)
          .is('valid_to', null);
      }

      // Para los números nuevos: cierra cualquier asignación vigente (de otro
      // responsable) y crea la nueva. Máx. 1 responsable vigente por número.
      if (toAdd.length > 0) {
        for (const numId of toAdd) {
          await client.from('bonus_seller_assignments')
            .update({ valid_to: now })
            .eq('bonus_number_id', numId)
            .eq('committee_id', ctx.committeeId)
            .is('valid_to', null);
        }
        const rows = toAdd.map((id) => ({
          committee_id: ctx.committeeId,
          bonus_number_id: id,
          seller_id: sellerId,
          valid_from: now,
          valid_to: null,
        }));
        const { error: insErr } = await client.from('bonus_seller_assignments').insert(rows);
        if (insErr) return err('assignment/failed', `No se pudieron asignar los números: ${insErr.message}.`);
      }

      // Sincroniza el responsable en el libro: quitados → null, agregados → sellerId.
      for (const numId of toRemove) {
        await client.from('bonus_number_ledger')
          .update({ seller_id: null, updated_at: now })
          .eq('bonus_number_id', numId)
          .eq('committee_id', ctx.committeeId);
      }
      for (const numId of toAdd) {
        await client.from('bonus_number_ledger')
          .update({ seller_id: sellerId, updated_at: now })
          .eq('bonus_number_id', numId)
          .eq('committee_id', ctx.committeeId);
      }

      return ok(undefined);
    },

    async deleteSeller(ctx, sellerId) {
      if (!can(ctx, 'committee.manage') && !can(ctx, 'bonuses.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para eliminar responsables.');
      }

      const client = getClient();

      // Libera (cierra) las asignaciones de números vigentes del responsable
      // para que esos números vuelvan a estar disponibles.
      const now = new Date().toISOString();
      await client.from('bonus_seller_assignments')
        .update({ valid_to: now })
        .eq('seller_id', sellerId)
        .eq('committee_id', ctx.committeeId)
        .is('valid_to', null);

      // Libera el responsable en el libro (los números quedan sin responsable).
      await client.from('bonus_number_ledger')
        .update({ seller_id: null, updated_at: now })
        .eq('seller_id', sellerId)
        .eq('committee_id', ctx.committeeId);

      // Borra el histórico de asignaciones del responsable (evita FK huérfanas).
      await client.from('bonus_seller_assignments')
        .delete()
        .eq('seller_id', sellerId)
        .eq('committee_id', ctx.committeeId);

      const { error } = await client
        .from('bonus_sellers')
        .delete()
        .eq('id', sellerId)
        .eq('committee_id', ctx.committeeId);

      if (error) {
        // 23503 = foreign_key_violation: el responsable tiene cobros/entregas ligados.
        if (error.code === '23503') {
          return err(
            'seller/has-references',
            'No se puede eliminar: el responsable tiene cobros o entregas registrados. Reasigna esos movimientos antes de eliminarlo.',
          );
        }
        return err('seller/delete-failed', `No se pudo eliminar al responsable: ${error.message}.`);
      }
      return ok(undefined);
    },

    async listSellers(ctx) {
      if (!can(ctx, 'bonuses.read') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para consultar responsables.');
      }
      const client = getClient();
      const { data, error } = await client
        .from('bonus_sellers')
        .select('id, display_name')
        .eq('committee_id', ctx.committeeId)
        .order('display_name', { ascending: true });

      if (error) return err('seller/list-failed', `No se pudieron listar los responsables: ${error.message}.`);
      const rows = (data ?? []).map((r) => ({
        id: (r as { id: UUID }).id,
        displayName: (r as { display_name: string }).display_name,
      }));
      return ok(rows);
    },

    async listSellersWithAssignments(ctx, campaignId) {
      if (!can(ctx, 'bonuses.read') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para consultar responsables.');
      }
      const client = getClient();

      const { data: sellers, error: sellersErr } = await client
        .from('bonus_sellers')
        .select('id, display_name, phone')
        .eq('committee_id', ctx.committeeId)
        .order('display_name', { ascending: true });
      if (sellersErr) return err('seller/list-failed', `No se pudieron listar los responsables: ${sellersErr.message}.`);

      const sellerRows = (sellers ?? []) as { id: UUID; display_name: string; phone: string | null }[];

      // Asignaciones desde el LIBRO (fuente de verdad): número → seller.
      const { data: ledger, error: lErr } = await client
        .from('bonus_number_ledger')
        .select('bonus_number_id, number, seller_id')
        .eq('committee_id', ctx.committeeId)
        .eq('campaign_id', campaignId);
      if (lErr) return err('seller/list-failed', `No se pudieron resolver las asignaciones: ${lErr.message}.`);

      const assignedBySeller = new Map<string, { bonusNumberId: UUID; number: number }[]>();
      for (const r of (ledger ?? []) as { bonus_number_id: UUID; number: number; seller_id: UUID | null }[]) {
        if (!r.seller_id) continue;
        const list = assignedBySeller.get(r.seller_id) ?? [];
        list.push({ bonusNumberId: r.bonus_number_id, number: r.number });
        assignedBySeller.set(r.seller_id, list);
      }

      const result: SellerWithAssignments[] = sellerRows.map((s) => {
        const assigned = (assignedBySeller.get(s.id) ?? []).sort((x, y) => x.number - y.number);
        return {
          id: s.id,
          displayName: s.display_name,
          phone: s.phone ?? null,
          assignedNumbers: assigned.map((a) => a.number),
          assigned,
          totalNumbers: assigned.length,
        };
      });
      return ok(result);
    },

    async listUnassignedNumbers(ctx, campaignId) {
      if (!can(ctx, 'bonuses.read') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para consultar los números.');
      }
      const client = getClient();

      // Números sin responsable en el LIBRO (seller_id IS NULL).
      const { data: rows, error } = await client
        .from('bonus_number_ledger')
        .select('bonus_number_id, number, seller_id')
        .eq('committee_id', ctx.committeeId)
        .eq('campaign_id', campaignId)
        .order('number', { ascending: true });
      if (error) return err('campaign/numbers-failed', `No se pudieron listar los números: ${error.message}.`);

      const available: UnassignedNumber[] = ((rows ?? []) as { bonus_number_id: UUID; number: number; seller_id: UUID | null }[])
        .filter((r) => !r.seller_id)
        .map((r) => ({ bonusNumberId: r.bonus_number_id, number: r.number }));
      return ok(available);
    },

    async setNumberPaid(ctx, bonusNumberId, paid) {
      if (!can(ctx, 'bonuses.collect') && !can(ctx, 'bonuses.manage') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para actualizar el estado de pago.');
      }
      const client = getClient();
      const { error } = await client
        .from('bonus_numbers')
        .update({ paid })
        .eq('id', bonusNumberId)
        .eq('committee_id', ctx.committeeId);

      if (error) return err('number/paid-failed', `No se pudo actualizar el pago: ${error.message}.`);
      return ok(undefined);
    },

    async listCampaignNumbers(ctx, campaignId) {
      if (!can(ctx, 'bonuses.read') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para consultar la campaña.');
      }
      const client = getClient();

      const { data: numbers, error } = await client
        .from('bonus_numbers')
        .select('id, number, paid')
        .eq('campaign_id', campaignId)
        .eq('committee_id', ctx.committeeId)
        .order('number', { ascending: true });

      if (error) return err('campaign/numbers-failed', `No se pudieron listar los números: ${error.message}.`);

      const numberRows = (numbers ?? []) as { id: UUID; number: number; paid: boolean }[];
      if (numberRows.length === 0) return ok([]);

      const ids = numberRows.map((n) => n.id);

      // Beneficiario vigente por número (valid_to IS NULL).
      const { data: holders } = await client
        .from('bonus_holder_assignments')
        .select('bonus_number_id, beneficiary_name')
        .in('bonus_number_id', ids)
        .is('valid_to', null);
      const beneficiaryByNumber = new Map<string, string>();
      for (const h of (holders ?? []) as { bonus_number_id: UUID; beneficiary_name: string }[]) {
        beneficiaryByNumber.set(h.bonus_number_id, h.beneficiary_name);
      }

      // Responsable (vendedor) vigente por número (valid_to IS NULL).
      const { data: sellerAssignments } = await client
        .from('bonus_seller_assignments')
        .select('bonus_number_id, bonus_sellers(display_name)')
        .in('bonus_number_id', ids)
        .is('valid_to', null);
      const sellerByNumber = new Map<string, string>();
      for (const s of (sellerAssignments ?? []) as { bonus_number_id: UUID; bonus_sellers: unknown }[]) {
        const rel = s.bonus_sellers;
        const seller = Array.isArray(rel) ? rel[0] : rel;
        const name = seller ? (seller as { display_name?: string }).display_name : undefined;
        if (name) sellerByNumber.set(s.bonus_number_id, name);
      }

      const rows: CampaignNumberRow[] = numberRows.map((n) => ({
        bonusNumberId: n.id,
        number: n.number,
        beneficiary: beneficiaryByNumber.get(n.id) ?? null,
        seller: sellerByNumber.get(n.id) ?? null,
        paid: Boolean(n.paid),
      }));
      return ok(rows);
    },
  };
}
