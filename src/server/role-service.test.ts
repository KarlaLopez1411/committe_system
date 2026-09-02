import { describe, it, expect, vi, beforeEach } from 'vitest';

// `server-only` lanza fuera del runtime de servidor de Next.js; se neutraliza
// en pruebas (la garantía real la cubre la aserción de código fuente al final).
vi.mock('server-only', () => ({}));

// `next/headers` solo existe en runtime de servidor; se evita al cargar authz.
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { Ctx } from '@/domain/types';

import {
  createRoleService,
  isPredefinedRole,
  PREDEFINED_ROLE_KEYS,
} from './role-service';

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER = '11111111-1111-1111-1111-111111111111';
const TARGET = '22222222-2222-2222-2222-222222222222';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ROLE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_ROLE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    userId: USER,
    committeeId: COMMITTEE,
    permissions: ['users.manage'],
    isSuperAdmin: false,
    ...overrides,
  };
}

/**
 * Cliente Supabase simulado con enrutamiento por tabla para RoleService.
 *
 * Opciones:
 *  - `membershipRow`: fila devuelta por committee_users ... maybeSingle().
 *  - `membershipError`: error de la verificación de membresía.
 *  - `roleRow`: fila devuelta por roles ... maybeSingle().
 *  - `insertError`: error del upsert en user_roles.
 * Registra los upserts en `user_roles` y los inserts en `audit_logs`.
 */
function makeClient(
  opts: {
    membershipRow?: Record<string, unknown> | null;
    membershipError?: { message: string } | null;
    roleRow?: Record<string, unknown> | null;
    roleError?: { message: string } | null;
    insertError?: { message: string } | null;
    insertedUserRoleId?: string;
  } = {},
) {
  const calls = {
    userRolesUpsert: [] as unknown[],
    auditInsert: [] as unknown[],
  };

  const from = vi.fn((table: string) => {
    if (table === 'committee_users') {
      // select(...).eq().eq().eq().maybeSingle()
      const maybeSingle = vi.fn(() =>
        Promise.resolve({
          data: opts.membershipRow ?? null,
          error: opts.membershipError ?? null,
        }),
      );
      const eq3 = vi.fn(() => ({ maybeSingle }));
      const eq2 = vi.fn(() => ({ eq: eq3 }));
      const eq1 = vi.fn(() => ({ eq: eq2 }));
      const select = vi.fn(() => ({ eq: eq1 }));
      return { select };
    }
    if (table === 'roles') {
      // select(...).eq('key', roleKey).maybeSingle()
      const maybeSingle = vi.fn(() =>
        Promise.resolve({
          data:
            opts.roleRow === undefined
              ? { id: ROLE_ID }
              : opts.roleRow,
          error: opts.roleError ?? null,
        }),
      );
      const eq = vi.fn(() => ({ maybeSingle }));
      const select = vi.fn(() => ({ eq }));
      return { select };
    }
    if (table === 'user_roles') {
      // upsert(...).select('id').single()
      const upsert = vi.fn((row: unknown) => {
        calls.userRolesUpsert.push(row);
        return {
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: opts.insertError
                  ? null
                  : { id: opts.insertedUserRoleId ?? USER_ROLE_ID },
                error: opts.insertError ?? null,
              }),
            ),
          })),
        };
      });
      return { upsert };
    }
    if (table === 'audit_logs') {
      return {
        insert: vi.fn((row: unknown) => {
          calls.auditInsert.push(row);
          return Promise.resolve({ error: null });
        }),
      };
    }
    throw new Error(`tabla no simulada: ${table}`);
  });

  return { client: { from } as never, calls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── isPredefinedRole (R5.1, R5.3) ─────────────────────────────────────────────

describe('role: isPredefinedRole (R5.1, R5.3)', () => {
  it('reconoce las 9 claves predefinidas', () => {
    expect(PREDEFINED_ROLE_KEYS).toHaveLength(9);
    for (const key of PREDEFINED_ROLE_KEYS) {
      expect(isPredefinedRole(key)).toBe(true);
    }
  });

  it('rechaza claves fuera del catálogo', () => {
    expect(isPredefinedRole('root')).toBe(false);
    expect(isPredefinedRole('admin')).toBe(false);
    expect(isPredefinedRole('')).toBe(false);
    expect(isPredefinedRole(undefined)).toBe(false);
    expect(isPredefinedRole(123)).toBe(false);
  });
});

// ── assignRole: caso válido (R5.1, R5.2, R5.4) ────────────────────────────────

describe('role: assignRole asignación válida (R5.1, R5.2, R5.4)', () => {
  it('registra user_roles vinculado al committee_id y devuelve el id', async () => {
    const { client, calls } = makeClient({
      membershipRow: { id: 'membership-1' },
      roleRow: { id: ROLE_ID },
    });
    const service = createRoleService({ client });

    const r = await service.assignRole(makeCtx(), TARGET, 'treasurer');

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.userRoleId).toBe(USER_ROLE_ID);

    // La asignación se vinculó al comité activo y al usuario/rol correctos (R5.2).
    expect(calls.userRolesUpsert).toHaveLength(1);
    const row = calls.userRolesUpsert[0] as Record<string, unknown>;
    expect(row.committee_id).toBe(COMMITTEE);
    expect(row.user_id).toBe(TARGET);
    expect(row.role_id).toBe(ROLE_ID);
  });

  it('audita la asignación atribuida al usuario que la realiza (R36.1)', async () => {
    const { client, calls } = makeClient({
      membershipRow: { id: 'membership-1' },
      roleRow: { id: ROLE_ID },
    });
    const service = createRoleService({ client });

    await service.assignRole(makeCtx(), TARGET, 'secretary');

    expect(calls.auditInsert).toHaveLength(1);
    const audit = calls.auditInsert[0] as Record<string, unknown>;
    expect(audit.user_id).toBe(USER);
    expect(audit.action).toBe('user_role.assign');
    expect(audit.committee_id).toBe(COMMITTEE);
    expect(audit.entity_type).toBe('user_role');
  });

  it('acepta cada uno de los 9 roles predefinidos', async () => {
    for (const key of PREDEFINED_ROLE_KEYS) {
      const { client } = makeClient({
        membershipRow: { id: 'membership-1' },
        roleRow: { id: ROLE_ID },
      });
      const service = createRoleService({ client });
      const r = await service.assignRole(makeCtx(), TARGET, key);
      expect(r.ok).toBe(true);
    }
  });
});

// ── assignRole: rol inválido (R5.1, R5.3) ─────────────────────────────────────

describe('role: assignRole rechazo de rol inválido (R5.1, R5.3)', () => {
  it('rechaza un rol fuera de los 9 predefinidos sin registrar cambios', async () => {
    const { client, calls } = makeClient({ membershipRow: { id: 'membership-1' } });
    const service = createRoleService({ client });

    const r = await service.assignRole(makeCtx(), TARGET, 'root');

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('role/invalid-role');
      expect(r.error.field).toBe('roleKey');
      expect(r.error.message).toMatch(/no es válido/);
    }
    expect(calls.userRolesUpsert).toHaveLength(0);
    expect(calls.auditInsert).toHaveLength(0);
  });
});

// ── assignRole: no miembro activo (R5.4) ──────────────────────────────────────

describe('role: assignRole rechazo de no miembro (R5.4)', () => {
  it('rechaza cuando el usuario no es miembro activo del comité sin registrar cambios', async () => {
    const { client, calls } = makeClient({ membershipRow: null });
    const service = createRoleService({ client });

    const r = await service.assignRole(makeCtx(), TARGET, 'treasurer');

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('role/not-a-member');
      expect(r.error.message).toMatch(/no es miembro del comité/);
    }
    expect(calls.userRolesUpsert).toHaveLength(0);
    expect(calls.auditInsert).toHaveLength(0);
  });

  it('devuelve error si la verificación de membresía falla', async () => {
    const { client } = makeClient({ membershipError: { message: 'db down' } });
    const service = createRoleService({ client });

    const r = await service.assignRole(makeCtx(), TARGET, 'treasurer');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('role/membership-check-failed');
  });
});

// ── assignRole: falta users.manage (R5.x) ─────────────────────────────────────

describe('role: assignRole rechazo sin permiso users.manage', () => {
  it('rechaza cuando el contexto no tiene users.manage sin tocar datos', async () => {
    const { client, calls } = makeClient({ membershipRow: { id: 'membership-1' } });
    const service = createRoleService({ client });

    const r = await service.assignRole(
      makeCtx({ permissions: ['members.read'] }),
      TARGET,
      'treasurer',
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.userRolesUpsert).toHaveLength(0);
    expect(calls.auditInsert).toHaveLength(0);
  });

  it('el superadministrador puede asignar roles aun sin el permiso explícito', async () => {
    const { client } = makeClient({
      membershipRow: { id: 'membership-1' },
      roleRow: { id: ROLE_ID },
    });
    const service = createRoleService({ client });

    const r = await service.assignRole(
      makeCtx({ permissions: [], isSuperAdmin: true }),
      TARGET,
      'president',
    );
    expect(r.ok).toBe(true);
  });
});

// ── Garantía server-only ──────────────────────────────────────────────────────

describe('role: garantías server-only', () => {
  it("el código fuente empieza con `import 'server-only'`", () => {
    const source = readFileSync(join(__dirname, 'role-service.ts'), 'utf8');
    const firstStatement = source
      .split('\n')
      .find((line) => line.trim().length > 0);
    expect(firstStatement?.trim()).toBe("import 'server-only';");
  });
});
