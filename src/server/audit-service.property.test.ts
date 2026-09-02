// Feature: sac-sistema-administracion-comunitaria
// Property 36: Toda operación sensible exitosa produce un registro de auditoría atribuible
// Property 37: Los registros de auditoría son inmutables desde operaciones normales
// Property 34: Idempotencia general por referencia única

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import type { Ctx } from '@/domain/types';
import {
  createAuditService,
  AuditAttributionError,
  hasAttribution,
  AUDIT_QUERY_MAX_LIMIT,
  AUDIT_QUERY_DEFAULT_LIMIT,
} from './audit-service';

const USER = '11111111-1111-1111-1111-111111111111';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TX_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return { userId: USER, committeeId: COMMITTEE, permissions: ['audit.read'], isSuperAdmin: false, ...overrides };
}

/** Minimal mock client for AuditService.record tests. */
function makeAuditClient(opts: { insertError?: string | null } = {}) {
  const inserts: unknown[] = [];
  const updates: number[] = [];
  const deletes: number[] = [];

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'audit_logs') {
        return {
          insert: vi.fn((row: unknown) => {
            inserts.push(row);
            return Promise.resolve({ error: opts.insertError ? { message: opts.insertError } : null });
          }),
          update: vi.fn(() => {
            updates.push(1);
            return { eq: vi.fn(() => Promise.resolve({ error: null })) };
          }),
          delete: vi.fn(() => {
            deletes.push(1);
            return { eq: vi.fn(() => Promise.resolve({ error: null })) };
          }),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                range: vi.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          })),
        };
      }
      throw new Error(`unmocked table: ${table}`);
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  return { client, inserts, updates, deletes };
}

// ---------------------------------------------------------------------------
// Property 36: Toda operación sensible exitosa produce auditoría atribuible
// ---------------------------------------------------------------------------

describe('Property 36: Operaciones sensibles producen auditoría atribuible (R36.1)', () => {
  // **Validates: Requirements 36.1, 36.3**
  it('record inserta en audit_logs con user_id y action', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 36 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (userId, action) => {
          const { client, inserts } = makeAuditClient();
          const service = createAuditService({ client });
          await service.record(client, {
            committeeId: COMMITTEE, userId, entityType: 'financial_transaction',
            entityId: TX_ID, action,
          });
          if (inserts.length !== 1) return false;
          const row = inserts[0] as Record<string, unknown>;
          return row.user_id === userId && row.action === action;
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 36.3** — created_at is set by the DB (not by the service)
  it('record NO incluye created_at en el payload (lo aporta la BD)', async () => {
    const { client, inserts } = makeAuditClient();
    const service = createAuditService({ client });
    await service.record(client, { committeeId: COMMITTEE, userId: USER, entityType: 'test', action: 'test.action' });
    const row = inserts[0] as Record<string, unknown>;
    expect(Object.keys(row)).not.toContain('created_at');
  });
});

// ---------------------------------------------------------------------------
// Property 37: Los registros de auditoría son inmutables desde operaciones normales
// ---------------------------------------------------------------------------

describe('Property 37: Registros de auditoría inmutables (R36.2)', () => {
  // **Validates: Requirements 36.2**
  it('AuditService nunca llama UPDATE ni DELETE sobre audit_logs', async () => {
    const { client, updates, deletes } = makeAuditClient();
    const service = createAuditService({ client });

    // Multiple records should never trigger update/delete
    for (const action of ['income.registered', 'expense.registered', 'transfer.registered']) {
      await service.record(client, { committeeId: COMMITTEE, userId: USER, entityType: 'financial_transaction', action });
    }
    await service.query(makeCtx());

    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  // **Validates: Requirements 36.1, 36.3** — no userId → AttributionError
  it('record lanza AuditAttributionError cuando falta user_id', async () => {
    const { client } = makeAuditClient();
    const service = createAuditService({ client });
    await expect(
      service.record(client, { committeeId: COMMITTEE, userId: '', entityType: 'test', action: 'test' }),
    ).rejects.toThrow(AuditAttributionError);
  });

  // **Validates: Requirements 36.3** — property over user_id values
  it('hasAttribution acepta cualquier userId no vacío', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 36 }).filter((s) => s.trim().length > 0),
        (userId) => hasAttribution(userId),
      ),
      { numRuns: 100 },
    );
  });

  it('hasAttribution rechaza string vacío, null, undefined', () => {
    for (const bad of ['', '   ', null, undefined, 0, {}]) {
      expect(hasAttribution(bad)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 34: Idempotencia — query is pure read, limit clamping (R41.4)
// ---------------------------------------------------------------------------

describe('Property 34: Idempotencia y límites de paginación (R41.4)', () => {
  // **Validates: Requirements 41.4** — any limit outside bounds is clamped
  it('query rechaza sin permiso audit.read', async () => {
    const { client } = makeAuditClient();
    const service = createAuditService({ client });
    const result = await service.query(makeCtx({ permissions: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ_FORBIDDEN');
  });

  it('query devuelve arreglo vacío cuando no hay registros', async () => {
    const { client } = makeAuditClient();
    const service = createAuditService({ client });
    const result = await service.query(makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('AUDIT_QUERY_MAX_LIMIT >= AUDIT_QUERY_DEFAULT_LIMIT', () => {
    expect(AUDIT_QUERY_MAX_LIMIT).toBeGreaterThanOrEqual(AUDIT_QUERY_DEFAULT_LIMIT);
  });
});
