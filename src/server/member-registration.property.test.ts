import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// `server-only` lanza fuera del runtime de servidor de Next.js; se neutraliza
// en pruebas (la garantía real la cubre la prueba de código fuente del servicio).
vi.mock('server-only', () => ({}));

// `next/headers` solo existe en runtime de servidor; se evita al cargar authz.
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import type { Ctx } from '@/domain/types';

import {
  createMemberService,
  MEMBER_NAME_MAX,
  MEMBER_PHONE_MAX,
  MEMBER_NOTES_MAX,
  MEMBER_STATUSES,
  DEFAULT_MEMBER_STATUS,
  type MemberInput,
} from './member-service';

const USER = '11111111-1111-1111-1111-111111111111';
const COMMITTEE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function makeCtx(): Ctx {
  return {
    userId: USER,
    committeeId: COMMITTEE,
    permissions: ['members.create', 'users.manage'],
    isSuperAdmin: false,
  };
}

/**
 * Cliente Supabase simulado que registra si ocurrió un insert en `members`.
 * Permite afirmar que un registro rechazado NUNCA persiste (R7.3, R7.4, R7.5).
 */
function makeRecordingClient() {
  const calls = { memberInsert: [] as unknown[], auditInsert: [] as unknown[] };
  const from = vi.fn((table: string) => {
    if (table === 'members') {
      return {
        insert: vi.fn((row: unknown) => {
          calls.memberInsert.push(row);
          return {
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({ data: { id: MEMBER }, error: null }),
              ),
            })),
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

/**
 * Réplica de la especificación de aceptación (oráculo independiente del código
 * bajo prueba) para decidir si un alta debe aceptarse y con qué estado resuelto.
 * Deriva directamente de R7.2–R7.5.
 */
function expectedDecision(input: MemberInput): {
  accepted: boolean;
  resolvedStatus?: string;
} {
  // Nombre: 1–150 caracteres tras recortar (R7.3).
  const name = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const nameOk = name.length >= 1 && name.length <= MEMBER_NAME_MAX;

  // Estado: default `activo` cuando ausente/vacío; si no, debe estar en el
  // conjunto {activo, inactivo, baja} (R7.2, R7.4).
  const rawStatus = input.status;
  let statusOk: boolean;
  let resolvedStatus: string | undefined;
  if (rawStatus === undefined || rawStatus === null || rawStatus === '') {
    statusOk = true;
    resolvedStatus = DEFAULT_MEMBER_STATUS;
  } else if (
    typeof rawStatus === 'string' &&
    (MEMBER_STATUSES as readonly string[]).includes(rawStatus)
  ) {
    statusOk = true;
    resolvedStatus = rawStatus;
  } else {
    statusOk = false;
  }

  // Teléfono ≤30 tras recortar; ausente/vacío es válido (R7.5).
  const phone = input.phone;
  const phoneTrimmed =
    typeof phone === 'string' ? phone.trim() : phone == null ? '' : null;
  const phoneOk =
    phoneTrimmed === null ? false : phoneTrimmed.length <= MEMBER_PHONE_MAX;

  // Notas ≤500 tras recortar; ausente/vacío es válido (R7.5).
  const notes = input.notes;
  const notesTrimmed =
    typeof notes === 'string' ? notes.trim() : notes == null ? '' : null;
  const notesOk =
    notesTrimmed === null ? false : notesTrimmed.length <= MEMBER_NOTES_MAX;

  const accepted = nameOk && statusOk && phoneOk && notesOk;
  return accepted ? { accepted, resolvedStatus } : { accepted };
}

// Generadores inteligentes que cubren tanto el espacio válido como el inválido.

/** Nombres: vacíos, solo espacios, límite, sobre-límite y normales. */
const nameArb = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.string({ minLength: 1, maxLength: 150 }).map((s) => `n${s}`), // no vacío tras recortar
  fc.string({ minLength: MEMBER_NAME_MAX, maxLength: MEMBER_NAME_MAX }).map((s) => `x${s}`), // >150
  fc.string({ maxLength: 200 }),
);

/** Estados: válidos, omitidos, vacío y varios inválidos. */
const statusArb = fc.oneof(
  ...MEMBER_STATUSES.map((s) => fc.constant<string>(s)),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constant('suspendido'),
  fc.constant('ACTIVO'),
  fc.string({ maxLength: 12 }),
);

/** Teléfonos: nulos, dentro y sobre el límite. */
const phoneArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.string({ maxLength: MEMBER_PHONE_MAX }),
  fc.string({ minLength: MEMBER_PHONE_MAX + 1, maxLength: 60 }),
);

/** Notas: nulas, dentro y sobre el límite. */
const notesArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.string({ maxLength: MEMBER_NOTES_MAX }),
  fc.string({ minLength: MEMBER_NOTES_MAX + 1, maxLength: 700 }),
);

const memberInputArb: fc.Arbitrary<MemberInput> = fc.record({
  fullName: nameArb,
  status: statusArb,
  phone: phoneArb,
  notes: notesArb,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('member-registration property', () => {
  // Feature: sac-sistema-administracion-comunitaria, Property 3: Validación de alta de miembro
  //
  // Property 3: Validación de alta de miembro.
  // Validates: Requirements 7.2, 7.3, 7.4, 7.5
  //
  // Para una entrada arbitraria de miembro, el registro se acepta si y solo si:
  //  - el nombre tiene 1–150 caracteres tras recortar (R7.3),
  //  - el estado pertenece a {activo, inactivo, baja}, con default `activo`
  //    cuando se omite (R7.2, R7.4),
  //  - el teléfono ≤30 caracteres (R7.5) y las notas ≤500 caracteres (R7.5).
  // Cuando se rechaza, no se persiste ningún miembro; cuando se acepta, el
  // estado persistido coincide con el estado resuelto por las reglas.
  it('acepta iff nombre/estado/teléfono/notas son válidos y no persiste al rechazar', async () => {
    await fc.assert(
      fc.asyncProperty(memberInputArb, async (input) => {
        const { client, calls } = makeRecordingClient();
        const service = createMemberService({ client });

        const expected = expectedDecision(input);
        const result = await service.register(makeCtx(), input);

        // La decisión aceptar/rechazar coincide con las reglas de aceptación.
        expect(result.ok).toBe(expected.accepted);

        if (expected.accepted) {
          // Al aceptar: se realizó exactamente un insert con el estado resuelto.
          expect(calls.memberInsert).toHaveLength(1);
          const inserted = calls.memberInsert[0] as Record<string, unknown>;
          expect(inserted.status).toBe(expected.resolvedStatus);
          expect(inserted.committee_id).toBe(COMMITTEE);
        } else {
          // Al rechazar: no se persiste ningún miembro (R7.3, R7.4, R7.5).
          expect(calls.memberInsert).toHaveLength(0);
          // El error apunta a un campo o código de validación de miembro.
          if (!result.ok) {
            expect(result.error.code.startsWith('member/')).toBe(true);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
