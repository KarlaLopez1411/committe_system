# SAC — Sistema de Administración Comunitaria

SAC es una aplicación web progresiva (PWA) multi-comité para administrar las operaciones financieras y organizativas de comités de ayuda comunitaria. Centraliza finanzas, miembros, actividades, aportaciones, donaciones, auditoría y el sistema anual de bonos en una sola plataforma.

La aplicación está construida con Next.js, TypeScript, Tailwind CSS y Supabase/PostgreSQL. El aislamiento entre comités se implementa mediante `committee_id`, validaciones del servidor y Row Level Security (RLS).

## Funcionalidades

- Autenticación, recuperación de contraseña y selección de comité.
- Usuarios, roles y permisos.
- Registro y administración de miembros.
- Cajas y cuentas financieras.
- Ingresos, egresos y transferencias internas.
- Aportaciones voluntarias y donaciones monetarias o en especie.
- Actividades y cortes de caja.
- Campañas de bonos, beneficiarios, vendedores, cobros, entregas, sorteos y premios.
- Reportes y auditoría de operaciones.
- Interfaz responsiva instalable como PWA en dispositivos móviles y escritorio.

## Requisitos

- Node.js compatible con las dependencias del proyecto.
- npm.
- Docker Desktop, necesario para ejecutar Supabase localmente.
- Supabase CLI.

## Instalación

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Crea el archivo local de variables de entorno:

   ```bash
   cp .env.example .env.local
   ```

3. Inicia los servicios locales de Supabase:

   ```bash
   npm run db:start
   ```

4. Consulta las claves locales que imprime Supabase:

   ```bash
   npm run db:status
   ```

   Copia la `anon key` en `NEXT_PUBLIC_SUPABASE_ANON_KEY` y la `service_role key` en `SUPABASE_SERVICE_ROLE_KEY` dentro de `.env.local`. La clave `service_role` es privada y solo debe utilizarse en el servidor.

5. Inicia Next.js en modo desarrollo:

   ```bash
   npm run dev
   ```

   Abre [http://localhost:3000](http://localhost:3000). El panel de Supabase Studio está disponible en [http://localhost:54323](http://localhost:54323).

## Despliegue en Netlify

Netlify detecta automáticamente el framework Next.js del repositorio. No se necesita un `netlify.toml` adicional para el despliegue básico.

### 1. Crear el sitio

1. Sube el proyecto a un repositorio de GitHub, GitLab o Bitbucket.
2. En Netlify, selecciona **Add new project** y después **Import an existing project**.
3. Conecta el proveedor Git y selecciona este repositorio.
4. Usa estos valores de construcción:

   ```text
   Build command: npm run build
   Publish directory: .next
   ```

   Netlify utiliza su runtime de Next.js para servir las rutas dinámicas, Server Actions y funciones del servidor. Si el panel ofrece la detección automática de Next.js, puedes conservarla.

### 2. Configurar variables de entorno

En **Site configuration > Environment variables**, agrega estas variables para los contextos de producción y deploy previews:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
```

Obtén la URL y las claves desde **Supabase > Project Settings > API**. `SUPABASE_SERVICE_ROLE_KEY` es una credencial privada: configúrala únicamente como variable de entorno de Netlify y no la incluyas en el código del cliente, en el repositorio ni en logs.

### Alerta de secretos de Netlify

Si Netlify muestra `Your build failed because we found potentially exposed secrets` para `NEXT_PUBLIC_SUPABASE_ANON_KEY` o `NEXT_PUBLIC_SUPABASE_URL`, edita esas dos variables en Netlify y desmarca **Contains secret values**. También puedes eliminarlas y crearlas de nuevo como variables normales. Ambas se incorporan intencionalmente al bundle del navegador porque usan el prefijo `NEXT_PUBLIC_`; la URL de Supabase y la clave `anon` no deben tratarse como secretos de servidor.

Conserva **Contains secret values** únicamente para `SUPABASE_SERVICE_ROLE_KEY` y limita esa variable al ámbito del servidor/Functions cuando la interfaz de Netlify lo permita. No publiques su valor en el repositorio, en logs ni en el bundle del cliente.

Después de cambiar la clasificación, ejecuta **Clear cache and deploy site**. No es necesario desactivar el escaneo global de secretos.

### 3. Configurar las URLs de autenticación en Supabase

Después de conocer el dominio de Netlify, por ejemplo `https://sac-comite.netlify.app`:

1. En Supabase, abre **Authentication > URL Configuration**.
2. Define **Site URL** con la URL de producción.
3. Agrega como redirect URL la URL de producción y, si se usan previews, el dominio de previews que corresponda.

   ```text
   https://sac-comite.netlify.app
   https://sac-comite.netlify.app/**
   ```

No agregues comodines amplios en producción. Incluye solo los dominios controlados por el proyecto.

### 4. Desplegar y comprobar

1. Pulsa **Deploy site** en Netlify.
2. Revisa el registro de build y confirma que termine con `npm run build` exitosamente.
3. Abre la URL pública y verifica login, recuperación de contraseña y selección de comité.
4. Comprueba que las operaciones estén aisladas entre comités y que las rutas protegidas redirijan a `/login` cuando no hay sesión.

Para desplegar cambios posteriores, haz push a la rama conectada. Netlify ejecutará de nuevo la instalación y el build automáticamente. Las migraciones de Supabase no se aplican desde Netlify: ejecútalas contra el proyecto Supabase correspondiente usando Supabase CLI y revisa primero cualquier cambio de esquema.

## Base de datos

Las migraciones versionadas están en `supabase/migrations` y se aplican en orden. Para reconstruir la base de datos local desde cero:

```bash
npm run db:reset
```

Comandos útiles:

```bash
npm run db:start       # Inicia Supabase local
npm run db:status      # Muestra servicios, URLs y claves locales
npm run db:stop        # Detiene Supabase local
npm run db:migration   # Crea una nueva migración
```

No guardes claves reales ni archivos `.env.local` en el repositorio. Las claves públicas quedan protegidas por RLS; la `service_role` omite RLS y nunca debe exponerse al navegador.

## Scripts de desarrollo

```bash
npm run dev            # Servidor de desarrollo
npm run build          # Compilación de producción
npm run start          # Servidor de producción
npm run typecheck      # Verificación de TypeScript
npm run lint           # ESLint
npm run test           # Pruebas unitarias y de propiedades
npm run test:watch     # Pruebas en modo observación
npm run test:integration # Pruebas de integración
npm run format         # Formatea el proyecto
npm run format:check   # Comprueba el formato
```

Antes de abrir un cambio, se recomienda ejecutar:

```bash
npm run typecheck && npm run lint && npm run test
```

## Estructura del proyecto

```text
src/
  app/          Rutas, páginas, layouts y endpoints de Next.js
  components/   Componentes reutilizables de la interfaz
  domain/       Tipos y reglas de dominio financiero
  lib/          Utilidades y clientes compartidos
  server/       Servicios de negocio, autorización y acciones del servidor
supabase/
  migrations/   Esquema, RLS, funciones y datos iniciales de PostgreSQL
scripts/        Mantenimiento, respaldos y utilidades operativas
tests/          Pruebas de integración
public/         Manifest, service worker e iconos de la PWA
```

## Principios técnicos

- **Multi-tenant:** cada operación pertenece a un comité y el acceso se filtra por políticas RLS y autorización del servidor.
- **Ledger financiero:** los saldos se derivan de los movimientos registrados; no se editan como un valor arbitrario.
- **Auditoría:** las operaciones sensibles deben conservar trazabilidad.
- **Servidor y cliente separados:** las claves privadas y las operaciones privilegiadas permanecen en código de servidor.
- **Diseño mobile-first:** la aplicación puede utilizarse desde teléfono, tableta o computadora.

## Documentación

El documento de requerimientos y diseño técnico se encuentra en [SAC_requerimientos_diseno_tecnico.md](SAC_requerimientos_diseno_tecnico.md). Ahí se describe el alcance funcional, los roles, el modelo multi-comité y las decisiones de arquitectura.

## Estado del proyecto

El proyecto se encuentra en desarrollo activo. Las funcionalidades disponibles pueden consultarse en las rutas de `src/app`, mientras que el documento técnico sirve como referencia para el alcance del MVP y las siguientes fases.
