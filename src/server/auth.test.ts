import { describe, it, expect, beforeEach, vi } from 'vitest';

// `server-only` lanza fuera del entorno de servidor de Next.js; se neutraliza
// en pruebas para poder ejercitar la lógica de autenticación.
vi.mock('server-only', () => ({}));

// El AuthGateway resuelve por defecto el cliente ligado a cookies; se evita que
// las pruebas dependan de `next/headers` mockeando el módulo de servidor.
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  createAuthGateway,
  isLockedOut,
  isSessionInactive,
  isValidEmail,
  __resetAttemptStore,
  MAX_FAILED_ATTEMPTS,
  INACTIVITY_TIMEOUT_MS,
  RESET_LINK_TTL_MS,
} from './auth';

// ── Dobles de prueba del cliente Supabase ─────────────────────────────────────

/** Cliente cuyo signInWithPassword siempre falla (credenciales inválidas). */
function makeFailingClient() {
  return {
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data: { session: null },
        error: { message: 'Invalid login credentials' },
      })),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn(),
  };
}

/** Cliente cuyo signInWithPassword siempre autentica con una sesión válida. */
function makeSucceedingClient() {
  return {
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data: { session: { access_token: 'token', user: { id: 'u1' } } },
        error: null,
      })),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn(),
  };
}

/**
 * Cliente cuyo `from('committee_users')...` devuelve las filas indicadas.
 * Modela la cadena `.select().eq().eq()` como un thenable que resuelve al
 * resultado final.
 */
function makeCommitteeClient(
  rows: Array<{ committee_id: string }> | null,
  error: unknown = null,
) {
  const result = { data: rows, error };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: (r: typeof result) => unknown) => resolve(result),
  };
  return {
    auth: {
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(() => builder),
  };
}

beforeEach(() => {
  __resetAttemptStore();
});

// ── isValidEmail ──────────────────────────────────────────────────────────────

describe('isValidEmail', () => {
  it('acepta correos con formato válido', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('  user@example.com  ')).toBe(true);
  });

  it('rechaza correos con formato inválido', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('no-arroba')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
  });
});

// ── signIn: bloqueo por intentos fallidos (R4.3) ──────────────────────────────

describe('signIn — bloqueo por 5 intentos fallidos en 15 min (R4.3)', () => {
  it('devuelve error genérico en cada intento fallido antes del umbral', async () => {
    const client = makeFailingClient();
    const gw = createAuthGateway({ getClient: async () => client as never });

    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      const res = await gw.signIn('user@example.com', 'wrong');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('auth/invalid-credentials');
      }
    }
    // Aún no bloqueado tras 4 fallos.
    expect(isLockedOut('user@example.com')).toBe(false);
  });

  it('bloquea el correo tras alcanzar 5 intentos fallidos', async () => {
    const client = makeFailingClient();
    const gw = createAuthGateway({ getClient: async () => client as never });

    let last;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      last = await gw.signIn('user@example.com', 'wrong');
    }
    expect(last?.ok).toBe(false);
    if (last && !last.ok) {
      expect(last.error.code).toBe('auth/locked-out');
    }
    expect(isLockedOut('user@example.com')).toBe(true);
  });

  it('rechaza sin contactar al proveedor mientras el correo esté bloqueado', async () => {
    const client = makeFailingClient();
    const gw = createAuthGateway({ getClient: async () => client as never });

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await gw.signIn('user@example.com', 'wrong');
    }
    const callsAfterLock = client.auth.signInWithPassword.mock.calls.length;

    const res = await gw.signIn('user@example.com', 'wrong');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('auth/locked-out');
    }
    // No debe haberse invocado al proveedor durante el bloqueo.
    expect(client.auth.signInWithPassword.mock.calls.length).toBe(
      callsAfterLock,
    );
  });

  it('el bloqueo expira transcurridos 15 minutos y se permiten nuevos intentos', async () => {
    const client = makeFailingClient();
    let clock = 1_000_000;
    const gw = createAuthGateway({
      getClient: async () => client as never,
      now: () => clock,
    });

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await gw.signIn('user@example.com', 'wrong');
    }
    expect(isLockedOut('user@example.com', clock)).toBe(true);

    // Avanza 15 min + 1 ms: el bloqueo debe haber expirado.
    clock += 15 * 60 * 1000 + 1;
    expect(isLockedOut('user@example.com', clock)).toBe(false);
  });

  it('un inicio de sesión exitoso limpia el historial de intentos', async () => {
    const failing = makeFailingClient();
    const failGw = createAuthGateway({ getClient: async () => failing as never });
    // Tres fallos (por debajo del umbral).
    for (let i = 0; i < 3; i++) {
      await failGw.signIn('user@example.com', 'wrong');
    }

    const succeeding = makeSucceedingClient();
    const okGw = createAuthGateway({
      getClient: async () => succeeding as never,
    });
    const res = await okGw.signIn('user@example.com', 'correct');
    expect(res.ok).toBe(true);

    // Tras el éxito, un nuevo fallo arranca el conteo desde cero (no bloquea).
    await failGw.signIn('user@example.com', 'wrong');
    expect(isLockedOut('user@example.com')).toBe(false);
  });

  it('correos con formato inválido devuelven error genérico sin revelar el motivo', async () => {
    const client = makeFailingClient();
    const gw = createAuthGateway({ getClient: async () => client as never });
    const res = await gw.signIn('no-valido', 'x');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('auth/invalid-credentials');
    }
    // No se contacta al proveedor con un correo mal formado.
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

// ── requestReset: respuesta genérica (R4.4, R4.5) ─────────────────────────────

describe('requestReset — respuesta genérica (R4.4, R4.5)', () => {
  it('devuelve el mismo mensaje exista o no el correo', async () => {
    const client = makeFailingClient();
    const gw = createAuthGateway({ getClient: async () => client as never });

    const registered = await gw.requestReset('existe@example.com');
    const notRegistered = await gw.requestReset('noexiste@example.com');

    expect(registered.ok).toBe(true);
    expect(notRegistered.ok).toBe(true);
    if (registered.ok && notRegistered.ok) {
      // Mensaje idéntico: no revela si el correo está registrado (R4.5).
      expect(registered.value.message).toBe(notRegistered.value.message);
    }
  });

  it('invoca resetPasswordForEmail para correos válidos', async () => {
    const client = makeFailingClient();
    const gw = createAuthGateway({ getClient: async () => client as never });
    await gw.requestReset('user@example.com');
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'user@example.com',
    );
  });

  it('responde genérico incluso con correo mal formado, sin contactar al proveedor', async () => {
    const client = makeFailingClient();
    const gw = createAuthGateway({ getClient: async () => client as never });
    const res = await gw.requestReset('mal-formado');
    expect(res.ok).toBe(true);
    expect(client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('documenta una validez del enlace de reset ≤ 60 minutos', () => {
    expect(RESET_LINK_TTL_MS).toBe(60 * 60 * 1000);
  });
});

// ── resolveActiveCommittee: 0 / 1 / muchos comités (R4.8, R4.9) ───────────────

describe('resolveActiveCommittee — selección de comité activo (R4.8, R4.9)', () => {
  it('con más de un comité devuelve "choose" (R4.8)', async () => {
    const client = makeCommitteeClient([
      { committee_id: 'c1' },
      { committee_id: 'c2' },
    ]);
    const gw = createAuthGateway({ getClient: async () => client as never });
    const res = await gw.resolveActiveCommittee('u1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toBe('choose');
    }
  });

  it('con exactamente un comité lo auto-selecciona (R4.9)', async () => {
    const client = makeCommitteeClient([{ committee_id: 'c-solo' }]);
    const gw = createAuthGateway({ getClient: async () => client as never });
    const res = await gw.resolveActiveCommittee('u1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toBe('c-solo');
    }
  });

  it('sin comités activos devuelve error', async () => {
    const client = makeCommitteeClient([]);
    const gw = createAuthGateway({ getClient: async () => client as never });
    const res = await gw.resolveActiveCommittee('u1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('auth/no-committee');
    }
  });

  it('ante error de consulta devuelve error de resolución', async () => {
    const client = makeCommitteeClient(null, { message: 'db down' });
    const gw = createAuthGateway({ getClient: async () => client as never });
    const res = await gw.resolveActiveCommittee('u1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('auth/committee-resolution-failed');
    }
  });
});

// ── signOut (R4.6) ────────────────────────────────────────────────────────────

describe('signOut — invalidación de sesión (R4.6)', () => {
  it('cierra la sesión y devuelve confirmación', async () => {
    const client = makeSucceedingClient();
    const gw = createAuthGateway({ getClient: async () => client as never });
    const res = await gw.signOut();
    expect(res.ok).toBe(true);
    expect(client.auth.signOut).toHaveBeenCalled();
  });

  it('devuelve error si el proveedor falla al cerrar sesión', async () => {
    const client = makeSucceedingClient();
    client.auth.signOut = vi.fn(async () => ({
      error: { message: 'boom' } as never,
    }));
    const gw = createAuthGateway({ getClient: async () => client as never });
    const res = await gw.signOut();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('auth/signout-failed');
    }
  });
});

// ── isSessionInactive: expiración por inactividad de 30 min (R4.7) ────────────

describe('isSessionInactive — expiración por inactividad de 30 min (R4.7)', () => {
  it('es inactiva si la última actividad es nula o no numérica', () => {
    expect(isSessionInactive(undefined)).toBe(true);
    expect(isSessionInactive(null)).toBe(true);
    expect(isSessionInactive(Number.NaN)).toBe(true);
  });

  it('no es inactiva dentro de la ventana de 30 min', () => {
    const now = 10_000_000;
    expect(isSessionInactive(now - (INACTIVITY_TIMEOUT_MS - 1), now)).toBe(false);
  });

  it('es inactiva pasados 30 min sin actividad', () => {
    const now = 10_000_000;
    expect(isSessionInactive(now - (INACTIVITY_TIMEOUT_MS + 1), now)).toBe(true);
  });
});
