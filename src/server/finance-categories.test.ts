import { describe, it, expect, vi, beforeEach } from 'vitest';

// `server-only` lanza fuera del runtime de servidor de Next.js; se neutraliza
// en pruebas (la garantía real se cubre en finance-accounts.test.ts).
vi.mock('server-only', () => ({}));

// `next/headers` solo existe en runtime de servidor; se evita al cargar authz.
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import type { Ctx } from '@/domain/types';

import {
  createFinanceService,
  validateCategoryName,
  CATEGORY_NAME_MAX,
} from './finance-service';

const USER = '11111111-1111-1111-1111-111111111111';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CATEGORY = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

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
 * Cliente Supabase simulado para las operaciones de categorías. Registra las
 * inserciones/actualizaciones/eliminaciones y expone opciones para simular
 * errores, la fila leída y el conteo de transacciones asociadas.
 *
 * Formas de consulta soportadas sobre `transaction_categories`:
 *   - insert(row).select('id').single()
 *   - select('...').eq('id', id).eq('committee_id', c).single()
 *   - update(row).eq('id', id).eq('committee_id', c)
 *   - delete().eq('id', id).eq('committee_id', c)
 * Sobre `financial_transactions`:
 *   - select('id', { count: 'exact', head: true }).eq(...).eq(...)  → { count }
 */
function makeClient(
  opts: {
    insertedCategoryId?: string;
    insertError?: { message?: string; code?: string } | null;
    categoryRow?: Record<string, unknown> | null;
    readError?: { message: string } | null;
    updateError?: { message?: string; code?: string } | null;
    deleteError?: { message: string } | null;
    txCount?: number;
    txCountError?: { message: string } | null;
  } = {},
) {
  const calls = {
    categoryInsert: [] as unknown[],
    categoryUpdate: [] as unknown[],
    categoryDelete: 0,
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

    if (table === 'transaction_categories') {
      return {
        // insert(...).select('id').single()
        insert: vi.fn((row: unknown) => {
          calls.categoryInsert.push(row);
          return {
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: opts.insertError
                    ? null
                    : { id: opts.insertedCategoryId ?? CATEGORY },
                  error: opts.insertError ?? null,
                }),
              ),
            })),
          };
        }),
        // select(...).eq('id', id).eq('committee_id', c).single()
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: opts.categoryRow ?? null,
                  error: opts.readError ?? null,
                }),
              ),
            })),
          })),
        })),
        // update(...).eq('id', id).eq('committee_id', c)
        update: vi.fn((row: unknown) => {
          calls.categoryUpdate.push(row);
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: opts.updateError ?? null })),
            })),
          };
        }),
        // delete().eq('id', id).eq('committee_id', c)
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => {
              calls.categoryDelete += 1;
              return Promise.resolve({ error: opts.deleteError ?? null });
            }),
          })),
        })),
      };
    }

    if (table === 'financial_transactions') {
      return {
        // select('id', { count: 'exact', head: true }).eq(...).eq(...)
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve({
                count: opts.txCount ?? 0,
                error: opts.txCountError ?? null,
              }),
            ),
          })),
        })),
      };
    }

    throw new Error(`tabla no simulada: ${table}`);
  });

  return { client: { from } as never, calls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── Validación de nombre (R13.5) ──────────────────────────────────────────────

describe('finance: validación de nombre de categoría (R13.5)', () => {
  it('acepta un nombre válido y lo devuelve recortado', () => {
    const r = validateCategoryName('  Aportaciones  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Aportaciones');
  });

  it('rechaza nombre vacío', () => {
    const r = validateCategoryName('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
  });

  it('rechaza nombre compuesto solo de espacios en blanco', () => {
    const r = validateCategoryName('     ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('category/invalid-name');
  });

  it('rechaza nombre que excede 100 caracteres', () => {
    const r = validateCategoryName('x'.repeat(CATEGORY_NAME_MAX + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('name');
  });

  it('acepta nombre en el límite de 100 caracteres', () => {
    const r = validateCategoryName('x'.repeat(CATEGORY_NAME_MAX));
    expect(r.ok).toBe(true);
  });

  it('acepta un nombre de un solo carácter (límite inferior)', () => {
    const r = validateCategoryName('X');
    expect(r.ok).toBe(true);
  });

  it('rechaza un valor no textual', () => {
    const r = validateCategoryName(undefined);
    expect(r.ok).toBe(false);
  });
});

// ── createCategory (R13.1, R13.3, R13.5) ──────────────────────────────────────

describe('finance: createCategory (R13.1, R13.3, R13.5)', () => {
  it('crea la categoría en el catálogo del comité y devuelve su id', async () => {
    const { client, calls } = makeClient({ insertedCategoryId: CATEGORY });
    const service = createFinanceService({ client });

    const r = await service.createCategory(makeCtx(), '  Ventas  ');

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.categoryId).toBe(CATEGORY);

    const inserted = calls.categoryInsert[0] as Record<string, unknown>;
    expect(inserted.name).toBe('Ventas'); // recortado
    expect(inserted.committee_id).toBe(COMMITTEE); // R13.1: catálogo del comité
  });

  it('audita la creación atribuida al usuario', async () => {
    const { client, calls } = makeClient({ insertedCategoryId: CATEGORY });
    const service = createFinanceService({ client });

    await service.createCategory(makeCtx(), 'Donaciones');

    expect(calls.auditInsert).toHaveLength(1);
    const audit = calls.auditInsert[0] as Record<string, unknown>;
    expect(audit.user_id).toBe(USER);
    expect(audit.action).toBe('category.create');
    expect(audit.entity_type).toBe('transaction_category');
    expect(audit.committee_id).toBe(COMMITTEE);
    expect(audit.entity_id).toBe(CATEGORY);
  });

  it('rechaza la creación sin permiso committee.manage sin insertar', async () => {
    const { client, calls } = makeClient();
    const service = createFinanceService({ client });

    const r = await service.createCategory(makeCtx({ permissions: [] }), 'Sin permiso');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.categoryInsert).toHaveLength(0);
  });

  it('rechaza nombre solo de espacios sin insertar', async () => {
    const { client, calls } = makeClient();
    const service = createFinanceService({ client });

    const r = await service.createCategory(makeCtx(), '    ');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('category/invalid-name');
    expect(calls.categoryInsert).toHaveLength(0);
  });

  it('rechaza nombre que excede 100 caracteres sin insertar', async () => {
    const { client, calls } = makeClient();
    const service = createFinanceService({ client });

    const r = await service.createCategory(makeCtx(), 'x'.repeat(CATEGORY_NAME_MAX + 1));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('category/invalid-name');
    expect(calls.categoryInsert).toHaveLength(0);
  });

  it('rechaza nombre duplicado dentro del mismo comité (UNIQUE) sin crear la categoría', async () => {
    const { client } = makeClient({ insertError: { code: '23505', message: 'dup' } });
    const service = createFinanceService({ client });

    const r = await service.createCategory(makeCtx(), 'Aportaciones');

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('category/duplicate-name');
      expect(r.error.field).toBe('name');
    }
  });

  it('devuelve error genérico cuando la inserción falla por otra causa', async () => {
    const { client } = makeClient({ insertError: { message: 'db down' } });
    const service = createFinanceService({ client });

    const r = await service.createCategory(makeCtx(), 'Ventas');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('category/create-failed');
  });

  it('el superadministrador puede crear categorías sin el permiso explícito', async () => {
    const { client, calls } = makeClient({ insertedCategoryId: CATEGORY });
    const service = createFinanceService({ client });

    const r = await service.createCategory(
      makeCtx({ permissions: [], isSuperAdmin: true }),
      'Otros',
    );

    expect(r.ok).toBe(true);
    expect(calls.categoryInsert).toHaveLength(1);
  });
});

// ── renameCategory (R13.1, R13.3, R13.5) ──────────────────────────────────────

describe('finance: renameCategory (R13.1, R13.3, R13.5)', () => {
  it('renombra la categoría y audita old→new', async () => {
    const { client, calls } = makeClient({
      categoryRow: { name: 'Ventas', committee_id: COMMITTEE },
    });
    const service = createFinanceService({ client });

    const r = await service.renameCategory(makeCtx(), CATEGORY, '  Ventas y ferias  ');

    expect(r.ok).toBe(true);
    expect(calls.categoryUpdate).toHaveLength(1);
    expect((calls.categoryUpdate[0] as { name: string }).name).toBe('Ventas y ferias');

    const audit = calls.auditInsert[0] as Record<string, unknown>;
    expect(audit.action).toBe('category.rename');
    expect(audit.entity_type).toBe('transaction_category');
    expect((audit.old_values as { name: string }).name).toBe('Ventas');
    expect((audit.new_values as { name: string }).name).toBe('Ventas y ferias');
  });

  it('rechaza sin permiso committee.manage sin actualizar', async () => {
    const { client, calls } = makeClient({
      categoryRow: { name: 'Ventas', committee_id: COMMITTEE },
    });
    const service = createFinanceService({ client });

    const r = await service.renameCategory(makeCtx({ permissions: [] }), CATEGORY, 'Nuevo');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.categoryUpdate).toHaveLength(0);
  });

  it('rechaza un nombre inválido (solo espacios) sin actualizar', async () => {
    const { client, calls } = makeClient({
      categoryRow: { name: 'Ventas', committee_id: COMMITTEE },
    });
    const service = createFinanceService({ client });

    const r = await service.renameCategory(makeCtx(), CATEGORY, '   ');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('category/invalid-name');
    expect(calls.categoryUpdate).toHaveLength(0);
  });

  it('devuelve not-found cuando la categoría no existe en el comité', async () => {
    const { client, calls } = makeClient({ categoryRow: null });
    const service = createFinanceService({ client });

    const r = await service.renameCategory(makeCtx(), CATEGORY, 'Nuevo');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('category/not-found');
    expect(calls.categoryUpdate).toHaveLength(0);
  });

  it('rechaza cuando el nuevo nombre choca con otra categoría del comité (UNIQUE)', async () => {
    const { client } = makeClient({
      categoryRow: { name: 'Ventas', committee_id: COMMITTEE },
      updateError: { code: '23505', message: 'dup' },
    });
    const service = createFinanceService({ client });

    const r = await service.renameCategory(makeCtx(), CATEGORY, 'Donaciones');

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('category/duplicate-name');
      expect(r.error.field).toBe('name');
    }
  });
});

// ── deleteCategory (R13.1, R13.4) ─────────────────────────────────────────────

describe('finance: deleteCategory (R13.1, R13.4)', () => {
  it('elimina la categoría cuando no tiene ingresos asociados y audita', async () => {
    const { client, calls } = makeClient({
      categoryRow: { name: 'Ventas', committee_id: COMMITTEE },
      txCount: 0,
    });
    const service = createFinanceService({ client });

    const r = await service.deleteCategory(makeCtx(), CATEGORY);

    expect(r.ok).toBe(true);
    expect(calls.categoryDelete).toBe(1);

    const audit = calls.auditInsert[0] as Record<string, unknown>;
    expect(audit.action).toBe('category.delete');
    expect(audit.entity_type).toBe('transaction_category');
    expect((audit.old_values as { name: string }).name).toBe('Ventas');
  });

  it('rechaza la eliminación cuando la categoría tiene ingresos asociados (R13.4)', async () => {
    const { client, calls } = makeClient({
      categoryRow: { name: 'Ventas', committee_id: COMMITTEE },
      txCount: 3,
    });
    const service = createFinanceService({ client });

    const r = await service.deleteCategory(makeCtx(), CATEGORY);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('category/in-use');
    // No se elimina ni se audita cuando está en uso.
    expect(calls.categoryDelete).toBe(0);
    expect(calls.auditInsert).toHaveLength(0);
  });

  it('rechaza sin permiso committee.manage sin eliminar', async () => {
    const { client, calls } = makeClient({
      categoryRow: { name: 'Ventas', committee_id: COMMITTEE },
    });
    const service = createFinanceService({ client });

    const r = await service.deleteCategory(makeCtx({ permissions: [] }), CATEGORY);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTHZ_FORBIDDEN');
    expect(calls.categoryDelete).toBe(0);
  });

  it('devuelve not-found cuando la categoría no existe en el comité', async () => {
    const { client, calls } = makeClient({ categoryRow: null });
    const service = createFinanceService({ client });

    const r = await service.deleteCategory(makeCtx(), CATEGORY);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('category/not-found');
    expect(calls.categoryDelete).toBe(0);
  });

  it('devuelve error cuando falla la verificación de uso', async () => {
    const { client, calls } = makeClient({
      categoryRow: { name: 'Ventas', committee_id: COMMITTEE },
      txCountError: { message: 'db down' },
    });
    const service = createFinanceService({ client });

    const r = await service.deleteCategory(makeCtx(), CATEGORY);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('category/delete-failed');
    expect(calls.categoryDelete).toBe(0);
  });

  it('devuelve error cuando la eliminación falla en la base de datos', async () => {
    const { client } = makeClient({
      categoryRow: { name: 'Ventas', committee_id: COMMITTEE },
      txCount: 0,
      deleteError: { message: 'db down' },
    });
    const service = createFinanceService({ client });

    const r = await service.deleteCategory(makeCtx(), CATEGORY);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('category/delete-failed');
  });
});
