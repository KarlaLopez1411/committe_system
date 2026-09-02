import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente Supabase para el NAVEGADOR (client components).
 *
 * SEGURIDAD (Requirements 40.2, 40.3):
 * - Usa EXCLUSIVAMENTE la URL pública y la clave anónima (anon key), ambas
 *   expuestas mediante el prefijo `NEXT_PUBLIC_`.
 * - Todas las lecturas quedan sujetas a las políticas RLS de PostgreSQL.
 * - Este módulo es seguro para incluirse en el bundle del cliente. NUNCA debe
 *   importar la clave privada de servicio ni el módulo `server.ts`.
 *
 * Este archivo intencionalmente NO importa `server-only`, porque está diseñado
 * para ejecutarse en el navegador.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error(
    'Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL. ' +
      'Copia .env.example a .env.local y completa el valor.',
  );
}

if (!supabaseAnonKey) {
  throw new Error(
    'Falta la variable de entorno NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copia .env.example a .env.local y completa el valor.',
  );
}

/**
 * Crea un cliente Supabase de navegador ligado a la sesión del usuario.
 * Restringido a la clave anónima; el acceso a datos lo controla RLS.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(supabaseUrl as string, supabaseAnonKey as string);
}
