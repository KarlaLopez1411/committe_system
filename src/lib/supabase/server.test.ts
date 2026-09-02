import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// `server-only` lanza cuando se importa fuera de un entorno de servidor de
// Next.js. En las pruebas lo neutralizamos para poder ejercitar la lógica,
// mientras que la garantía real (fallo de compilación en el cliente) se cubre
// con la aserción de código fuente más abajo.
vi.mock('server-only', () => ({}));

// `next/headers` solo existe en tiempo de ejecución del servidor de Next.js.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

describe('supabase server client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
  });

  it('crea un cliente de servidor ligado a cookies (respeta RLS con anon key)', async () => {
    const { createSupabaseServerClient } = await import('./server');
    const client = await createSupabaseServerClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });

  it('crea un cliente admin con la service_role key', async () => {
    const { createSupabaseAdminClient } = await import('./server');
    const client = createSupabaseAdminClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });

  it('el cliente admin falla si falta SUPABASE_SERVICE_ROLE_KEY', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const { createSupabaseAdminClient } = await import('./server');
    expect(() => createSupabaseAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('el código fuente empieza con `import \'server-only\'` para bloquear el bundle del cliente', () => {
    const source = readFileSync(join(__dirname, 'server.ts'), 'utf8');
    // Primera sentencia significativa del módulo.
    const firstStatement = source
      .split('\n')
      .find((line) => line.trim().length > 0);
    expect(firstStatement?.trim()).toBe("import 'server-only';");
  });

  it('la service_role key se lee SIN el prefijo NEXT_PUBLIC_', () => {
    const source = readFileSync(join(__dirname, 'server.ts'), 'utf8');
    expect(source).toContain('process.env.SUPABASE_SERVICE_ROLE_KEY');
    expect(source).not.toContain('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY');
  });
});
