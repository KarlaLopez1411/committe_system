# Pruebas de integración — RLS y Auth con PostgreSQL real

Feature: `sac-sistema-administracion-comunitaria` · Task 3.6
Requirements cubiertos: **2.2, 2.3, 5.5, 5.6** (y 2.6 como base del acceso superadmin).

Estas pruebas se ejecutan contra un **PostgreSQL real con RLS activo** y verifican
el aislamiento multi-tenant de extremo a extremo:

- Un usuario del **Comité A no lee ni escribe** datos del Comité B (RLS devuelve 0
  filas en lectura y rechaza / no afecta filas en escritura).
- El **superadministrador** accede a todos los comités.
- El **auditor** tiene acceso de **solo lectura** dentro de su comité (puede
  consultar; la negación de escritura se refuerza en la capa RBAC del servidor).

## Cómo simulan a cada usuario

El _setup_ (crear comités, usuarios, membresías, roles y datos de muestra) se
ejecuta como propietario/superusuario de la base, que **omite RLS** (equivalente
al uso de `service_role` en el servidor).

Cada aserción se ejecuta dentro de una transacción con:

```sql
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<user-uuid>","role":"authenticated"}', true);
```

Así `auth.uid()` resuelve al usuario simulado y las políticas RLS (funciones
`has_committee_access` / `is_superadmin` de la migración `0007`) se aplican como
en producción. La transacción se revierte al final para no persistir cambios.

## Requisitos para ejecutarlas

1. **Driver `pg`** (no es dependencia dura del proyecto):

   ```bash
   npm i -D pg @types/pg
   ```

2. **Un PostgreSQL de pruebas accesible**, en cualquiera de estas formas:

   - **Supabase local** (requiere Docker):

     ```bash
     npm run db:start   # levanta Postgres en el puerto 54322
     npm run db:reset   # aplica las migraciones 0001–0007
     ```

   - **Otra base ya migrada**, indicada por variable de entorno:

     ```bash
     export TEST_DATABASE_URL="postgresql://usuario:clave@host:puerto/base"
     ```

     Por defecto, si no se define `TEST_DATABASE_URL`, se usa
     `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (Supabase local).

## Ejecutar

```bash
npm run test:integration
```

## Comportamiento cuando NO hay base disponible

Si el driver `pg` no está instalado o el puerto de PostgreSQL no responde, el
conjunto se **omite** (`describe.skip`) e imprime un mensaje explicando cómo
habilitarlo, en lugar de fallar el _suite_. Esto permite que CI/sandbox sin
Docker sigan en verde mientras las pruebas quedan listas para entornos con base
de datos.
