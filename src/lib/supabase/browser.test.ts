import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Pruebas del cliente Supabase de navegador.
 *
 * Verifica que el módulo client-safe (browser.ts):
 * - Use exclusivamente las variables públicas (anon key).
 * - NUNCA referencie la `service_role` key ni importe el módulo server-only
 *   (Requirements 40.2, 40.3).
 */
describe('supabase browser client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key');
  });

  it('crea un cliente de navegador con la URL y la anon key públicas', async () => {
    const { createSupabaseBrowserClient } = await import('./browser');
    const client = createSupabaseBrowserClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });

  it('falla si falta NEXT_PUBLIC_SUPABASE_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    await expect(import('./browser')).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('falla si falta NEXT_PUBLIC_SUPABASE_ANON_KEY', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    await expect(import('./browser')).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('el código fuente NO referencia la service_role key ni el módulo server-only', () => {
    const source = readFileSync(join(__dirname, 'browser.ts'), 'utf8');
    // No debe leer nunca la clave privada de servicio.
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).not.toContain('createClient(');
    // No debe convertirse en módulo server-only.
    expect(source).not.toContain("import 'server-only'");
    // No debe importar el módulo de servidor (evita fuga transitiva).
    expect(source).not.toMatch(/from ['"]\.\/server['"]/);
  });
});
