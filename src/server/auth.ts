import 'server-only';

import type { Session, SupabaseClient } from '@supabase/supabase-js';

import type { Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';

import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * AuthGateway — autenticación, sesiones y selección de comité activo.
 *
 * Implementa la sección "Auth / Authorization" de design.md sobre Supabase Auth
 * (Requirements 4.1–4.9). Todo el módulo es server-only: `server-only` impide
 * que llegue al bundle del navegador (Requirements 40.2, 40.3).
 *
 * Parámetros de política (todos configurables mediante constantes):
 *  - Bloqueo por intentos fallidos: 5 intentos / 15 min ⇒ bloqueo 15 min (R4.3).
 *  - Expiración de sesión por inactividad: 30 min (R4.7).
 *  - Validez del enlace de restablecimiento de contraseña: 60 min (R4.4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTAS DE ENFORCEMENT (cómo se aplica cada política y dónde se documenta):
 *
 *  • Enlace de reset con validez ≤ 60 min (R4.4): la duración efectiva del
 *    enlace de recuperación la controla Supabase Auth mediante la opción
 *    `MAILER_OTP_EXP` / "Email OTP Expiration" del proyecto (o `expiry` en la
 *    plantilla de recuperación). Debe configurarse a 3600 s (60 min) o menos en
 *    el panel/`supabase/config.toml`. El servidor no puede acortar un enlace ya
 *    emitido; por eso la garantía se documenta y se fija en configuración.
 *
 *  • Expiración por inactividad de 30 min (R4.7): se aplica en el middleware por
 *    solicitud comparando una marca de tiempo de "última actividad" almacenada
 *    en cookie contra INACTIVITY_TIMEOUT_MS. Si se excede, el middleware
 *    invalida la sesión (signOut) y exige nueva autenticación. Aquí se exportan
 *    la constante y el predicado `isSessionInactive` que consume el middleware.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Parámetros de política ──────────────────────────────────────────────────

/** Máximo de intentos fallidos consecutivos antes de bloquear (R4.3). */
export const MAX_FAILED_ATTEMPTS = 5;
/** Ventana de acumulación de intentos fallidos: 15 minutos (R4.3). */
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
/** Duración del bloqueo tras superar el umbral: 15 minutos (R4.3). */
export const LOCKOUT_MS = 15 * 60 * 1000;
/** Expiración de sesión por inactividad: 30 minutos (R4.7). */
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
/** Validez máxima del enlace de restablecimiento: 60 minutos (R4.4). */
export const RESET_LINK_TTL_MS = 60 * 60 * 1000;

/** Mensaje genérico de error de autenticación que no revela si el correo existe (R4.2). */
const GENERIC_AUTH_ERROR =
  'Correo o contraseña incorrectos, o la cuenta no está activa.';
/** Confirmación genérica para recuperación, idéntica exista o no el correo (R4.5). */
const GENERIC_RESET_MESSAGE =
  'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.';

// ── Control de intentos fallidos / bloqueo ────────────────────────────────────

interface AttemptRecord {
  /** Marcas de tiempo (ms) de intentos fallidos dentro de la ventana vigente. */
  failures: number[];
  /** Instante (ms) hasta el cual el correo permanece bloqueado, si aplica. */
  lockedUntil?: number;
}

/**
 * Almacén de intentos por correo.
 *
 * IMPORTANTE (producción): este `Map` en memoria es adecuado para un único
 * proceso. En un despliegue con múltiples instancias serverless/regionales NO
 * es compartido y, por tanto, el bloqueo no sería global. En producción debe
 * sustituirse por un almacén compartido (por ejemplo, una tabla en PostgreSQL
 * `auth_login_attempts` o Redis) que atienda el mismo contrato de este módulo.
 * La lógica de decisión (ventana, umbral, bloqueo) permanecería idéntica.
 */
const attemptStore = new Map<string, AttemptRecord>();

/** Normaliza el correo para usarlo como clave estable del almacén de intentos. */
function attemptKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Indica si un correo está bloqueado en el instante `now`. Limpia el bloqueo
 * expirado como efecto secundario.
 */
export function isLockedOut(email: string, now: number = Date.now()): boolean {
  const record = attemptStore.get(attemptKey(email));
  if (!record?.lockedUntil) {
    return false;
  }
  if (record.lockedUntil > now) {
    return true;
  }
  // El bloqueo expiró: se limpia para permitir nuevos intentos.
  attemptStore.delete(attemptKey(email));
  return false;
}

/**
 * Registra un intento fallido para `email` y activa el bloqueo si se alcanza el
 * umbral dentro de la ventana (R4.3). Devuelve `true` si el correo queda
 * bloqueado tras este intento.
 */
function registerFailedAttempt(email: string, now: number = Date.now()): boolean {
  const key = attemptKey(email);
  const record = attemptStore.get(key) ?? { failures: [] };

  // Conserva únicamente los fallos dentro de la ventana deslizante vigente.
  const windowStart = now - ATTEMPT_WINDOW_MS;
  record.failures = record.failures.filter((ts) => ts > windowStart);
  record.failures.push(now);

  if (record.failures.length >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
  }

  attemptStore.set(key, record);
  return Boolean(record.lockedUntil && record.lockedUntil > now);
}

/** Limpia el historial de intentos de un correo tras un inicio de sesión exitoso. */
function clearAttempts(email: string): void {
  attemptStore.delete(attemptKey(email));
}

/**
 * Utilidad de pruebas: reinicia por completo el almacén de intentos en memoria.
 * No debe usarse en código de producción.
 */
export function __resetAttemptStore(): void {
  attemptStore.clear();
}

// ── Sesiones / inactividad ────────────────────────────────────────────────────

/**
 * Predicado puro consumido por el middleware: indica si una sesión debe
 * considerarse expirada por inactividad dado el instante de última actividad
 * (R4.7). Una `lastActivity` ausente o no numérica se trata como inactiva.
 */
export function isSessionInactive(
  lastActivityMs: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (typeof lastActivityMs !== 'number' || Number.isNaN(lastActivityMs)) {
    return true;
  }
  return now - lastActivityMs > INACTIVITY_TIMEOUT_MS;
}

// ── Validación de correo ──────────────────────────────────────────────────────

/** Validación de formato de correo suficientemente estricta para la capa de auth. */
export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string') {
    return false;
  }
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) {
    return false;
  }
  // Formato básico: parte-local@dominio.tld sin espacios.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

// ── AuthGateway ───────────────────────────────────────────────────────────────

/**
 * Contrato del AuthGateway (design.md, sección "Auth / Authorization").
 */
export interface AuthGateway {
  signIn(email: string, password: string): Promise<Result<Session>>;
  requestReset(email: string): Promise<Result<{ message: string }>>;
  signOut(): Promise<Result<void>>;
  resolveActiveCommittee(userId: UUID): Promise<Result<UUID | 'choose'>>;
}

/**
 * Dependencias inyectables del AuthGateway. Por defecto se resuelve el cliente
 * de servidor ligado a cookies (respeta RLS), pero las pruebas pueden inyectar
 * un cliente simulado.
 */
export interface AuthGatewayDeps {
  getClient?: () => Promise<SupabaseClient>;
  now?: () => number;
}

/**
 * Crea una instancia del AuthGateway sobre Supabase Auth.
 */
export function createAuthGateway(deps: AuthGatewayDeps = {}): AuthGateway {
  const getClient = deps.getClient ?? createSupabaseServerClient;
  const now = deps.now ?? Date.now;

  return {
    /**
     * Inicia sesión con correo y contraseña (R4.1–R4.3).
     *
     * - Valida formato de correo antes de contactar al proveedor.
     * - Aplica bloqueo por 5 intentos/15 min (R4.3): si el correo está
     *   bloqueado, rechaza sin intentar autenticar.
     * - Ante credenciales inválidas o cuenta inactiva devuelve SIEMPRE el mismo
     *   error genérico, sin revelar si el correo está registrado (R4.2). La
     *   condición de cuenta inactiva la impone Supabase (usuario baneado /
     *   correo no confirmado) y se traduce al mismo mensaje genérico.
     * - En éxito, limpia el historial de intentos y devuelve la sesión (R4.1).
     */
    async signIn(email, password): Promise<Result<Session>> {
      const at = now();

      if (!isValidEmail(email)) {
        // No cuenta como intento contra el proveedor, pero se responde genérico.
        return err('auth/invalid-credentials', GENERIC_AUTH_ERROR);
      }

      if (isLockedOut(email, at)) {
        return err(
          'auth/locked-out',
          'Demasiados intentos fallidos. Tu acceso está bloqueado temporalmente por 15 minutos.',
        );
      }

      const client = await getClient();
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data?.session) {
        const locked = registerFailedAttempt(email, at);
        if (locked) {
          return err(
            'auth/locked-out',
            'Demasiados intentos fallidos. Tu acceso está bloqueado temporalmente por 15 minutos.',
          );
        }
        return err('auth/invalid-credentials', GENERIC_AUTH_ERROR);
      }

      clearAttempts(email);
      return ok(data.session);
    },

    /**
     * Solicita el restablecimiento de contraseña (R4.4, R4.5).
     *
     * Devuelve SIEMPRE el mismo mensaje de confirmación genérico, exista o no el
     * correo, para no revelar si está registrado (R4.5). El enlace generado por
     * Supabase debe tener una validez ≤ 60 min configurada en el proyecto
     * (R4.4); véase la nota de enforcement en el encabezado del módulo.
     */
    async requestReset(email): Promise<Result<{ message: string }>> {
      // Aun con formato inválido se responde genérico para no filtrar señales.
      if (isValidEmail(email)) {
        const client = await getClient();
        // Se ignora deliberadamente cualquier error del proveedor para mantener
        // una respuesta uniforme (no se distingue "existe" de "no existe").
        await client.auth.resetPasswordForEmail(email.trim());
      }
      return ok({ message: GENERIC_RESET_MESSAGE });
    },

    /** Cierra la sesión activa e invalida las credenciales del usuario (R4.6). */
    async signOut(): Promise<Result<void>> {
      const client = await getClient();
      const { error } = await client.auth.signOut();
      if (error) {
        return err('auth/signout-failed', 'No se pudo cerrar la sesión.');
      }
      return ok(undefined);
    },

    /**
     * Resuelve el comité activo tras la autenticación (R4.8, R4.9).
     *
     * - Si el usuario pertenece a más de un comité (membresía activa) ⇒ 'choose'
     *   (requiere selección explícita) (R4.8).
     * - Si pertenece a exactamente uno ⇒ se auto-selecciona ese `committeeId`
     *   (R4.9).
     * - Si no pertenece a ninguno ⇒ error (no hay comité que activar).
     */
    async resolveActiveCommittee(userId): Promise<Result<UUID | 'choose'>> {
      const client = await getClient();
      const { data, error } = await client
        .from('committee_users')
        .select('committee_id')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (error) {
        return err(
          'auth/committee-resolution-failed',
          'No se pudieron resolver los comités del usuario.',
        );
      }

      const committeeIds = (data ?? [])
        .map((row) => (row as { committee_id?: unknown }).committee_id)
        .filter((id): id is string => typeof id === 'string');

      if (committeeIds.length === 0) {
        return err(
          'auth/no-committee',
          'El usuario no pertenece a ningún comité activo.',
        );
      }

      if (committeeIds.length > 1) {
        return ok('choose');
      }

      return ok(committeeIds[0] as UUID);
    },
  };
}
