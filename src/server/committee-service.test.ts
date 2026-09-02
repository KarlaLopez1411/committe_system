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
  createCommitteeService,
  validateCommitteeName,
  DEFAULT_CATEGORIES,
  COMMITTEE_NAME_MAX,
  CONFIG_TEXT_MAX,
} from './committee-service';

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER = '11111111-1111-1111-1111-111111111111';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_COMMITTEE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

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
 * Cliente Supabase simulado con enrutamiento por tabla. Registra todas las
 * inserciones/actualizaciones/upserts por tabla para poder afirmar sobre ellas.
 *
 * `committeeRow` es la fila que devuelve un `select().single()` sobre
 * `committees` (para lecturas de estado/config previas).
 */
function makeClient(
  opts: {
    insertedCommitteeId?: string;
    insertError?: { message: string } | null;
    committeeRow?: Record<string, unknown> | null;
    readError?: { message: string } | null;
    updateError?: { message: string } | null;
  } = {},
) {
  const calls = {
    categoriesUpsert: [] as unknown[],
    committeeInsert: [] as unknown[],
    committeeUpdate: [] as unknown[],
    auditInsert: [] as unknown[],
  };

  const from = vi.fn((table: string) => {
    if (table === 'transaction_categories') {
      return {
        upsert: vi.fn((rows: unknown) => {
          calls.categoriesUpsert.push(rows);
          return Promise.resolve({ error: null });
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
    if (table === 'committees') {
      return {
        // insert(...).select('id').single()
        insert: vi.fn((row: unknown) => {
          calls.committeeInsert.push(row);
          return {
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: opts.insertError
                    ? null
                    : { id: opts.insertedCommitteeId ?? COMMITTEE },
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
                data: opts.committeeRow ?? null,
                error: opts.readError ?? null,
              }),
            ),
          })),
        })),
        // update(...).eq('id', id)
        update: vi.fn((row: unknown) => {
          calls.committeeUpdate.push(row);
          return {
            eq: vi.fn(() => Promise.resolve({ error: opts.updateError ?? null })),
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

// ── Validación de nombre (R1.2) ───────────────────────────────────────────────

describe('committee: validación de nombre (R1.2)', () => {
  it('acepta un nombre válido y lo devuelve recortado', () => {
    const r = validateCommitteeName('  Comité Vecinal  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Comité Vecinal');
  });

  it('rechaza nombre vacío', () => {
    const r = validateCommitteeName('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
  });

  it('rechaza nombre compuesto solo de espacios', () => {
    const r = validateCommitteeName('     ');
    expect(r.ok).toBe(false);
  });

  it('rechaza nombre que excede 150 caracteres', () => {
    const r = validateCommitteeName('x'.repeat(COMMITTEE_NAME_MAX + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
  });

  it('acepta nombre en el límite de 150 caracteres', () => {
    const r = validateCommitteeName('x'.repeat(COMMITTEE_NAME_MAX));
    expect(r.ok).toBe(true);
  });

  it('rechaza un valor no textual', () => {
    const r = validateCommitteeName(undefined);
    expect(r.ok).toBe(false);
  });
});

// ── create + siembra de categorías (R1.1–R1.3, R13.2) ─────────────────────────

describe('committee: create y seedDefaultCategories (R1.1–R1.3, R13.2)', () => {
  it('crea el comité, asigna committee_id y siembra las 7 categorías iniciales', async () => {
    const { client, calls } = makeClient({ insertedCommitteeId: COMMITTEE });
    const service = createCommitteeService({ client });

    const r = await service.create(makeCtx(), { name: 'Comité Nuevo' });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.committeeId).toBe(COMMITTEE);

    // El nombre se persistió recortado.
    expect((calls.committeeInsert[0] as { name: string }).name).toBe('Comité Nuevo');

    // Se sembraron exactamente las 7 categorías iniciales del comité creado.
    const upserted = calls.categoriesUpsert[0] as Array<{
      committee_id: string;
      name: string;
    }>;
    expect(upserted.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES]);
    expect(upserted.every((c) => c.committee_id === COMMITTEE)).toBe(true);
    expect(DEFAULT_CATEGORIES).toHaveLength(7);
  });

  it('audita la creación atribuida al usuario', async () => {
    const { client, calls } = makeClient({ insertedCommitteeId: COMMITTEE });
    const service = createCommitteeService({ client });

    await service.create(makeCtx(), { name: 'Comité Auditado' });

    expect(calls.auditInsert).toHaveLength(1);
    const audit = calls.auditInsert[0] as Record<string, unknown>;
    expect(audit.user_id).toBe(USER);
    expect(audit.action).toBe('committee.create');
    expect(audit.committee_id).toBe(COMMITTEE);
  });

  it('rechaza la creación con nombre inválido sin insertar', async () => {
    const { client, calls } = makeClient();
    const service = createCommitteeService({ client });

    const r = await service.create(makeCtx(), { name: '   ' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
    expect(calls.committeeInsert).toHaveLength(0);
    expect(calls.categoriesUpsert).toHaveLength(0);
  });

  it('rechaza la creación sin permiso committee.manage', async () => {
    const { client, calls } = makeClient();
    const service = createCommitteeService({ client });

    const r = await service.create(makeCtx({ permissions: [] }), {
      name: 'Comité Sin Permiso',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.committeeInsert).toHaveLength(0);
  });

  it('devuelve error cuando la inserción del comité falla', async () => {
    const { client } = makeClient({ insertError: { message: 'db down' } });
    const service = createCommitteeService({ client });

    const r = await service.create(makeCtx(), { name: 'Comité' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('committee/create-failed');
  });

  it('seedDefaultCategories usa upsert idempotente por (committee_id, name)', async () => {
    const { client, calls } = makeClient();
    const service = createCommitteeService({ client });

    await service.seedDefaultCategories(COMMITTEE);
    const rows = calls.categoriesUpsert[0] as unknown[];
    expect(rows).toHaveLength(7);
  });
});

// ── updateStatus (R1.4) ───────────────────────────────────────────────────────

describe('committee: updateStatus (R1.4)', () => {
  it('actualiza el estado y audita old→new con el usuario', async () => {
    const { client, calls } = makeClient({ committeeRow: { status: 'active' } });
    const service = createCommitteeService({ client });

    const r = await service.updateStatus(makeCtx(), COMMITTEE, 'inactive');

    expect(r.ok).toBe(true);
    expect((calls.committeeUpdate[0] as { status: string }).status).toBe('inactive');
    const audit = calls.auditInsert[0] as Record<string, unknown>;
    expect(audit.action).toBe('committee.status.update');
    expect(audit.user_id).toBe(USER);
    expect((audit.old_values as { status: string }).status).toBe('active');
    expect((audit.new_values as { status: string }).status).toBe('inactive');
  });

  it('rechaza un estado inválido sin actualizar', async () => {
    const { client, calls } = makeClient({ committeeRow: { status: 'active' } });
    const service = createCommitteeService({ client });

    const r = await service.updateStatus(
      makeCtx(),
      COMMITTEE,
      'archivado' as never,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('committee/invalid-status');
    expect(calls.committeeUpdate).toHaveLength(0);
  });

  it('rechaza cambiar el estado de un comité ajeno (R2.3)', async () => {
    const { client, calls } = makeClient({ committeeRow: { status: 'active' } });
    const service = createCommitteeService({ client });

    const r = await service.updateStatus(makeCtx(), OTHER_COMMITTEE, 'inactive');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.committeeUpdate).toHaveLength(0);
  });
});

// ── updateConfig: alcance, autorización y validación (R3.1–R3.4) ──────────────

describe('committee: updateConfig alcance y autorización (R3.1–R3.3)', () => {
  const prevRow = {
    name: 'Comité A',
    locality: 'Centro',
    phone: null,
    email: null,
    finance_settings: {},
    bonus_settings: {},
    settings: {},
  };

  it('aplica el cambio SOLO al comité del administrador (filtro por id)', async () => {
    const { client, calls } = makeClient({ committeeRow: prevRow });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), COMMITTEE, {
      name: 'Comité A Renombrado',
    });

    expect(r.ok).toBe(true);
    // Exactamente una actualización, dirigida al comité propio.
    expect(calls.committeeUpdate).toHaveLength(1);
    expect((calls.committeeUpdate[0] as { name: string }).name).toBe(
      'Comité A Renombrado',
    );
    // Auditoría del cambio de configuración.
    expect((calls.auditInsert[0] as Record<string, unknown>).action).toBe(
      'committee.config.update',
    );
  });

  it('rechaza modificar la configuración de un comité ajeno sin tocar datos (R3.3)', async () => {
    const { client, calls } = makeClient({ committeeRow: prevRow });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), OTHER_COMMITTEE, {
      name: 'Intruso',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.committeeUpdate).toHaveLength(0);
  });

  it('rechaza sin permiso committee.manage como acceso no autorizado (R3.3)', async () => {
    const { client, calls } = makeClient({ committeeRow: prevRow });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx({ permissions: [] }), COMMITTEE, {
      name: 'X',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.committeeUpdate).toHaveLength(0);
  });

  it('solo incluye en el update los campos presentes, preservando los demás (R3.2)', async () => {
    const { client, calls } = makeClient({ committeeRow: prevRow });
    const service = createCommitteeService({ client });

    await service.updateConfig(makeCtx(), COMMITTEE, { locality: 'Norte' });
    const update = calls.committeeUpdate[0] as Record<string, unknown>;
    expect(Object.keys(update)).toEqual(['locality']);
    expect(update.locality).toBe('Norte');
  });
});

describe('committee: updateConfig validación de valores (R3.4)', () => {
  const prevRow = {
    name: 'Comité A',
    locality: null,
    phone: null,
    email: null,
    finance_settings: {},
    bonus_settings: {},
    settings: {},
  };

  it('rechaza nombre vacío en el parche sin actualizar', async () => {
    const { client, calls } = makeClient({ committeeRow: prevRow });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), COMMITTEE, { name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
    expect(calls.committeeUpdate).toHaveLength(0);
  });

  it('rechaza un valor de configuración que excede el máximo de caracteres', async () => {
    const { client, calls } = makeClient({ committeeRow: prevRow });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), COMMITTEE, {
      locality: 'x'.repeat(CONFIG_TEXT_MAX + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('localidad');
    expect(calls.committeeUpdate).toHaveLength(0);
  });

  it('rechaza un parche vacío (sin cambios)', async () => {
    const { client, calls } = makeClient({ committeeRow: prevRow });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), COMMITTEE, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('committee/empty-patch');
    expect(calls.committeeUpdate).toHaveLength(0);
  });

  it('permite poner un campo opcional en null', async () => {
    const { client, calls } = makeClient({ committeeRow: prevRow });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), COMMITTEE, { phone: null });
    expect(r.ok).toBe(true);
    const update = calls.committeeUpdate[0] as Record<string, unknown>;
    expect(update.phone).toBeNull();
  });
});

// ── Garantía server-only ──────────────────────────────────────────────────────

describe('committee: garantías server-only', () => {
  it("el código fuente empieza con `import 'server-only'`", () => {
    const source = readFileSync(join(__dirname, 'committee-service.ts'), 'utf8');
    const firstStatement = source
      .split('\n')
      .find((line) => line.trim().length > 0);
    expect(firstStatement?.trim()).toBe("import 'server-only';");
  });
});
