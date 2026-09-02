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
  createFinanceService,
  validateAccountName,
  validateAccountType,
  ACCOUNT_TYPES,
  ACCOUNT_NAME_MAX,
} from './finance-service';

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER = '11111111-1111-1111-1111-111111111111';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_COMMITTEE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ACCOUNT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    userId: USER,
    committeeId: COMMITTEE,
    permissions: ['committee.manage'],
    isSuperAdmin: false,
    ...overrides,
  };
}

/**
 * Cliente Supabase simulado con enrutamiento por tabla. Registra las
 * inserciones/actualizaciones por tabla para poder afirmar sobre ellas.
 *
 * - `insertError`: error simulado al insertar en `financial_accounts`
 *   (usar `{ code: '23505' }` para simular nombre duplicado).
 * - `accountRow`: fila devuelta por `select().eq().single()` sobre
 *   `financial_accounts` (para lecturas previas de estado/pertenencia).
 * - `readError` / `updateError`: errores simulados de lectura/actualización.
 */
function makeClient(
  opts: {
    insertedAccountId?: string;
    insertError?: { message?: string; code?: string } | null;
    accountRow?: Record<string, unknown> | null;
    readError?: { message: string } | null;
    updateError?: { message: string } | null;
  } = {},
) {
  const calls = {
    accountInsert: [] as unknown[],
    accountUpdate: [] as unknown[],
    auditInsert: [] as unknown[],
  };

  const from = vi.fn((table: string) => {
    if (table === 'audit_logs') {
      return {
        insert: vi.fn((row: unknown) => {
          calls.auditInsert.push(row);
          return Promise.resolve({ error: null });
        }),
      };
    }
    if (table === 'financial_accounts') {
      return {
        // insert(...).select('id').single()
        insert: vi.fn((row: unknown) => {
          calls.accountInsert.push(row);
          return {
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: opts.insertError
                    ? null
                    : { id: opts.insertedAccountId ?? ACCOUNT },
                  error: opts.insertError ?? null,
                }),
              ),
            })),
          };
        }),
        // select(...).eq('id', id).single()
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: opts.accountRow ?? null,
                error: opts.readError ?? null,
              }),
            ),
          })),
        })),
        // update(...).eq('id', id).eq('committee_id', committeeId)
        update: vi.fn((row: unknown) => {
          calls.accountUpdate.push(row);
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: opts.updateError ?? null })),
            })),
          };
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

// ── Validación de nombre (R9.1, R9.2) ─────────────────────────────────────────

describe('finance: validación de nombre de cuenta (R9.1, R9.2)', () => {
  it('acepta un nombre válido y lo devuelve recortado', () => {
    const r = validateAccountName('  Caja General  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Caja General');
  });

  it('rechaza nombre vacío', () => {
    const r = validateAccountName('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
  });

  it('rechaza nombre compuesto solo de espacios', () => {
    const r = validateAccountName('     ');
    expect(r.ok).toBe(false);
  });

  it('rechaza nombre que excede 80 caracteres', () => {
    const r = validateAccountName('x'.repeat(ACCOUNT_NAME_MAX + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
  });

  it('acepta nombre en el límite de 80 caracteres', () => {
    const r = validateAccountName('x'.repeat(ACCOUNT_NAME_MAX));
    expect(r.ok).toBe(true);
  });

  it('rechaza un valor no textual', () => {
    const r = validateAccountName(undefined);
    expect(r.ok).toBe(false);
  });
});

// ── Validación de tipo (R9.1, R9.2) ───────────────────────────────────────────

describe('finance: validación de tipo de cuenta (R9.1, R9.2)', () => {
  it('acepta todos los tipos del conjunto permitido', () => {
    for (const type of ACCOUNT_TYPES) {
      const r = validateAccountType(type);
      expect(r.ok).toBe(true);
    }
  });

  it('rechaza un tipo fuera del conjunto permitido', () => {
    const r = validateAccountType('cuenta_inventada');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('type');
  });

  it('rechaza un valor no textual', () => {
    const r = validateAccountType(undefined);
    expect(r.ok).toBe(false);
  });
});

// ── createAccount (R9.1, R9.2) ────────────────────────────────────────────────

describe('finance: createAccount (R9.1, R9.2)', () => {
  it('crea la cuenta activa asociada al comité del usuario y devuelve su id', async () => {
    const { client, calls } = makeClient({ insertedAccountId: ACCOUNT });
    const service = createFinanceService({ client });

    const r = await service.createAccount(makeCtx(), {
      name: '  Caja General  ',
      type: 'caja_general',
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.accountId).toBe(ACCOUNT);

    const inserted = calls.accountInsert[0] as Record<string, unknown>;
    expect(inserted.name).toBe('Caja General'); // recortado
    expect(inserted.type).toBe('caja_general');
    expect(inserted.committee_id).toBe(COMMITTEE); // asociada al comité del usuario
    expect(inserted.status).toBe('active'); // estado inicial activa
  });

  it('audita la creación atribuida al usuario', async () => {
    const { client, calls } = makeClient({ insertedAccountId: ACCOUNT });
    const service = createFinanceService({ client });

    await service.createAccount(makeCtx(), {
      name: 'Cuenta Bancaria',
      type: 'cuenta_bancaria',
    });

    expect(calls.auditInsert).toHaveLength(1);
    const audit = calls.auditInsert[0] as Record<string, unknown>;
    expect(audit.user_id).toBe(USER);
    expect(audit.action).toBe('account.create');
    expect(audit.committee_id).toBe(COMMITTEE);
    expect(audit.entity_id).toBe(ACCOUNT);
  });

  it('rechaza la creación sin permiso committee.manage sin insertar', async () => {
    const { client, calls } = makeClient();
    const service = createFinanceService({ client });

    const r = await service.createAccount(makeCtx({ permissions: [] }), {
      name: 'Sin Permiso',
      type: 'otra',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.accountInsert).toHaveLength(0);
  });

  it('rechaza nombre vacío sin insertar', async () => {
    const { client, calls } = makeClient();
    const service = createFinanceService({ client });

    const r = await service.createAccount(makeCtx(), {
      name: '   ',
      type: 'caja_general',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
    expect(calls.accountInsert).toHaveLength(0);
  });

  it('rechaza nombre que excede 80 caracteres sin insertar', async () => {
    const { client, calls } = makeClient();
    const service = createFinanceService({ client });

    const r = await service.createAccount(makeCtx(), {
      name: 'x'.repeat(ACCOUNT_NAME_MAX + 1),
      type: 'caja_general',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('account/invalid-name');
    expect(calls.accountInsert).toHaveLength(0);
  });

  it('rechaza tipo inválido sin insertar', async () => {
    const { client, calls } = makeClient();
    const service = createFinanceService({ client });

    const r = await service.createAccount(makeCtx(), {
      name: 'Cuenta',
      type: 'cuenta_inventada' as never,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('account/invalid-type');
    expect(calls.accountInsert).toHaveLength(0);
  });

  it('rechaza nombre duplicado dentro del mismo comité (UNIQUE) sin crear la cuenta', async () => {
    const { client } = makeClient({ insertError: { code: '23505', message: 'dup' } });
    const service = createFinanceService({ client });

    const r = await service.createAccount(makeCtx(), {
      name: 'Caja General',
      type: 'caja_general',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('account/duplicate-name');
      expect(r.error.field).toBe('name');
    }
  });

  it('devuelve error genérico cuando la inserción falla por otra causa', async () => {
    const { client } = makeClient({ insertError: { message: 'db down' } });
    const service = createFinanceService({ client });

    const r = await service.createAccount(makeCtx(), {
      name: 'Caja General',
      type: 'caja_general',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('account/create-failed');
  });

  it('el superadministrador puede crear cuentas aunque no tenga el permiso explícito', async () => {
    const { client, calls } = makeClient({ insertedAccountId: ACCOUNT });
    const service = createFinanceService({ client });

    const r = await service.createAccount(
      makeCtx({ permissions: [], isSuperAdmin: true }),
      { name: 'Caja Super', type: 'otra' },
    );

    expect(r.ok).toBe(true);
    expect(calls.accountInsert).toHaveLength(1);
  });
});

// ── deactivateAccount (R9.3) ──────────────────────────────────────────────────

describe('finance: deactivateAccount (R9.3)', () => {
  it('marca la cuenta como inactiva y audita old→new (conserva historial)', async () => {
    const { client, calls } = makeClient({
      accountRow: { status: 'active', committee_id: COMMITTEE },
    });
    const service = createFinanceService({ client });

    const r = await service.deactivateAccount(makeCtx(), ACCOUNT);

    expect(r.ok).toBe(true);
    // Se actualizó únicamente el estado; no se elimina la cuenta ni el ledger.
    expect(calls.accountUpdate).toHaveLength(1);
    expect((calls.accountUpdate[0] as { status: string }).status).toBe('inactive');

    const audit = calls.auditInsert[0] as Record<string, unknown>;
    expect(audit.action).toBe('account.deactivate');
    expect(audit.user_id).toBe(USER);
    expect((audit.old_values as { status: string }).status).toBe('active');
    expect((audit.new_values as { status: string }).status).toBe('inactive');
  });

  it('rechaza sin permiso committee.manage sin actualizar', async () => {
    const { client, calls } = makeClient({
      accountRow: { status: 'active', committee_id: COMMITTEE },
    });
    const service = createFinanceService({ client });

    const r = await service.deactivateAccount(makeCtx({ permissions: [] }), ACCOUNT);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.accountUpdate).toHaveLength(0);
  });

  it('devuelve not-found cuando la cuenta no existe', async () => {
    const { client, calls } = makeClient({ accountRow: null });
    const service = createFinanceService({ client });

    const r = await service.deactivateAccount(makeCtx(), ACCOUNT);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('account/not-found');
    expect(calls.accountUpdate).toHaveLength(0);
  });

  it('rechaza desactivar una cuenta de un comité ajeno sin actualizar (R2.3)', async () => {
    const { client, calls } = makeClient({
      accountRow: { status: 'active', committee_id: OTHER_COMMITTEE },
    });
    const service = createFinanceService({ client });

    const r = await service.deactivateAccount(makeCtx(), ACCOUNT);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.accountUpdate).toHaveLength(0);
  });

  it('devuelve error cuando la actualización falla', async () => {
    const { client } = makeClient({
      accountRow: { status: 'active', committee_id: COMMITTEE },
      updateError: { message: 'db down' },
    });
    const service = createFinanceService({ client });

    const r = await service.deactivateAccount(makeCtx(), ACCOUNT);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('account/update-failed');
  });
});

// ── Garantía server-only ──────────────────────────────────────────────────────

describe('finance: garantías server-only', () => {
  it("el código fuente empieza con `import 'server-only'`", () => {
    const source = readFileSync(join(__dirname, 'finance-service.ts'), 'utf8');
    const firstStatement = source
      .split('\n')
      .find((line) => line.trim().length > 0);
    expect(firstStatement?.trim()).toBe("import 'server-only';");
  });
});
