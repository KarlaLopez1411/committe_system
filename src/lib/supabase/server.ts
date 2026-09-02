import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Clientes Supabase para el SERVIDOR (Server Components, Server Actions, RPC).
 *
 * SEGURIDAD (Requirements 40.2, 40.3):
 * - La primera línea `import 'server-only'` GARANTIZA que este módulo jamás se
 *   incluya en el bundle del cliente: si algún componente de cliente lo importa
 *   (directa o transitivamente), la compilación de Next.js falla.
 * - `createSupabaseServerClient()` usa la clave anónima ligada a las cookies de
 *   sesión; sus lecturas/escrituras quedan sujetas a RLS por membresía activa.
 * - `createSupabaseAdminClient()` usa la `service_role` key, que OMITE RLS. Su
 *   uso debe limitarse a operaciones administrativas/RPC controladas del
 *   servidor. La `service_role` key NUNCA se expone al navegador.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function requireUrl(): string {
  if (!supabaseUrl) {
    throw new Error(
      'Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL. ' +
        'Copia .env.example a .env.local y completa el valor.',
    );
  }
  return supabaseUrl;
}

function requireAnonKey(): string {
  if (!supabaseAnonKey) {
    throw new Error(
      'Falta la variable de entorno NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copia .env.example a .env.local y completa el valor.',
    );
  }
  return supabaseAnonKey;
}

/**
 * Cliente de servidor ligado a las cookies de la petición actual.
 * Respeta RLS: opera con la identidad del usuario autenticado.
 *
 * Uso: Server Components, Route Handlers y Server Actions que deban actuar en
 * nombre del usuario (lecturas/escrituras normales sujetas a RLS).
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(requireUrl(), requireAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` puede invocarse desde un Server Component donde las cookies
          // son de solo lectura. En ese caso el refresco de sesión lo maneja el
          // middleware, por lo que se ignora de forma segura.
        }
      },
    },
  });
}

/**
 * Cliente administrativo con `service_role` que OMITE RLS.
 *
 * SOLO SERVIDOR. Reservado para Server Actions/RPC que requieran privilegios
 * elevados (por ejemplo, operaciones atómicas administrativas). Nunca debe
 * usarse para servir datos directamente al cliente sin validación previa de
 * comité y permisos.
 *
 * Se lee de forma perezosa `SUPABASE_SERVICE_ROLE_KEY` (sin prefijo
 * NEXT_PUBLIC_) para que nunca llegue al bundle del navegador (Requirements
 * 40.3).
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      'Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY. ' +
        'Copia .env.example a .env.local y completa el valor. ' +
        'Esta clave es de uso EXCLUSIVO en el servidor.',
    );
  }

  return createClient(requireUrl(), serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
