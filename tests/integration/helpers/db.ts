/**
 * Utilidades para las pruebas de integración contra un PostgreSQL REAL con RLS.
 *
 * Feature: sac-sistema-administracion-comunitaria (Task 3.6)
 *
 * Estas utilidades permiten:
 *  1. Detectar si hay un PostgreSQL de pruebas alcanzable (TEST_DATABASE_URL o
 *     un Supabase local en el puerto 54322).
 *  2. Abrir una conexión con el driver `pg` cargado de forma perezosa (no es una
 *     dependencia dura del proyecto: solo se usa cuando hay DB disponible).
 *  3. Simular a cada usuario autenticado estableciendo el rol de PostgREST
 *     (`authenticated`) y las claims del JWT (`request.jwt.claims`), de modo que
 *     `auth.uid()` resuelva al usuario deseado y las políticas RLS se apliquen
 *     tal como lo harían en producción (Requirements 2.2, 2.3, 2.6, 5.5, 5.6).
 *
 * IMPORTANTE: el setup (crear comités, usuarios, membresías y datos) se ejecuta
 * como superusuario/propietario de la base, que OMITE RLS (equivale al uso de
 * `service_role` en el servidor). Las ASERCIONES de aislamiento se ejecutan como
 * `authenticated`, sujeto a RLS.
 */

import net from 'node:net';

/** Cliente `pg` cargado dinámicamente (tipado laxo para evitar dependencia dura). */
export type PgClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

const DEFAULT_LOCAL_URL =
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Resuelve la cadena de conexión objetivo (env var o Supabase local por defecto). */
export function resolveConnectionString(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_LOCAL_URL;
}

/** Extrae host y puerto de una cadena de conexión `postgres://`. */
function parseHostPort(connectionString: string): { host: string; port: number } {
  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname || '127.0.0.1',
      port: url.port ? Number(url.port) : 5432,
    };
  } catch {
    return { host: '127.0.0.1', port: 54322 };
  }
}

/** Comprueba, mediante un socket TCP, si un host:puerto acepta conexiones. */
function isPortOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Importa `pg` de forma perezosa SIN que el empaquetador (Vite/Vitest) intente
 * resolverlo estáticamente en tiempo de transformación. El especificador se
 * construye en runtime para evitar el análisis estático de importaciones, de
 * modo que la ausencia del driver no rompa la colección del suite (solo lo
 * omite). `pg` no es una dependencia dura del proyecto.
 */
async function importPg(): Promise<any> {
  const spec = ['p', 'g'].join('');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const dynamicImport = new Function('s', 'return import(s)') as (
    s: string,
  ) => Promise<any>;
  return dynamicImport(spec);
}

/** ¿Está instalado el driver `pg`? (no es dependencia dura del proyecto). */
export async function isPgDriverAvailable(): Promise<boolean> {
  try {
    await importPg();
    return true;
  } catch {
    return false;
  }
}

export interface Availability {
  reachable: boolean;
  reason: string;
  connectionString: string;
}

/**
 * Determina si el conjunto de pruebas de integración puede ejecutarse:
 * requiere que el driver `pg` esté disponible y que el puerto de PostgreSQL
 * esté abierto.
 */
export async function checkDatabaseAvailability(): Promise<Availability> {
  const connectionString = resolveConnectionString();

  if (!(await isPgDriverAvailable())) {
    return {
      reachable: false,
      connectionString,
      reason:
        "El driver 'pg' no está instalado. Instálalo con `npm i -D pg @types/pg` " +
        'para ejecutar las pruebas de integración de RLS.',
    };
  }

  const { host, port } = parseHostPort(connectionString);
  const open = await isPortOpen(host, port);
  if (!open) {
    return {
      reachable: false,
      connectionString,
      reason:
        `No hay un PostgreSQL de pruebas accesible en ${host}:${port}. ` +
        'Inicia Supabase local con `npm run db:start` (requiere Docker) o define ' +
        'TEST_DATABASE_URL apuntando a una base de datos de pruebas.',
    };
  }

  return { reachable: true, connectionString, reason: 'ok' };
}

/** Abre un cliente `pg` conectado (asume disponibilidad ya verificada). */
export async function connect(connectionString: string): Promise<PgClient> {
  const pg = await importPg();
  const Client = (pg as any).Client ?? (pg as any).default?.Client;
  const client = new Client({ connectionString });
  await client.connect();
  return client as PgClient;
}

/**
 * Ejecuta `fn` en el contexto de un usuario autenticado simulado, dentro de una
 * transacción: fija el rol `authenticated` y las claims del JWT para que
 * `auth.uid()` devuelva `userId`. Al terminar, revierte para restaurar el rol
 * original de la conexión (Requirements 2.2, 2.3).
 *
 * Nota: usamos una transacción con ROLLBACK al final para que ninguna aserción
 * modifique el estado sembrado y para restaurar SET LOCAL de forma limpia.
 */
export async function asUser<T>(
  client: PgClient,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL role authenticated`);
    // PostgREST/Supabase exponen las claims del JWT vía este GUC; auth.uid()
    // lee request.jwt.claims->>'sub'.
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    const result = await fn();
    return result;
  } finally {
    // ROLLBACK restaura el rol y los GUC de SET LOCAL sin persistir cambios.
    await client.query('ROLLBACK');
  }
}

/**
 * Garantiza que exista una definición de `auth.uid()` compatible con RLS. En un
 * proyecto Supabase real ya existe; en un PostgreSQL genérico (TEST_DATABASE_URL)
 * puede faltar, por lo que la creamos de forma idempotente para que las políticas
 * que dependen de `auth.uid()` funcionen igual.
 */
export async function ensureAuthUidFunction(client: PgClient): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
  await client.query(`
    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(
        current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
        ''
      )::uuid
    $$;
  `);
}

/** Asegura que exista el rol `authenticated` usado por RLS/PostgREST. */
export async function ensureAuthenticatedRole(client: PgClient): Promise<void> {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
    END
    $$;
  `);
  // El rol de la conexión (propietario) debe poder asumir `authenticated`.
  await client.query(
    `GRANT authenticated TO CURRENT_USER`,
  ).catch(() => {
    /* ya concedido o no aplica: ignorar */
  });
}
