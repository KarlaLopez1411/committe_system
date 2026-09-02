import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import {
  INACTIVITY_TIMEOUT_MS,
  isSessionInactive,
} from '@/server/auth';
import { effectivePermissions } from '@/server/authz';

// ── In-process rate limiter (R40.1) ──────────────────────────────────────────
// Per-instance store; replace with Upstash/Redis for multi-instance production.
const _rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_WRITE_MAX = 30;    // max write requests per window per user
const RATE_WINDOW_MS = 60_000;

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = _rateMap.get(key);
  if (!entry || now > entry.resetAt) {
    _rateMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_WRITE_MAX;
}

/**
 * Middleware de solicitud — refresco de sesión y resolución del `Ctx`.
 *
 * Responsabilidades (Requirements 4.7, 4.8, 6.3):
 *  1. Refrescar la cookie de sesión de Supabase en cada solicitud (patrón
 *     recomendado de @supabase/ssr) para mantener válida la sesión del usuario.
 *  2. Aplicar la expiración por INACTIVIDAD de 30 min (R4.7): se compara la
 *     marca de tiempo `sac-last-activity` (cookie) contra INACTIVITY_TIMEOUT_MS;
 *     si se excede, se cierra la sesión y se exige nueva autenticación.
 *  3. Resolver el `Ctx` por solicitud (usuario, comité activo, permisos) y
 *     exponerlo a las capas posteriores mediante cabeceras de solicitud
 *     (`x-sac-user-id`, `x-sac-committee-id`, `x-sac-permissions`,
 *     `x-sac-is-superadmin`). Las Server Actions/handlers reconstruyen el `Ctx`
 *     a partir de estas cabeceras de confianza fijadas por el middleware.
 *
 * El comité activo se toma de la cookie `sac-active-committee` (fijada tras la
 * selección/auto-selección de R4.8/R4.9). Los permisos efectivos se derivan de
 * la unión de roles del usuario en ese comité (R6.3).
 */

/** Nombre de la cookie que almacena el instante de última actividad (ms epoch). */
const LAST_ACTIVITY_COOKIE = 'sac-last-activity';
/** Nombre de la cookie que almacena el comité activo seleccionado. */
const ACTIVE_COMMITTEE_COOKIE = 'sac-active-committee';

/** Rutas que no requieren autenticación (accesibles sin sesión). */
const PUBLIC_PATHS = ['/login', '/recuperar', '/auth', '/seleccionar-comite', '/registro'];

function isPublicPath(pathname: string): boolean {
  return pathname === '/' || PUBLIC_PATHS.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // Rate-limit write operations by user ID (or IP before auth resolves).
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
  if (isMutating) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    if (isRateLimited(ip)) {
      return new NextResponse('Too Many Requests', { status: 429 });
    }
  }

  // Respuesta base: se irá enriqueciendo con cookies de sesión refrescadas.
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sin configuración de Supabase no se puede resolver sesión; se deja pasar
  // (el resto de la app fallará de forma controlada al requerir las variables).
  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Espeja las cookies en la solicitud y en la respuesta para que el
        // refresco de sesión persista correctamente (patrón @supabase/ssr).
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresca la sesión — wrapped in try/catch because a bad SUPABASE_URL throws
  // a network error that would otherwise return an HTML 500 page for every request.
  let user: import('@supabase/supabase-js').User | null = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user ?? null;
  } catch {
    // Supabase unreachable (wrong URL, no network) — treat as unauthenticated.
    if (!isPublicPath(request.nextUrl.pathname)) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return response;
  }

  const now = Date.now();

  // Sin usuario autenticado: redirigir a /login en rutas protegidas.
  if (!user) {
    if (!isPublicPath(request.nextUrl.pathname)) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return response;
  }

  // ── Expiración por inactividad (R4.7) ──────────────────────────────────────
  const lastActivityRaw = request.cookies.get(LAST_ACTIVITY_COOKIE)?.value;
  const lastActivity = lastActivityRaw ? Number(lastActivityRaw) : undefined;

  if (isSessionInactive(lastActivity, now)) {
    // La sesión superó los 30 min de inactividad: se invalida y se redirige a
    // login exigiendo nueva autenticación en la siguiente solicitud.
    await supabase.auth.signOut();
    const redirect = NextResponse.redirect(new URL('/login', request.url));
    redirect.cookies.delete(LAST_ACTIVITY_COOKIE);
    redirect.cookies.delete(ACTIVE_COMMITTEE_COOKIE);
    return redirect;
  }

  // Renueva la marca de última actividad en cada solicitud autenticada.
  response.cookies.set(LAST_ACTIVITY_COOKIE, String(now), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(INACTIVITY_TIMEOUT_MS / 1000),
  });

  // En rutas públicas no es necesario resolver el `Ctx` completo.
  if (isPublicPath(request.nextUrl.pathname)) {
    return response;
  }

  // ── Resolución del `Ctx` por solicitud (R4.8, R6.3) ────────────────────────
  let activeCommittee = request.cookies.get(ACTIVE_COMMITTEE_COOKIE)?.value;

  // Auto-resolve: authenticated but no committee cookie → query memberships.
  if (!activeCommittee) {
    try {
      const { data: memberships } = await supabase
        .from('committee_users')
        .select('committee_id')
        .eq('user_id', user.id)
        .eq('status', 'active');

      const ids = (memberships ?? []).map((r: Record<string, unknown>) => r.committee_id as string).filter(Boolean);

      if (ids.length === 1) {
        activeCommittee = ids[0]!;
      } else if (ids.length > 1 && request.nextUrl.pathname !== '/seleccionar-comite') {
        return NextResponse.redirect(new URL('/seleccionar-comite', request.url));
      }
    } catch { /* best-effort; continue without committee */ }
  }

  // Build new request headers so server actions can read them via `headers()`.
  // response.headers.set() only sets RESPONSE headers; server actions need REQUEST headers.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-sac-user-id', user.id);

  if (activeCommittee) {
    requestHeaders.set('x-sac-committee-id', activeCommittee);
    requestHeaders.set('x-sac-is-superadmin', 'false');
    try {
      const permissions = await effectivePermissions(user.id, activeCommittee, supabase);
      requestHeaders.set('x-sac-permissions', permissions.join(','));
    } catch {
      requestHeaders.set('x-sac-permissions', '');
    }
  }

  // Create the final response with modified request headers; preserve session cookies.
  const finalResponse = NextResponse.next({ request: { headers: requestHeaders } });

  if (activeCommittee) {
    finalResponse.cookies.set(ACTIVE_COMMITTEE_COOKIE, activeCommittee, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }

  // Copy Supabase session cookies from the existing response into the final one.
  for (const cookie of response.cookies.getAll()) {
    finalResponse.cookies.set(cookie.name, cookie.value, cookie as Parameters<typeof finalResponse.cookies.set>[2]);
  }

  return finalResponse;
}

/**
 * Matcher: aplica el middleware a todas las rutas salvo activos estáticos y de
 * infraestructura de la PWA, para no penalizar recursos que no requieren sesión.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)',
  ],
};
