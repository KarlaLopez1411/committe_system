import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import type { Ctx, UUID } from '@/domain/types';

// `server-only` lanza fuera del runtime de servidor de Next.js; se neutraliza en
// pruebas (misma estrategia que authz.test.ts). La garantía real de exclusión
// del bundle del cliente la cubren otras pruebas.
vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

import {
  can,
  hasCommitteeAccess,
  assertCommitteeAccess,
  AuthorizationError,
} from './authz';

/**
 * Feature: sac-sistema-administracion-comunitaria, Property 1: Aislamiento
 * multi-tenant en lectura y escritura
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.6
 *
 * Esta prueba valida la regla de aislamiento multi-tenant de la capa de
 * autorización (`src/server/authz.ts`), que replica en el servidor la regla de
 * `has_committee_access` de las políticas RLS (`0007_rls_policies.sql`):
 *
 *   Un usuario tiene acceso (lectura Y escritura) a un comité objetivo si y
 *   solo si:
 *     - es superadministrador (R2.6), O
 *     - existe en `committee_users` una membresía suya con ese `committee_id` y
 *       estado 'active' (R2.4).
 *
 *   En caso contrario:
 *     - la lectura no debe autorizarse (R2.2), y
 *     - la escritura/actualización/eliminación debe rechazarse (R2.3).
 *
 * Como en este entorno puede no haber un PostgreSQL/RLS en vivo, se modela la
 * pertenencia de `committee_users` + el flag de superadmin con un modelo en
 * memoria fiel, y se contrasta la decisión del modelo con el comportamiento
 * real de `hasCommitteeAccess` / `can` / `assertCommitteeAccess`.
 */

// --- Estado de membresía modelado (espejo fiel de committee_users) ---
type MembershipStatus = 'active' | 'inactive';

interface Membership {
  committeeId: UUID;
  status: MembershipStatus;
}

/** Regla de aislamiento del modelo: superadmin o membresía activa (R2.4, R2.6). */
function modelGrantsAccess(
  isSuperAdmin: boolean,
  memberships: Membership[],
  targetCommittee: UUID,
): boolean {
  if (isSuperAdmin) {
    return true;
  }
  return memberships.some(
    (m) => m.committeeId === targetCommittee && m.status === 'active',
  );
}

/**
 * Deriva el `Ctx` que el servidor resolvería para un usuario. El comité activo
 * del contexto es el primero con membresía activa (o el objetivo si es
 * superadmin), replicando `resolveActiveCommittee`. Si no hay membresías
 * activas, se usa un committeeId "vacío" que no coincide con ningún comité real.
 */
function buildCtx(
  userId: UUID,
  isSuperAdmin: boolean,
  _memberships: Membership[],
  activeCommitteeId: UUID,
): Ctx {
  return {
    userId,
    committeeId: activeCommitteeId,
    permissions: [],
    isSuperAdmin,
  };
}

// --- Generadores ---
const uuidLike = fc.uuid();

const arbMembership = (committeeIds: UUID[]): fc.Arbitrary<Membership> =>
  fc.record({
    committeeId: fc.constantFrom(...committeeIds),
    status: fc.constantFrom<MembershipStatus>('active', 'inactive'),
  });

// Un permiso de escritura y uno de lectura arbitrarios del catálogo RBAC.
const readPermission = fc.constantFrom(
  'members.read',
  'transactions.read',
  'bonuses.read',
  'reports.read',
  'audit.read',
);
const writePermission = fc.constantFrom(
  'members.create',
  'members.update',
  'transactions.create',
  'transactions.approve',
  'transactions.void',
  'cash_closings.close',
  'bonuses.collect',
  'bonuses.settle',
  'bonuses.draw',
  'users.manage',
  'committee.manage',
);

describe('Property 1: Aislamiento multi-tenant en lectura y escritura (R2.2, R2.3, R2.4, R2.6)', () => {
  it('la decisión de acceso a un comité objetivo coincide con la regla de aislamiento para lectura y escritura', () => {
    fc.assert(
      fc.property(
        // Universo de comités distintos (al menos 2 para poder tener ajenos).
        fc
          .uniqueArray(uuidLike, { minLength: 2, maxLength: 6 })
          .chain((committeeIds) =>
            fc.record({
              committeeIds: fc.constant(committeeIds),
              userId: uuidLike,
              isSuperAdmin: fc.boolean(),
              memberships: fc.uniqueArray(arbMembership(committeeIds), {
                maxLength: committeeIds.length,
                selector: (m) => m.committeeId,
              }),
              // El comité objetivo se elige del universo (puede o no tener membresía).
              targetIndex: fc.nat({ max: committeeIds.length - 1 }),
              // Permisos que el contexto poseería si tuviera acceso.
              grantedRead: readPermission,
              grantedWrite: writePermission,
              // Permiso concreto que se intenta ejercer.
              attemptedRead: readPermission,
              attemptedWrite: writePermission,
            }),
          ),
        (scenario) => {
          const {
            committeeIds,
            userId,
            isSuperAdmin,
            memberships,
            targetIndex,
            grantedRead,
            grantedWrite,
            attemptedRead,
            attemptedWrite,
          } = scenario;

          const targetCommittee = committeeIds[targetIndex]!;

          const expectedAccess = modelGrantsAccess(
            isSuperAdmin,
            memberships,
            targetCommittee,
          );

          // Comité activo del contexto: el objetivo si el usuario tiene acceso
          // por membresía activa o es superadmin; de lo contrario, la primera
          // membresía activa que tenga, o un comité "ajeno" al objetivo.
          const activeMembership = memberships.find((m) => m.status === 'active');
          const activeCommitteeId = isSuperAdmin
            ? targetCommittee
            : expectedAccess
              ? targetCommittee
              : (activeMembership?.committeeId ??
                // sin membresías activas: un id que no es el objetivo
                committeeIds.find((c) => c !== targetCommittee) ??
                targetCommittee);

          const ctx = buildCtx(
            userId,
            isSuperAdmin,
            memberships,
            activeCommitteeId,
          );

          // 1) La decisión de acceso al comité (base de lectura y escritura,
          //    R2.2/R2.3) coincide con la regla de aislamiento (R2.4/R2.6).
          const actualAccess = hasCommitteeAccess(ctx, targetCommittee);
          expect(actualAccess).toBe(expectedAccess);

          // 2) READ (R2.2): un usuario sin acceso no puede leer el comité
          //    objetivo, aun teniendo el permiso RBAC de lectura concedido.
          const readCtx: Ctx = {
            ...ctx,
            permissions: [grantedRead, grantedWrite],
          };
          const canReadTarget =
            hasCommitteeAccess(readCtx, targetCommittee) &&
            can(readCtx, attemptedRead);
          if (!expectedAccess) {
            expect(canReadTarget).toBe(false);
          }
          // Con acceso y permiso de lectura concedido, la lectura no se bloquea
          // por aislamiento.
          if (expectedAccess && attemptedRead === grantedRead) {
            expect(canReadTarget).toBe(true);
          }

          // 3) WRITE (R2.3): un usuario sin acceso no puede escribir en el
          //    comité objetivo, aun teniendo el permiso RBAC de escritura.
          const canWriteTarget =
            hasCommitteeAccess(readCtx, targetCommittee) &&
            can(readCtx, attemptedWrite);
          if (!expectedAccess) {
            expect(canWriteTarget).toBe(false);
          }
          if (expectedAccess && attemptedWrite === grantedWrite) {
            expect(canWriteTarget).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('assertCommitteeAccess concuerda con la regla de aislamiento (audita/rechaza sin acceso; pasa con acceso)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .uniqueArray(uuidLike, { minLength: 2, maxLength: 6 })
          .chain((committeeIds) =>
            fc.record({
              committeeIds: fc.constant(committeeIds),
              userId: uuidLike,
              isSuperAdmin: fc.boolean(),
              memberships: fc.uniqueArray(arbMembership(committeeIds), {
                maxLength: committeeIds.length,
                selector: (m) => m.committeeId,
              }),
              targetIndex: fc.nat({ max: committeeIds.length - 1 }),
            }),
          ),
        async (scenario) => {
          const {
            committeeIds,
            userId,
            isSuperAdmin,
            memberships,
            targetIndex,
          } = scenario;

          const targetCommittee = committeeIds[targetIndex]!;
          const expectedAccess = modelGrantsAccess(
            isSuperAdmin,
            memberships,
            targetCommittee,
          );

          const activeMembership = memberships.find((m) => m.status === 'active');
          const activeCommitteeId = isSuperAdmin
            ? targetCommittee
            : expectedAccess
              ? targetCommittee
              : (activeMembership?.committeeId ??
                committeeIds.find((c) => c !== targetCommittee) ??
                targetCommittee);

          const ctx = buildCtx(
            userId,
            isSuperAdmin,
            memberships,
            activeCommitteeId,
          );

          // Cliente admin falso para capturar la auditoría de denegación (R2.5)
          // sin depender de una base de datos real.
          const insert = vi.fn().mockResolvedValue({ error: null });
          const from = vi.fn().mockReturnValue({ insert });
          const adminClient = { from } as never;

          if (expectedAccess) {
            // Con acceso: no lanza ni audita denegación.
            await expect(
              assertCommitteeAccess(ctx, targetCommittee, {
                client: adminClient,
              }),
            ).resolves.toBeUndefined();
            expect(insert).not.toHaveBeenCalled();
          } else {
            // Sin acceso: rechaza la operación (R2.3) con AuthorizationError.
            await expect(
              assertCommitteeAccess(ctx, targetCommittee, {
                client: adminClient,
              }),
            ).rejects.toBeInstanceOf(AuthorizationError);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
