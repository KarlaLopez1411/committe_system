import { describe, it, expect, vi, beforeEach } from 'vitest';

// `server-only` lanza fuera del runtime de servidor de Next.js; se neutraliza
// en pruebas (la garantía real la cubre la aserción de código fuente del suite
// principal en `committee-service.test.ts`).
vi.mock('server-only', () => ({}));

// `next/headers` solo existe en runtime de servidor; se evita al cargar authz.
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import type { Ctx } from '@/domain/types';

import {
  createCommitteeService,
  validateCommitteeName,
  COMMITTEE_NAME_MAX,
  CONFIG_TEXT_MAX,
} from './committee-service';

/**
 * Task 4.3 — Pruebas unitarias de validación de comité y configuración.
 *
 * Cubre específicamente:
 *  - Nombre vacío / fuera de rango (R1.2).
 *  - Valores de configuración fuera de rango (R3.4).
 *  - Acceso no autorizado a la configuración de un comité ajeno (R3.3).
 *
 * Extiende (sin duplicar) los casos ya cubiertos por
 * `committee-service.test.ts`, aportando fronteras exactas, campos de
 * configuración adicionales (teléfono, correo), distinción null vs undefined,
 * ausencia de mutación de datos ante rechazo cruzado y el bypass del
 * superadministrador.
 *
 * _Requirements: 1.2, 3.3, 3.4_
 */

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
 * Cliente Supabase simulado, versión reducida centrada en validación. Registra
 * todas las escrituras (insert/update/upsert/audit) para poder afirmar que una
 * operación rechazada NO produjo ninguna mutación de datos.
 */
function makeClient(
  opts: {
    committeeRow?: Record<string, unknown> | null;
    readError?: { message: string } | null;
    updateError?: { message: string } | null;
    insertedCommitteeId?: string;
    insertError?: { message: string } | null;
  } = {},
) {
  const calls = {
    categoriesUpsert: [] as unknown[],
    committeeInsert: [] as unknown[],
    committeeUpdate: [] as unknown[],
    auditInsert: [] as Array<Record<string, unknown>>,
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
        insert: vi.fn((row: Record<string, unknown>) => {
          calls.auditInsert.push(row);
          return Promise.resolve({ error: null });
        }),
      };
    }
    if (table === 'committees') {
      return {
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

/** Fila previa típica para lecturas de configuración. */
const PREV_ROW = {
  name: 'Comité A',
  locality: 'Centro',
  phone: '5555555555',
  email: 'a@example.com',
  finance_settings: {},
  bonus_settings: {},
  settings: {},
} as const;

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── R1.2 — Nombre vacío y fuera de rango: fronteras exactas ───────────────────

describe('validación de nombre de comité: fronteras (R1.2)', () => {
  it('rechaza una cadena de tabulaciones/nuevas líneas como vacía', () => {
    const r = validateCommitteeName('\t\n  \r');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
  });

  it('acepta un nombre de un solo carácter (mínimo)', () => {
    const r = validateCommitteeName('A');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('A');
  });

  it('acepta exactamente 150 caracteres tras recortar espacios circundantes', () => {
    const core = 'x'.repeat(COMMITTEE_NAME_MAX);
    const r = validateCommitteeName(`   ${core}   `);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(COMMITTEE_NAME_MAX);
  });

  it('rechaza 151 caracteres (uno por encima del máximo)', () => {
    const r = validateCommitteeName('x'.repeat(COMMITTEE_NAME_MAX + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe('name');
      expect(r.error.code).toBe('committee/invalid-name');
    }
  });

  it('rechaza valores no textuales: number, boolean, null, object', () => {
    for (const bad of [0, 42, true, false, null, {}, []]) {
      const r = validateCommitteeName(bad as never);
      expect(r.ok).toBe(false);
    }
  });
});

// ── R1.2 — Nombre inválido a través de updateConfig ───────────────────────────

describe('updateConfig: validación de nombre en el parche (R1.2)', () => {
  it('rechaza nombre compuesto solo de espacios sin actualizar', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), COMMITTEE, { name: '   ' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
    expect(calls.committeeUpdate).toHaveLength(0);
    expect(calls.auditInsert).toHaveLength(0);
  });

  it('rechaza nombre de 151 caracteres en el parche sin actualizar', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), COMMITTEE, {
      name: 'x'.repeat(COMMITTEE_NAME_MAX + 1),
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
    expect(calls.committeeUpdate).toHaveLength(0);
  });

  it('acepta nombre de exactamente 150 caracteres en el parche', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), COMMITTEE, {
      name: 'x'.repeat(COMMITTEE_NAME_MAX),
    });

    expect(r.ok).toBe(true);
    expect(calls.committeeUpdate).toHaveLength(1);
  });
});

// ── R3.4 — Valores de configuración fuera de rango ────────────────────────────

describe('updateConfig: valores de configuración fuera de rango (R3.4)', () => {
  it('rechaza teléfono que excede el máximo de caracteres', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), COMMITTEE, {
      phone: 'x'.repeat(CONFIG_TEXT_MAX + 1),
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe('teléfono');
      expect(r.error.code).toBe('committee/invalid-config');
    }
    expect(calls.committeeUpdate).toHaveLength(0);
  });

  it('rechaza correo que excede el máximo de caracteres', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), COMMITTEE, {
      email: 'x'.repeat(CONFIG_TEXT_MAX + 1),
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('correo');
    expect(calls.committeeUpdate).toHaveLength(0);
  });

  it('acepta un valor de configuración de exactamente el máximo de caracteres', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), COMMITTEE, {
      locality: 'x'.repeat(CONFIG_TEXT_MAX),
    });

    expect(r.ok).toBe(true);
    const update = calls.committeeUpdate[0] as Record<string, unknown>;
    expect((update.locality as string)).toHaveLength(CONFIG_TEXT_MAX);
  });

  it('la primera validación fallida detiene el update aunque haya campos válidos', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    // `name` válido, pero `phone` inválido: la operación completa se rechaza y
    // no se persiste nada (R3.4: preservar configuración previa sin cambios).
    const r = await service.updateConfig(makeCtx(), COMMITTEE, {
      name: 'Nombre Válido',
      phone: 'x'.repeat(CONFIG_TEXT_MAX + 1),
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('teléfono');
    expect(calls.committeeUpdate).toHaveLength(0);
    expect(calls.auditInsert).toHaveLength(0);
  });

  it('distingue null (poner en null) de undefined (preservar) por campo', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    // Solo `phone` presente y en null: `email`/`locality` (undefined) no se tocan.
    const r = await service.updateConfig(makeCtx(), COMMITTEE, { phone: null });

    expect(r.ok).toBe(true);
    const update = calls.committeeUpdate[0] as Record<string, unknown>;
    expect(Object.keys(update)).toEqual(['phone']);
    expect(update.phone).toBeNull();
    expect('email' in update).toBe(false);
    expect('locality' in update).toBe(false);
  });
});

// ── R3.3 — Acceso no autorizado a la configuración de un comité ajeno ─────────

describe('updateConfig: acceso no autorizado (R3.3)', () => {
  it('rechaza modificar un comité ajeno sin aplicar ningún cambio a ningún comité (R3.3)', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), OTHER_COMMITTEE, {
      name: 'Intruso',
      locality: 'Sur',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
      // El mensaje indica acceso no autorizado (R3.3).
      expect(r.error.message.toLowerCase()).toContain('no autorizado');
    }

    // Ningún cambio en el almacén de datos: ni el comité ajeno ni el propio.
    expect(calls.committeeUpdate).toHaveLength(0);
    expect(calls.categoriesUpsert).toHaveLength(0);
    // No se persiste ninguna auditoría de cambio de configuración a través del
    // cliente del servicio ante el rechazo (la auditoría del intento denegado
    // la gestiona la capa de autorización con su propio cliente admin).
    expect(
      calls.auditInsert.some((a) => a.action === 'committee.config.update'),
    ).toBe(false);
  });

  it('rechaza sin permiso committee.manage como acceso no autorizado, incluso sobre el comité propio', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx({ permissions: [] }), COMMITTEE, {
      name: 'X',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.committeeUpdate).toHaveLength(0);
  });

  it('un usuario con otros permisos pero sin committee.manage es rechazado', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(
      makeCtx({ permissions: ['members.read', 'reports.read'] }),
      COMMITTEE,
      { name: 'X' },
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.committeeUpdate).toHaveLength(0);
  });

  it('el superadministrador puede modificar la configuración de cualquier comité (bypass R2.6)', async () => {
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    const superCtx = makeCtx({ isSuperAdmin: true, permissions: [] });
    const r = await service.updateConfig(superCtx, OTHER_COMMITTEE, {
      name: 'Ajuste Superadmin',
    });

    expect(r.ok).toBe(true);
    expect(calls.committeeUpdate).toHaveLength(1);
    // No hay auditoría de denegación para el superadministrador.
    expect(calls.auditInsert.some((a) => a.action === 'access.denied')).toBe(false);
  });

  it('la validación de valores NO precede a la verificación de autorización en comité ajeno', async () => {
    // Un parche con valores inválidos dirigido a un comité ajeno debe fallar por
    // autorización, nunca revelando detalles de validación del comité ajeno.
    const { client, calls } = makeClient({ committeeRow: PREV_ROW });
    const service = createCommitteeService({ client });

    const r = await service.updateConfig(makeCtx(), OTHER_COMMITTEE, {
      name: '   ',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.committeeUpdate).toHaveLength(0);
  });
});
