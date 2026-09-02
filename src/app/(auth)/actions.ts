'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createAuthGateway } from '@/server/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { DEFAULT_CATEGORIES } from '@/server/default-categories';

/** Re-throws the error if it is a Next.js internal NEXT_REDIRECT throw. */
function rethrowIfRedirect(err: unknown): void {
  if (
    err !== null &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as Record<string, unknown>).digest === 'string' &&
    ((err as Record<string, unknown>).digest as string).startsWith('NEXT_REDIRECT')
  ) {
    throw err;
  }
}

/** Cookie que almacena el comité activo seleccionado (leída por el middleware). */
const ACTIVE_COMMITTEE_COOKIE = 'sac-active-committee';
/** Cookie que almacena el instante de última actividad (expiración por inactividad). */
const LAST_ACTIVITY_COOKIE = 'sac-last-activity';

/**
 * Estado devuelto por las Server Actions de autenticación para su consumo con
 * `useActionState` en los formularios cliente.
 */
export interface AuthActionState {
  /** Mensaje de error a mostrar (genérico para no filtrar información). */
  error?: string;
  /** Mensaje de confirmación (por ejemplo, recuperación de contraseña). */
  message?: string;
}

/**
 * Fija la marca de última actividad para inicializar el control de inactividad
 * (R4.7) inmediatamente tras un inicio de sesión exitoso.
 */
async function markActivity(): Promise<void> {
  const store = await cookies();
  store.set(LAST_ACTIVITY_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

/**
 * Server Action: iniciar sesión (R4.1–R4.3, R4.8, R4.9).
 *
 * Valida credenciales vía AuthGateway (respuesta genérica ante fallo, R4.2) y,
 * en éxito, resuelve el comité activo:
 *  - Un solo comité ⇒ se auto-selecciona y se redirige al dashboard (R4.9).
 *  - Varios comités ⇒ se redirige a la selección de comité (R4.8).
 */
export async function signInAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  const auth = createAuthGateway();
  const result = await auth.signIn(email, password);

  if (!result.ok) {
    return { error: result.error.message };
  }

  await markActivity();

  const userId = result.value.user.id;
  const resolved = await auth.resolveActiveCommittee(userId);

  if (!resolved.ok) {
    return { error: resolved.error.message };
  }

  const store = await cookies();

  if (resolved.value === 'choose') {
    // Pertenece a más de un comité: requiere selección explícita (R4.8).
    redirect('/seleccionar-comite');
  }

  // Pertenece a exactamente un comité: auto-selección (R4.9).
  store.set(ACTIVE_COMMITTEE_COOKIE, resolved.value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  redirect('/dashboard');
}

/**
 * Server Action: solicitar recuperación de contraseña (R4.4, R4.5).
 *
 * Devuelve siempre un mensaje genérico, exista o no el correo, para no revelar
 * si está registrado.
 */
export async function requestResetAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get('email') ?? '');

  const auth = createAuthGateway();
  const result = await auth.requestReset(email);

  if (!result.ok) {
    // No debería ocurrir (siempre responde ok), pero se mantiene genérico.
    return {
      message:
        'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.',
    };
  }

  return { message: result.value.message };
}

/**
 * Server Action: seleccionar el comité activo (R4.8).
 *
 * Verifica que el usuario pertenezca al comité elegido resolviendo sus comités
 * disponibles antes de fijar la cookie de comité activo leída por el middleware.
 */
export async function selectCommitteeAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const committeeId = String(formData.get('committeeId') ?? '').trim();

  if (committeeId.length === 0) {
    return { error: 'Selecciona un comité para continuar.' };
  }

  const store = await cookies();
  store.set(ACTIVE_COMMITTEE_COOKIE, committeeId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  redirect('/dashboard');
}

/** Server Action: cerrar sesión (R4.6). */
export async function signOutAction(): Promise<void> {
  const auth = createAuthGateway();
  await auth.signOut();

  const store = await cookies();
  store.delete(ACTIVE_COMMITTEE_COOKIE);
  store.delete(LAST_ACTIVITY_COOKIE);

  redirect('/login');
}

// ── Registro ──────────────────────────────────────────────────────────────────

export interface SignUpActionState {
  error?: string;
  message?: string;
}

/** Generates a random 6-char uppercase alphanumeric code (ambiguous chars excluded). */
function generateCommitteeCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** Validates that a string is alphanumeric (letters and digits only), case-insensitive. */
function isAlphanumeric(value: string): boolean {
  return /^[A-Za-z0-9]+$/.test(value);
}

export async function signUpAction(
  _prev: SignUpActionState,
  formData: FormData,
): Promise<SignUpActionState> {
  try {
    const fullName = String(formData.get('fullName') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const mode = String(formData.get('mode') ?? '') as 'create' | 'join';
    const committeeName = String(formData.get('committeeName') ?? '').trim();
    const committeeCode = String(formData.get('committeeCode') ?? '').trim().toUpperCase();

    // ── Validación básica ───────────────────────────────────────────────────
    if (!fullName) return { error: 'El nombre completo es obligatorio.' };
    if (!email || !email.includes('@')) return { error: 'El correo no es válido.' };
    if (password.length < 6) return { error: 'La contraseña debe tener al menos 6 caracteres.' };

    if (mode === 'create') {
      if (!committeeName) return { error: 'El nombre del comité es obligatorio.' };
      if (committeeName.length > 150) return { error: 'El nombre del comité no puede exceder 150 caracteres.' };
    } else {
      if (!committeeCode) return { error: 'El código del comité es obligatorio.' };
      if (!isAlphanumeric(committeeCode)) return { error: 'El código del comité solo puede contener letras y números.' };
      if (committeeCode.length < 4 || committeeCode.length > 12) return { error: 'El código del comité debe tener entre 4 y 12 caracteres.' };
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return { error: 'El servidor no está configurado. Asegúrate de que SUPABASE_SERVICE_ROLE_KEY y NEXT_PUBLIC_SUPABASE_URL están en .env.local.' };
    }

    const admin = createSupabaseAdminClient();

    // ── Crear usuario ───────────────────────────────────────────────────────
    // `email_confirm: true` marca el correo como confirmado de inmediato para
    // que el administrador pueda iniciar sesión justo después de registrarse.
    // El proyecto exige confirmación de correo; sin esto, el login posterior
    // falla con `email_not_confirmed` y el usuario nunca obtiene una sesión de
    // comité activa (error `auth/unauthenticated`). No hay envío de correos
    // configurado en este flujo de alta autoservicio.
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (authError || !authData?.user) {
      const msg = authError?.message ?? '';
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists')) {
        return { error: 'Ya existe una cuenta con ese correo. Inicia sesión.' };
      }
      // Supabase URL wrong / unreachable (common when .env.local still points to localhost).
      if (msg.includes('DOCTYPE') || msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('network')) {
        return { error: 'No se pudo conectar con el servidor. Verifica que NEXT_PUBLIC_SUPABASE_URL en .env.local apunte a tu proyecto de Supabase Cloud (no a localhost).' };
      }
      return { error: msg || 'No se pudo crear la cuenta. Inténtalo de nuevo.' };
    }

    const userId = authData.user.id;

    // ── Crear perfil ────────────────────────────────────────────────────────
    await admin.from('profiles').insert({ id: userId, full_name: fullName });

    // ── Crear o encontrar el comité ─────────────────────────────────────────
    let committeeId: string;

    if (mode === 'create') {
      let code = generateCommitteeCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: existing } = await admin.from('committees').select('id').eq('code', code).maybeSingle();
        if (!existing) break;
        code = generateCommitteeCode();
      }

      const { data: created, error: createErr } = await admin
        .from('committees')
        .insert({ name: committeeName, code, status: 'active' })
        .select('id')
        .single();

      if (createErr || !created) {
        await admin.auth.admin.deleteUser(userId).catch(() => {});
        return { error: `No se pudo crear el comité: ${createErr?.message ?? 'error desconocido'}.` };
      }

      committeeId = (created as { id: string }).id;

      // Sembrar las categorías básicas de ingresos y egresos del comité nuevo.
      // Best-effort: si fallara, el alta continúa (el comité puede crearlas luego).
      await admin.from('transaction_categories').insert(
        DEFAULT_CATEGORIES.map((name) => ({ committee_id: committeeId, name })),
      );
    } else {
      const { data: found } = await admin
        .from('committees')
        .select('id')
        .eq('code', committeeCode)
        .maybeSingle();

      if (!found) {
        await admin.auth.admin.deleteUser(userId).catch(() => {});
        return { error: 'No se encontró ningún comité con ese código. Verifica e inténtalo de nuevo.' };
      }

      committeeId = (found as { id: string }).id;
    }

    // ── Vincular usuario al comité ──────────────────────────────────────────
    const { error: linkErr } = await admin.from('committee_users').insert({
      committee_id: committeeId,
      user_id: userId,
      status: 'active',
    });

    if (linkErr) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      return { error: 'No se pudo vincular la cuenta al comité. Inténtalo de nuevo.' };
    }

    // ── Asignar todos los roles del comité al creador ───────────────────────
    // Only assign roles when the user CREATED the committee (not when joining).
    if (mode === 'create') {
      const { data: allRoles } = await admin
        .from('roles')
        .select('id')
        .neq('key', 'superadmin');   // superadmin is platform-wide, not committee-level

      if (allRoles?.length) {
        const roleRows = (allRoles as { id: string }[]).map((r) => ({
          committee_id: committeeId,
          user_id: userId,
          role_id: r.id,
        }));
        await admin.from('user_roles').insert(roleRows);
      }
    } else {
      // Al unirse por código, se asigna por defecto el rol `member` (solo
      // lectura). Un administrador puede cambiar o ampliar sus roles después
      // desde Configuración → Usuarios.
      const { data: memberRole } = await admin
        .from('roles')
        .select('id')
        .eq('key', 'member')
        .maybeSingle();

      if (memberRole) {
        await admin.from('user_roles').insert({
          committee_id: committeeId,
          user_id: userId,
          role_id: (memberRole as { id: string }).id,
        });
      }
    }

    // redirect() throws NEXT_REDIRECT internally — rethrowIfRedirect lets it propagate.
    redirect('/login?registered=1');
  } catch (err: unknown) {
    rethrowIfRedirect(err);
    const message = err instanceof Error ? err.message : 'Error inesperado. Inténtalo de nuevo.';
    return { error: message };
  }
  // unreachable — redirect() never returns
}
