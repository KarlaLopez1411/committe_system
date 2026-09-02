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
  createMemberService,
  validateMemberName,
  validateMemberStatus,
  validateMemberPhone,
  validateMemberNotes,
  MEMBER_NAME_MAX,
  MEMBER_PHONE_MAX,
  MEMBER_NOTES_MAX,
  MEMBER_STATUSES,
  DEFAULT_MEMBER_STATUS,
} from './member-service';

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER_USER = '22222222-2222-2222-2222-222222222222';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER_MEMBER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const MEMBERSHIP = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    userId: USER,
    committeeId: COMMITTEE,
    permissions: ['members.create', 'users.manage'],
    isSuperAdmin: false,
    ...overrides,
  };
}

/**
 * Cliente Supabase simulado con enrutamiento por tabla. Registra inserciones y
 * actualizaciones por tabla para poder afirmar sobre ellas.
 *
 * - `insertedMemberId` / `insertError`: gobiernan `members.insert().select().single()`.
 * - `membershipRow` / `membershipReadError`: gobiernan
 *   `committee_users.select().eq().eq().maybeSingle()`.
 * - `linkUpdateError`: gobierna `committee_users.update().eq()`.
 */
function makeClient(
  opts: {
    insertedMemberId?: string;
    insertError?: { message: string } | null;
    membershipRow?: Record<string, unknown> | null;
    membershipReadError?: { message: string } | null;
    linkUpdateError?: { message: string } | null;
  } = {},
) {
  const calls = {
    memberInsert: [] as unknown[],
    membershipUpdate: [] as unknown[],
    auditInsert: [] as unknown[],
  };

  const from = vi.fn((table: string) => {
    if (table === 'members') {
      return {
        insert: vi.fn((row: unknown) => {
          calls.memberInsert.push(row);
          return {
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: opts.insertError
                    ? null
                    : { id: opts.insertedMemberId ?? MEMBER },
                  error: opts.insertError ?? null,
                }),
              ),
            })),
          };
        }),
      };
    }
    if (table === 'committee_users') {
      return {
        // select(...).eq('committee_id',..).eq('user_id',..).maybeSingle()
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data:
                    opts.membershipRow === undefined ? null : opts.membershipRow,
                  error: opts.membershipReadError ?? null,
                }),
              ),
            })),
          })),
        })),
        // update(...).eq('id', id)
        update: vi.fn((row: unknown) => {
          calls.membershipUpdate.push(row);
          return {
            eq: vi.fn(() =>
              Promise.resolve({ error: opts.linkUpdateError ?? null }),
            ),
          };
        }),
      };
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

// ── Validación de nombre (R7.1, R7.3) ─────────────────────────────────────────

describe('member: validación de nombre (R7.1, R7.3)', () => {
  it('acepta un nombre válido y lo devuelve recortado', () => {
    const r = validateMemberName('  Ana Pérez  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Ana Pérez');
  });

  it('rechaza nombre vacío', () => {
    const r = validateMemberName('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('fullName');
  });

  it('rechaza nombre compuesto solo de espacios', () => {
    const r = validateMemberName('     ');
    expect(r.ok).toBe(false);
  });

  it('rechaza nombre que excede 150 caracteres', () => {
    const r = validateMemberName('x'.repeat(MEMBER_NAME_MAX + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('fullName');
  });

  it('acepta nombre en el límite de 150 caracteres', () => {
    const r = validateMemberName('x'.repeat(MEMBER_NAME_MAX));
    expect(r.ok).toBe(true);
  });

  it('rechaza un valor no textual', () => {
    const r = validateMemberName(undefined);
    expect(r.ok).toBe(false);
  });
});

// ── Validación de estado (R7.2, R7.4) ─────────────────────────────────────────

describe('member: validación de estado (R7.2, R7.4)', () => {
  it('resuelve el estado por defecto `activo` cuando no se especifica', () => {
    for (const missing of [undefined, null, '']) {
      const r = validateMemberStatus(missing);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(DEFAULT_MEMBER_STATUS);
    }
    expect(DEFAULT_MEMBER_STATUS).toBe('activo');
  });

  it('acepta cada estado del conjunto {activo, inactivo, baja}', () => {
    for (const status of MEMBER_STATUSES) {
      const r = validateMemberStatus(status);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(status);
    }
  });

  it('rechaza un estado fuera del conjunto', () => {
    const r = validateMemberStatus('suspendido');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('status');
  });
});

// ── Validación de teléfono y notas (R7.5) ─────────────────────────────────────

describe('member: validación de teléfono y notas (R7.5)', () => {
  it('acepta teléfono nulo/ausente devolviendo null', () => {
    expect(validateMemberPhone(undefined)).toEqual({ ok: true, value: null });
    expect(validateMemberPhone(null)).toEqual({ ok: true, value: null });
    expect(validateMemberPhone('   ')).toEqual({ ok: true, value: null });
  });

  it('acepta teléfono en el límite de 30 caracteres', () => {
    const r = validateMemberPhone('9'.repeat(MEMBER_PHONE_MAX));
    expect(r.ok).toBe(true);
  });

  it('rechaza teléfono que excede 30 caracteres', () => {
    const r = validateMemberPhone('9'.repeat(MEMBER_PHONE_MAX + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('phone');
  });

  it('acepta notas en el límite de 500 caracteres', () => {
    const r = validateMemberNotes('n'.repeat(MEMBER_NOTES_MAX));
    expect(r.ok).toBe(true);
  });

  it('rechaza notas que exceden 500 caracteres', () => {
    const r = validateMemberNotes('n'.repeat(MEMBER_NOTES_MAX + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('notes');
  });
});

// ── register (R7.1–R7.5, R8.1) ────────────────────────────────────────────────

describe('member: register (R7.1–R7.5, R8.1)', () => {
  it('registra un miembro asociado al comité del contexto y asigna memberId', async () => {
    const { client, calls } = makeClient({ insertedMemberId: MEMBER });
    const service = createMemberService({ client });

    const r = await service.register(makeCtx(), {
      fullName: '  Ana Pérez  ',
      phone: '555-1234',
      notes: 'Miembro fundador',
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.memberId).toBe(MEMBER);

    const inserted = calls.memberInsert[0] as Record<string, unknown>;
    expect(inserted.full_name).toBe('Ana Pérez'); // recortado
    expect(inserted.committee_id).toBe(COMMITTEE); // asociado al comité (R7.1)
    expect(inserted.status).toBe('activo'); // default (R7.2)
    expect(inserted.phone).toBe('555-1234');
    expect(inserted.notes).toBe('Miembro fundador');
    expect(inserted.created_by).toBe(USER);
  });

  it('asigna el estado por defecto `activo` cuando no se especifica (R7.2)', async () => {
    const { client, calls } = makeClient();
    const service = createMemberService({ client });

    await service.register(makeCtx(), { fullName: 'Sin Estado' });
    expect((calls.memberInsert[0] as { status: string }).status).toBe('activo');
  });

  it('registra un miembro SIN cuenta de acceso asociada (R8.1)', async () => {
    const { client, calls } = makeClient();
    const service = createMemberService({ client });

    const r = await service.register(makeCtx(), { fullName: 'Sin Usuario' });
    expect(r.ok).toBe(true);
    // El alta de miembro no toca committee_users: es independiente del usuario.
    expect((calls.memberInsert[0] as Record<string, unknown>).full_name).toBe(
      'Sin Usuario',
    );
  });

  it('audita el alta atribuida al usuario', async () => {
    const { client, calls } = makeClient({ insertedMemberId: MEMBER });
    const service = createMemberService({ client });

    await service.register(makeCtx(), { fullName: 'Auditado' });

    expect(calls.auditInsert).toHaveLength(1);
    const audit = calls.auditInsert[0] as Record<string, unknown>;
    expect(audit.user_id).toBe(USER);
    expect(audit.action).toBe('member.create');
    expect(audit.entity_id).toBe(MEMBER);
  });

  it('rechaza nombre inválido sin insertar (conserva datos: R7.3)', async () => {
    const { client, calls } = makeClient();
    const service = createMemberService({ client });

    const r = await service.register(makeCtx(), { fullName: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('fullName');
    expect(calls.memberInsert).toHaveLength(0);
  });

  it('rechaza estado inválido sin insertar (R7.4)', async () => {
    const { client, calls } = makeClient();
    const service = createMemberService({ client });

    const r = await service.register(makeCtx(), {
      fullName: 'Con Estado Malo',
      status: 'suspendido',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('member/invalid-status');
    expect(calls.memberInsert).toHaveLength(0);
  });

  it('rechaza teléfono que excede el límite sin insertar (R7.5)', async () => {
    const { client, calls } = makeClient();
    const service = createMemberService({ client });

    const r = await service.register(makeCtx(), {
      fullName: 'Tel Largo',
      phone: '9'.repeat(MEMBER_PHONE_MAX + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('phone');
    expect(calls.memberInsert).toHaveLength(0);
  });

  it('rechaza notas que exceden el límite sin insertar (R7.5)', async () => {
    const { client, calls } = makeClient();
    const service = createMemberService({ client });

    const r = await service.register(makeCtx(), {
      fullName: 'Notas Largas',
      notes: 'n'.repeat(MEMBER_NOTES_MAX + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('notes');
    expect(calls.memberInsert).toHaveLength(0);
  });

  it('rechaza el registro sin permiso members.create', async () => {
    const { client, calls } = makeClient();
    const service = createMemberService({ client });

    const r = await service.register(makeCtx({ permissions: [] }), {
      fullName: 'Sin Permiso',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.memberInsert).toHaveLength(0);
  });

  it('devuelve error cuando la inserción falla', async () => {
    const { client } = makeClient({ insertError: { message: 'db down' } });
    const service = createMemberService({ client });

    const r = await service.register(makeCtx(), { fullName: 'Ana' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('member/create-failed');
  });
});

// ── linkUser: máx. 1 miembro por usuario (R8.2) ───────────────────────────────

describe('member: linkUser (R8.2)', () => {
  it('vincula el usuario con el miembro cuando la membresía no tiene miembro', async () => {
    const { client, calls } = makeClient({
      membershipRow: { id: MEMBERSHIP, member_id: null },
    });
    const service = createMemberService({ client });

    const r = await service.linkUser(makeCtx(), MEMBER, OTHER_USER);
    expect(r.ok).toBe(true);
    expect(calls.membershipUpdate).toHaveLength(1);
    expect((calls.membershipUpdate[0] as { member_id: string }).member_id).toBe(
      MEMBER,
    );
    // Audita el vínculo.
    expect((calls.auditInsert[0] as Record<string, unknown>).action).toBe(
      'member.link_user',
    );
  });

  it('rechaza vincular cuando el usuario ya está vinculado a OTRO miembro (R8.2)', async () => {
    const { client, calls } = makeClient({
      membershipRow: { id: MEMBERSHIP, member_id: OTHER_MEMBER },
    });
    const service = createMemberService({ client });

    const r = await service.linkUser(makeCtx(), MEMBER, OTHER_USER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('member/user-already-linked');
    expect(calls.membershipUpdate).toHaveLength(0);
  });

  it('es idempotente si el usuario ya está vinculado al MISMO miembro', async () => {
    const { client, calls } = makeClient({
      membershipRow: { id: MEMBERSHIP, member_id: MEMBER },
    });
    const service = createMemberService({ client });

    const r = await service.linkUser(makeCtx(), MEMBER, OTHER_USER);
    expect(r.ok).toBe(true);
    expect(calls.membershipUpdate).toHaveLength(0);
  });

  it('rechaza si el usuario no pertenece al comité activo', async () => {
    const { client, calls } = makeClient({ membershipRow: null });
    const service = createMemberService({ client });

    const r = await service.linkUser(makeCtx(), MEMBER, OTHER_USER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('member/user-not-member');
    expect(calls.membershipUpdate).toHaveLength(0);
  });

  it('rechaza sin permiso users.manage sin tocar datos', async () => {
    const { client, calls } = makeClient({
      membershipRow: { id: MEMBERSHIP, member_id: null },
    });
    const service = createMemberService({ client });

    const r = await service.linkUser(makeCtx({ permissions: [] }), MEMBER, OTHER_USER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.membershipUpdate).toHaveLength(0);
  });
});

// ── Garantía server-only ──────────────────────────────────────────────────────

describe('member: garantías server-only', () => {
  it("el código fuente empieza con `import 'server-only'`", () => {
    const source = readFileSync(join(__dirname, 'member-service.ts'), 'utf8');
    const firstStatement = source
      .split('\n')
      .find((line) => line.trim().length > 0);
    expect(firstStatement?.trim()).toBe("import 'server-only';");
  });
});
