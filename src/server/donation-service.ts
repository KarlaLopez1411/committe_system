import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { can } from '@/server/authz';

export const DONATION_TYPES = ['dinero', 'material', 'bien', 'servicio', 'otro'] as const;
export const DONATION_ORIGINS = ['persona', 'empresa', 'institucion', 'anonimo'] as const;
export type DonationType = (typeof DONATION_TYPES)[number];
export type DonationOrigin = (typeof DONATION_ORIGINS)[number];

export interface DonationInput {
  type: DonationType;
  origin: DonationOrigin;
  /** 1–500 chars (in-kind). */
  description?: string | null;
  /** > 0 and ≤ limit (in-kind quantity). */
  quantity?: string | null;
  /** Optional; marked is_estimated=true; never touches saldo (R18.5). */
  estimatedValue?: string | null;
  /** 1–200 chars (in-kind destination). */
  destination?: string | null;
}

export interface DonationServiceDeps { client?: SupabaseClient; }

export interface DonationService {
  register(ctx: Ctx, data: DonationInput): Promise<Result<{ donationId: UUID }>>;
  /** Links exactly one income transaction (R18.6, R18.7). */
  confirmMonetary(ctx: Ctx, donationId: UUID, transactionId: UUID): Promise<Result<void>>;
}

const PG_UNIQUE = '23505';

export function createDonationService(deps: DonationServiceDeps = {}): DonationService {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  return {
    async register(ctx, data) {
      if (!can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para registrar donaciones.');
      }

      if (!DONATION_TYPES.includes(data?.type)) {
        return err('donation/invalid-type', 'El tipo de donación no es válido.', 'type');
      }
      if (!DONATION_ORIGINS.includes(data?.origin)) {
        return err('donation/invalid-origin', 'El origen de la donación no es válido.', 'origin');
      }

      // R18.3: in-kind description 1-500
      if (data.description != null) {
        const desc = data.description.trim();
        if (desc.length < 1 || desc.length > 500) {
          return err('donation/invalid-description', 'La descripción debe tener entre 1 y 500 caracteres.', 'description');
        }
      }
      // R18.3: destination 1-200
      if (data.destination != null) {
        const dest = data.destination.trim();
        if (dest.length < 1 || dest.length > 200) {
          return err('donation/invalid-destination', 'El destino debe tener entre 1 y 200 caracteres.', 'destination');
        }
      }

      const hasEstimated = data.estimatedValue != null && String(data.estimatedValue).trim() !== '';

      const client = getClient();
      const { data: row, error } = await client
        .from('donations')
        .insert({
          committee_id: ctx.committeeId,
          type: data.type,
          origin: data.origin,
          description: data.description?.trim() ?? null,
          quantity: data.quantity ?? null,
          estimated_value: hasEstimated ? data.estimatedValue : null,
          // R18.5: in-kind estimated value never affects saldo; is_estimated flag marks it
          is_estimated: hasEstimated,
          destination: data.destination?.trim() ?? null,
        })
        .select('id')
        .single();

      if (error || !row) {
        return err('donation/create-failed', `No se pudo registrar la donación: ${error?.message ?? 'error desconocido'}.`);
      }

      return ok({ donationId: (row as { id: UUID }).id });
    },

    async confirmMonetary(ctx, donationId, transactionId) {
      if (!can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para confirmar donaciones.');
      }

      const client = getClient();

      // R18.6: must be an income transaction of this committee.
      const { data: tx, error: txErr } = await client
        .from('financial_transactions')
        .select('type, committee_id')
        .eq('id', transactionId)
        .single();

      if (txErr || !tx) return err('transaction/not-found', 'La transacción indicada no existe.');
      const txRow = tx as { type: string; committee_id: UUID };
      if (txRow.committee_id !== ctx.committeeId) {
        return err('AUTHZ_FORBIDDEN', 'La transacción no pertenece al comité activo.');
      }
      if (txRow.type !== 'income') {
        return err('donation/wrong-type', 'Solo se puede vincular una transacción de tipo ingreso.');
      }

      // R18.7: atomic update — the UNIQUE constraint prevents double linking
      const { error } = await client
        .from('donations')
        .update({ financial_transaction_id: transactionId, confirmed: true })
        .eq('id', donationId)
        .eq('committee_id', ctx.committeeId);

      if (error) {
        if (error.code === PG_UNIQUE) {
          return err('donation/duplicate-link', 'Esta transacción ya está vinculada a otra donación.');
        }
        return err('donation/confirm-failed', `No se pudo confirmar la donación: ${error.message}.`);
      }

      return ok(undefined);
    },
  };
}
