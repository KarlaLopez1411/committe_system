// Feature: sac-sistema-administracion-comunitaria, Property 4: Validación y unicidad de cuentas
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// `server-only` lanza fuera del runtime de servidor de Next.js; se neutraliza
// en pruebas (finance-service.ts empieza con `import 'server-only'`).
vi.mock('server-only', () => ({}));

// `next/headers` solo existe en runtime de servidor; se evita al cargar authz.
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import type { Ctx } from '@/domain/types';

import {
  createFinanceService,
  ACCOUNT_TYPES,
  ACCOUNT_NAME_MAX,
  type AccountType,
} from './finance-service';

const USER = '11111111-1111-1111-1111-111111111111';

function makeCtx(committeeId: string): Ctx {
  return {
    userId: USER,
    committeeId,
    permissions: ['committee.manage'],
    isSuperAdmin: false,
  };
}

/**
 * Cliente Supabase simulado respaldado por un `Set` en memoria con clave
 * `(committee_id, name)` que reproduce la restricción real
 * `UNIQUE(committee_id, name)` de `financial_accounts`: al insertar un nombre
 * ya presente para el mismo comité, devuelve `{ code: '23505' }`, tal como lo
 * hace PostgreSQL ante una violación UNIQUE. Cada inserción exitosa genera un
 * id secuencial. Las escrituras en `audit_logs` se ignoran silenciosamente.
 */
function makeInMemoryClient() {
  // Clave: `${committee_id}\u0000${name}` para evitar colisiones ambiguas.
  const existing = new Set<string>();
  let seq = 0;

  const key = (committeeId: unknown, name: unknown) =>
    `${String(committeeId)}\u0000${String(name)}`;

  const from = vi.fn((table: string) => {
    if (table === 'audit_logs') {
      return {
        insert: vi.fn(() => Promise.resolve({ error: null })),
      };
    }
    if (table === 'financial_accounts') {
      return {
        insert: vi.fn((row: Record<string, unknown>) => ({
          select: vi.fn(() => ({
            single: vi.fn(() => {
              const k = key(row.committee_id, row.name);
              if (existing.has(k)) {
                // Reproduce la violación UNIQUE(committee_id, name).
                return Promise.resolve({
                  data: null,
                  error: { code: '23505', message: 'duplicate key value' },
                });
              }
              existing.add(k);
              seq += 1;
              return Promise.resolve({
                data: { id: `acct-${seq}` },
                error: null,
              });
            }),
          })),
        })),
      };
    }
    throw new Error(`tabla no simulada: ${table}`);
  });

  return { client: { from } as never };
}

// Genera nombres tanto válidos como inválidos (vacíos, solo espacios o >80).
const nameArb = fc.oneof(
  // Nombres arbitrarios (pueden ser válidos o no según longitud tras recortar).
  fc.string({ maxLength: 90 }),
  // Casos límite de longitud alrededor del máximo.
  fc.integer({ min: 0, max: ACCOUNT_NAME_MAX + 5 }).map((n) => 'x'.repeat(n)),
  // Nombres con espacios envolventes para ejercitar el recorte.
  fc.string({ maxLength: 20 }).map((s) => `   ${s}   `),
  // Solo espacios en blanco (inválido tras recortar).
  fc.integer({ min: 0, max: 6 }).map((n) => ' '.repeat(n)),
);

// Genera tipos válidos e inválidos.
const typeArb = fc.oneof(
  fc.constantFrom(...ACCOUNT_TYPES),
  fc.constantFrom('cuenta_inventada', '', 'CAJA_GENERAL', 'banco'),
);

const committeeArb = fc.constantFrom(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
);

/** Predicado de validez de nombre replicando validateAccountName. */
function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= ACCOUNT_NAME_MAX;
}

/** Predicado de validez de tipo replicando validateAccountType. */
function isValidType(type: string): boolean {
  return (ACCOUNT_TYPES as readonly string[]).includes(type);
}

describe('Property 4: Validación y unicidad de cuentas (R9.1, R9.2)', () => {
  // **Validates: Requirements 9.1, 9.2**
  it('createAccount acepta sii nombre 1–80 (tras recortar) Y tipo válido Y nombre único por comité; los duplicados por comité se rechazan pero el mismo nombre en otro comité procede', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            committeeId: committeeArb,
            name: nameArb,
            type: typeArb,
          }),
          { minLength: 1, maxLength: 25 },
        ),
        async (ops) => {
          const { client } = makeInMemoryClient();
          const service = createFinanceService({ client });

          // Modelo de referencia: nombres recortados aceptados por comité.
          const accepted = new Map<string, Set<string>>();

          for (const op of ops) {
            const validName = isValidName(op.name);
            const validType = isValidType(op.type);
            const trimmed = op.name.trim();

            const committeeAccepted =
              accepted.get(op.committeeId) ?? new Set<string>();
            const isDuplicate = validName && committeeAccepted.has(trimmed);

            const shouldAccept = validName && validType && !isDuplicate;

            const r = await service.createAccount(makeCtx(op.committeeId), {
              name: op.name,
              type: op.type as AccountType,
            });

            expect(r.ok).toBe(shouldAccept);

            if (r.ok) {
              // Aceptada: registrar en el modelo para detectar duplicados futuros.
              committeeAccepted.add(trimmed);
              accepted.set(op.committeeId, committeeAccepted);
            } else {
              // R9.2: el motivo del rechazo corresponde al primer problema.
              if (!validName) {
                expect(r.error.code).toBe('account/invalid-name');
              } else if (!validType) {
                expect(r.error.code).toBe('account/invalid-type');
              } else {
                // Único caso restante: nombre duplicado en el mismo comité.
                expect(r.error.code).toBe('account/duplicate-name');
              }
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  // **Validates: Requirements 9.2**
  it('un nombre válido duplicado en el MISMO comité se rechaza, pero el mismo nombre en OTRO comité se acepta (unicidad por comité)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Nombre válido garantizado (1–80 tras recortar).
        fc
          .string({ minLength: 1, maxLength: ACCOUNT_NAME_MAX })
          .filter((s) => s.trim().length >= 1 && s.trim().length <= ACCOUNT_NAME_MAX),
        fc.constantFrom(...ACCOUNT_TYPES),
        async (name, type) => {
          const { client } = makeInMemoryClient();
          const service = createFinanceService({ client });

          const committeeA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
          const committeeB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

          // Primera creación en A: aceptada.
          const first = await service.createAccount(makeCtx(committeeA), {
            name,
            type,
          });
          expect(first.ok).toBe(true);

          // Duplicado exacto en A: rechazado por unicidad.
          const dup = await service.createAccount(makeCtx(committeeA), {
            name,
            type,
          });
          expect(dup.ok).toBe(false);
          if (!dup.ok) expect(dup.error.code).toBe('account/duplicate-name');

          // Mismo nombre en un comité DISTINTO (B): aceptado.
          const other = await service.createAccount(makeCtx(committeeB), {
            name,
            type,
          });
          expect(other.ok).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});
