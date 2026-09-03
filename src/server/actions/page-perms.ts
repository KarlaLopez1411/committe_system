import 'server-only';

import { can } from '@/server/authz';

import { resolveActionCtx } from './resolve-ctx';

/**
 * Permisos efectivos del usuario en el comité activo, en forma de banderas
 * booleanas para usar en Server Components y pasarlas a componentes cliente
 * (que no pueden importar `can`/`resolveActionCtx`, que son `server-only`).
 *
 * Las banderas reflejan exactamente los checks del servicio, de modo que un rol
 * de solo lectura (p. ej. `member`) no vea los controles de crear/editar.
 */
export interface PagePerms {
  /** committee.manage */
  canManageCommittee: boolean;
  /** transactions.create */
  canCreateTransaction: boolean;
  /** transactions.approve — aprobar/anular transacciones */
  canApproveTransaction: boolean;
  /** members.create */
  canCreateMember: boolean;
  /** members.update */
  canUpdateMember: boolean;
  /** users.manage */
  canManageUsers: boolean;
  /** bonuses.manage || committee.manage */
  canManageBonuses: boolean;
  /** bonuses.collect || bonuses.manage || committee.manage */
  canCollectBonuses: boolean;
  /** bonuses.draw || bonuses.manage || committee.manage */
  canDrawBonuses: boolean;
  /** cash_closings.create || committee.manage */
  canCreateCashClosing: boolean;
  /** cash_closings.review || committee.manage */
  canReviewCashClosing: boolean;
  /** cash_closings.approve || committee.manage */
  canApproveCashClosing: boolean;
  /** cash_closings.close || committee.manage */
  canCloseCashClosing: boolean;
  /** committee.manage || transactions.create (crear actividad) */
  canCreateActivity: boolean;
  /** password_changes.approve */
  canApprovePasswordChanges: boolean;
}

/** Todas las banderas en `false` (usuario sin sesión/permite fail-closed). */
const NONE: PagePerms = {
  canManageCommittee: false,
  canCreateTransaction: false,
  canApproveTransaction: false,
  canCreateMember: false,
  canUpdateMember: false,
  canManageUsers: false,
  canManageBonuses: false,
  canCollectBonuses: false,
  canDrawBonuses: false,
  canCreateCashClosing: false,
  canReviewCashClosing: false,
  canApproveCashClosing: false,
  canCloseCashClosing: false,
  canCreateActivity: false,
  canApprovePasswordChanges: false,
};

/** Resuelve las banderas de permisos para la página actual. */
export async function resolvePagePerms(): Promise<PagePerms> {
  const ctx = await resolveActionCtx();
  if (!ctx) return NONE;

  const manage = can(ctx, 'committee.manage');
  const bonusesManage = can(ctx, 'bonuses.manage') || manage;
  const canApprove = can(ctx, 'password_changes.approve');

  // DEBUG
  console.log('[DEBUG page-perms]', {
    userId: ctx.userId,
    committeeId: ctx.committeeId,
    permissions: ctx.permissions,
    canApprove,
  });

  return {
    canManageCommittee: manage,
    canCreateTransaction: can(ctx, 'transactions.create'),
    canApproveTransaction: can(ctx, 'transactions.approve') || manage,
    canCreateMember: can(ctx, 'members.create'),
    canUpdateMember: can(ctx, 'members.update'),
    canManageUsers: can(ctx, 'users.manage'),
    canManageBonuses: bonusesManage,
    canCollectBonuses: can(ctx, 'bonuses.collect') || bonusesManage,
    canDrawBonuses: can(ctx, 'bonuses.draw') || bonusesManage,
    canCreateCashClosing: can(ctx, 'cash_closings.create') || manage,
    canReviewCashClosing: can(ctx, 'cash_closings.review') || manage,
    canApproveCashClosing: can(ctx, 'cash_closings.approve') || manage,
    canCloseCashClosing: can(ctx, 'cash_closings.close') || manage,
    canCreateActivity: manage || can(ctx, 'transactions.create'),
    canApprovePasswordChanges: canApprove,
  };
}
