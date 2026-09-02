import { describe, it, expect, vi } from 'vitest';

import type { Ctx } from '@/domain/types';

// `server-only` lanza fuera del entorno de servidor de Next.js; se neutraliza en
// pruebas. La garantía real (fallo de compilación en el cliente) la cubre la
// aserción de código fuente al final del archivo.
vi.mock('server-only', () => ({}));

// `next/headers` solo existe en runtime de servidor de Next.js.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  effectivePermissions,
  can,
  hasCommitteeAccess,
  assertCommitteeAccess,
  recordDeniedAccess,
  AuthorizationError,
  AUTHZ_ERROR_CODE,
} from './authz';

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER = '11111111-1111-1111-1111-111111111111';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_COMMITTEE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    userId: USER,
    committeeId: COMMITTEE,
    permissions: [],
    isSuperAdmin: false,
    ...overrides,
  };
}

/**
 * Cliente Supabase falso mínimo para `effectivePermissions`.
 * `rows` es la respuesta anidada que devolvería PostgREST para el select
 * `roles(role_permissions(permissions(key)))`.
 */
function makeQueryClient(rows: unknown[] | null, error: { message: string } | null = null) {
  const eqUser = vi.fn();
  const eqCommittee = vi.fn();

  // Cadena: from().select().eq().eq() -> resuelve a { data, error }
  const secondEq = vi.fn().mockResolvedValue({ data: rows, error });
  eqCommittee.mockImplementation(secondEq);
  const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
  eqUser.mockImplementation(firstEq);
  const select = vi.fn().mockReturnValue({ eq: firstEq });
  const from = vi.fn().mockReturnValue({ select });

  return {
    client: { from } as never,
    spies: { from, select, firstEq, secondEq },
  };
}

/** Fila anidada con un permiso, en forma de objeto (relación 1:1 de PostgREST). */
function roleWithPermissions(...keys: string[]) {
  return {
    roles: {
      role_permissions: keys.map((key) => ({ permissions: { key } })),
    },
  };
}

describe('authz: effectivePermissions (R6.3)', () => {
  it('devuelve la UNIÓN de permisos de todos los roles del usuario en el comité', async () => {
    const rows = [
      roleWithPermissions('members.read', 'transactions.read'),
      roleWithPermissions('transactions.read', 'transactions.create'),
    ];
    const { client } = makeQueryClient(rows);

    const perms = await effectivePermissions(USER, COMMITTEE, client);

    // Unión deduplicada y ordenada.
    expect(perms).toEqual([
      'members.read',
      'transactions.create',
      'transactions.read',
    ]);
  });

  it('devuelve lista vacía cuando el usuario no tiene roles en el comité', async () => {
    const { client } = makeQueryClient([]);
    const perms = await effectivePermissions(USER, COMMITTEE, client);
    expect(perms).toEqual([]);
  });

  it('filtra la consulta por user_id y committee_id', async () => {
    const { client, spies } = makeQueryClient([]);
    await effectivePermissions(USER, COMMITTEE, client);

    expect(spies.from).toHaveBeenCalledWith('user_roles');
    expect(spies.firstEq).toHaveBeenCalledWith('user_id', USER);
    expect(spies.secondEq).toHaveBeenCalledWith('committee_id', COMMITTEE);
  });

  it('maneja relaciones devueltas como arreglos (forma alternativa de PostgREST)', async () => {
    const rows = [
      {
        roles: [
          {
            role_permissions: [
              { permissions: [{ key: 'audit.read' }] },
              { permissions: [{ key: 'reports.read' }] },
            ],
          },
        ],
      },
    ];
    const { client } = makeQueryClient(rows);
    const perms = await effectivePermissions(USER, COMMITTEE, client);
    expect(perms).toEqual(['audit.read', 'reports.read']);
  });

  it('lanza si la consulta falla', async () => {
    const { client } = makeQueryClient(null, { message: 'boom' });
    await expect(effectivePermissions(USER, COMMITTEE, client)).rejects.toThrow(
      /permisos efectivos: boom/,
    );
  });
});

describe('authz: can (R6.2, R2.6)', () => {
  it('concede cuando el permiso está en los permisos efectivos', () => {
    const ctx = makeCtx({ permissions: ['transactions.create'] });
    expect(can(ctx, 'transactions.create')).toBe(true);
  });

  it('deniega cuando falta el permiso', () => {
    const ctx = makeCtx({ permissions: ['transactions.read'] });
    expect(can(ctx, 'transactions.create')).toBe(false);
  });

  it('el superadministrador está autorizado para cualquier permiso', () => {
    const ctx = makeCtx({ isSuperAdmin: true, permissions: [] });
    expect(can(ctx, 'committee.manage')).toBe(true);
    expect(can(ctx, 'transactions.void')).toBe(true);
  });

  it('el auditor (solo lectura) es denegado en operaciones de escritura (R5.5, R5.6)', () => {
    // Permisos efectivos sembrados para el rol auditor.
    const auditor = makeCtx({
      permissions: [
        'members.read',
        'transactions.read',
        'bonuses.read',
        'reports.read',
        'audit.read',
      ],
    });
    // Lectura permitida.
    expect(can(auditor, 'transactions.read')).toBe(true);
    expect(can(auditor, 'audit.read')).toBe(true);
    // Escritura denegada por ausencia del permiso, sin caso especial en código.
    expect(can(auditor, 'members.create')).toBe(false);
    expect(can(auditor, 'transactions.create')).toBe(false);
    expect(can(auditor, 'transactions.void')).toBe(false);
    expect(can(auditor, 'cash_closings.close')).toBe(false);
  });
});

describe('authz: hasCommitteeAccess (R2.3, R2.6)', () => {
  it('concede acceso al comité activo del contexto', () => {
    expect(hasCommitteeAccess(makeCtx(), COMMITTEE)).toBe(true);
  });

  it('deniega acceso a un comité ajeno', () => {
    expect(hasCommitteeAccess(makeCtx(), OTHER_COMMITTEE)).toBe(false);
  });

  it('el superadministrador accede a cualquier comité', () => {
    const ctx = makeCtx({ isSuperAdmin: true });
    expect(hasCommitteeAccess(ctx, OTHER_COMMITTEE)).toBe(true);
  });
});

describe('authz: recordDeniedAccess (R2.5)', () => {
  it('inserta en audit_logs con usuario, comité objetivo y acción de denegación', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const adminClient = { from } as never;

    await recordDeniedAccess(makeCtx(), OTHER_COMMITTEE, { client: adminClient });

    expect(from).toHaveBeenCalledWith('audit_logs');
    expect(insert).toHaveBeenCalledTimes(1);
    const payload = insert.mock.calls[0]![0];
    expect(payload.committee_id).toBe(OTHER_COMMITTEE);
    expect(payload.user_id).toBe(USER);
    expect(payload.entity_id).toBe(OTHER_COMMITTEE);
    expect(payload.action).toBe('access.denied');
  });

  it('no propaga errores de auditoría (registra por consola)', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'db down' } });
    const from = vi.fn().mockReturnValue({ insert });
    const adminClient = { from } as never;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      recordDeniedAccess(makeCtx(), OTHER_COMMITTEE, { client: adminClient }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('authz: assertCommitteeAccess (R2.3, R2.5, R2.6)', () => {
  it('no lanza ni audita cuando el comité coincide con el activo', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const adminClient = { from } as never;

    await expect(
      assertCommitteeAccess(makeCtx(), COMMITTEE, { client: adminClient }),
    ).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it('lanza AuthorizationError y AUDITA el intento denegado sobre un comité ajeno', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const adminClient = { from } as never;

    await expect(
      assertCommitteeAccess(makeCtx(), OTHER_COMMITTEE, { client: adminClient }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // Se registró exactamente un intento denegado con el comité objetivo.
    expect(from).toHaveBeenCalledWith('audit_logs');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]![0].committee_id).toBe(OTHER_COMMITTEE);
  });

  it('el superadministrador no genera auditoría de denegación en comités ajenos', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const adminClient = { from } as never;

    await expect(
      assertCommitteeAccess(makeCtx({ isSuperAdmin: true }), OTHER_COMMITTEE, {
        client: adminClient,
      }),
    ).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it('AuthorizationError expone el código estable AUTHZ_FORBIDDEN', () => {
    const e = new AuthorizationError('x');
    expect(e.code).toBe(AUTHZ_ERROR_CODE);
    expect(AUTHZ_ERROR_CODE).toBe('AUTHZ_FORBIDDEN');
  });
});

describe('authz: garantías server-only', () => {
  it("el código fuente empieza con `import 'server-only'`", () => {
    const source = readFileSync(join(__dirname, 'authz.ts'), 'utf8');
    const firstStatement = source
      .split('\n')
      .find((line) => line.trim().length > 0);
    expect(firstStatement?.trim()).toBe("import 'server-only';");
  });

  it('la auditoría de accesos denegados usa el cliente admin (service_role)', () => {
    const source = readFileSync(join(__dirname, 'authz.ts'), 'utf8');
    expect(source).toContain('createSupabaseAdminClient');
  });
});
