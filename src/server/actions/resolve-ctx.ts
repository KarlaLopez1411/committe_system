import 'server-only';

import { cookies, headers } from 'next/headers';

import type { Ctx } from '@/domain/types';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { effectivePermissions } from '@/server/authz';

/**
 * Cookie que almacena el comité activo seleccionado (fijada por las Server
 * Actions de autenticación y por el middleware).
 */
const ACTIVE_COMMITTEE_COOKIE = 'sac-active-committee';

/**
 * Resuelve el `Ctx` autenticado para una Server Action.
 *
 * IMPORTANTE — por qué NO basta con las cabeceras del middleware:
 * En el App Router de Next.js, las cabeceras de solicitud que el middleware
 * inyecta con `NextResponse.next({ request: { headers } })` se propagan al
 * render de páginas (GET) pero NO llegan de forma fiable a las invocaciones de
 * Server Actions (POST). Por eso una acción que dependa solo de
 * `x-sac-committee-id` fallaba con `auth/unauthenticated` aunque el usuario
 * tuviera sesión y comité activo.
 *
 * Estrategia (fail-closed):
 *  1. Fast-path: si el middleware ya dejó las cabeceras de confianza, se usan.
 *  2. Fallback robusto: se resuelve el `Ctx` directamente del servidor a partir
 *     de la sesión de Supabase (cookie de auth) y de la cookie de comité activo,
 *     verificando la membresía activa vía RLS y derivando los permisos.
 *
 * Devuelve `null` si no hay usuario autenticado o no se puede resolver un comité
 * activo válido (la acción debe responder `auth/unauthenticated`).
 */
export async function resolveActionCtx(): Promise<Ctx | null> {
  // ── 1) Fast-path: cabeceras de confianza fijadas por el middleware ─────────
  const h = await headers();
  const headerUserId = h.get('x-sac-user-id');
  const headerCommitteeId = h.get('x-sac-committee-id');

  if (headerUserId && headerCommitteeId) {
    const permissions = (h.get('x-sac-permissions') ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const isSuperAdmin = h.get('x-sac-is-superadmin') === 'true';
    return { userId: headerUserId, committeeId: headerCommitteeId, permissions, isSuperAdmin };
  }

  // ── 2) Fallback: resolver desde la sesión de Supabase y las cookies ────────
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Comité activo: preferir la cookie; si falta, auto-resolver por membresía.
  const store = await cookies();
  let committeeId = store.get(ACTIVE_COMMITTEE_COOKIE)?.value ?? undefined;

  // Verifica siempre que la membresía indicada por la cookie sea activa; si no
  // lo es (o no hay cookie), intenta auto-resolver a un único comité activo.
  const { data: memberships, error } = await supabase
    .from('committee_users')
    .select('committee_id')
    .eq('user_id', user.id)
    .eq('status', 'active');

  if (error) {
    return null;
  }

  const activeIds = (memberships ?? [])
    .map((row) => (row as { committee_id?: unknown }).committee_id)
    .filter((id): id is string => typeof id === 'string');

  if (activeIds.length === 0) {
    return null;
  }

  if (!committeeId || !activeIds.includes(committeeId)) {
    // Sin cookie válida: solo se auto-resuelve cuando hay exactamente un comité.
    committeeId = activeIds.length === 1 ? activeIds[0] : undefined;
  }

  if (!committeeId) {
    return null;
  }

  // Superadmin: rol de plataforma en cualquier comité asignado.
  let isSuperAdmin = false;
  const { data: superRows } = await supabase
    .from('user_roles')
    .select('roles(key)')
    .eq('user_id', user.id);
  if (Array.isArray(superRows)) {
    isSuperAdmin = superRows.some((r) => {
      const roles = (r as { roles?: unknown }).roles;
      const arr = Array.isArray(roles) ? roles : roles ? [roles] : [];
      return arr.some((role) => (role as { key?: unknown }).key === 'superadmin');
    });
  }

  let permissions: string[] = [];
  try {
    permissions = await effectivePermissions(user.id, committeeId, supabase);
  } catch {
    // fail-closed en permisos: sin permisos resolubles, la acción los verá vacíos
    permissions = [];
  }

  return { userId: user.id, committeeId, permissions, isSuperAdmin };
}
