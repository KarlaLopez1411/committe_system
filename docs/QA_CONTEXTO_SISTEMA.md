# SAC — Documento de Contexto para QA
**Sistema de Administración Comunitaria**  
**Versión:** 1.0  
**Fecha:** 3 de septiembre de 2026

---

## 1. Resumen Ejecutivo

**SAC** es una plataforma multi-comité para administrar operaciones financieras y organizativas de comités de ayuda comunitaria. El sistema centraliza:

- Ingresos, egresos, aportaciones voluntarias y donaciones
- Registro y gestión de miembros
- Control de usuarios y roles (RBAC)
- Cortes de caja mensuales y por actividad
- Sistema anual de bonos (beneficiarios, vendedores, cobros, sorteos)
- Auditoría completa de cambios
- Reportes y transparencia

**Arquitectura:** Next.js 15 + React 19 + TypeScript + Supabase (PostgreSQL) + PWA  
**Modelo:** Multi-tenant (multi-comité) con Row Level Security (RLS)  
**Principio:** Aislamiento estricto de datos por comité + Ledger como fuente de verdad financiera

---

## 2. Requerimientos Críticos para Testing

### 2.1 Autenticación y Sesiones (RF-010)
- ✅ Login con correo y contraseña
- ✅ Recuperación de contraseña
- ✅ Cierre de sesión
- ⏳ MFA para roles sensibles (fase de endurecimiento)
- **Timeout por inactividad:** 30 minutos (expiración automática de sesión)

**Consideración QA:** Validar que sesiones expiren exactamente a los 30 min de inactividad, independientemente de pestaña activa.

### 2.2 Aislamiento de Datos (RF-002, RF-003)
- Un usuario solo accede a comités asignados
- Aislamiento a nivel BD (RLS) + validaciones servidor
- Cada registro tiene `committee_id`

**Consideración QA:** Crear usuarios en comités A y B, verificar que no pueden ver datos del otro comité. Intentar ataques de IDOR (cambiar `committee_id` en requests).

### 2.3 Miembros (RF-020, RF-021)
- Registro de miembros con: nombre, teléfono, cargo, estado, fecha incorporación, notas
- Estados: `activo`, `inactivo`, `baja`
- **Separación miembro/usuario:** Un miembro NO necesita cuenta. Un usuario PUEDE vincularse opcionalmente a un miembro.
- **Vínculo usuario↔miembro:** Máx. 1 usuario por miembro (unicidad por comité)

**Consideración QA:** Probar asignación/cambio/desasignación de usuarios a miembros. Verificar que no se puede asignar el mismo usuario a dos miembros en un comité.

### 2.4 Transacciones Financieras (RF-030+)
- Ingresos, egresos, transferencias internas
- Comprobantes
- Aportaciones voluntarias
- Donaciones
- Actividades y cortes por actividad

**Consideración QA:** Validar que todas las transacciones crean un audit log. Probar que no se puede aprobar transacción propia (si aplica permiso).

### 2.5 Bonos (RF-050+)
- Campañas anuales
- Números y beneficiarios
- Vendedores
- Cobros mensuales
- Entregas y sorteos
- Integración automática con ingresos/egresos

**Consideración QA:** Flujo completo de bono: crear campaña → asignar números → registrar cobros → sortear → pagar premios.

---

## 3. Matriz de Roles y Permisos

### 3.1 Roles Predefinidos (9 roles)

| Rol | Descripción | Alcance |
|---|---|---|
| **Superadministrador** | Admin global de plataforma | Todos los permisos, todos los comités |
| **Administrador Comité** | Configuración del comité actual | Todos los permisos (a nivel de comité) |
| **Presidente** | Supervisión y aprobaciones | Lectura general + aprobación transacciones + cierre cortes |
| **Tesorero** | Operaciones financieras completas | Crear/aprobar/anular transacciones, cortes, bonos |
| **Secretario** | Miembros y actividades | Gestión completa de miembros + lectura financiera |
| **Capturista** | Captura limitada | Crear (sin aprobar/anular/cerrar) |
| **Vendedor de Bonos** | Bonos asignados y cobros | Lectura de bonos + cobros |
| **Auditor** | Solo lectura + auditoría | Lectura de todo + acceso a audit logs |
| **Miembro** | Información limitada propia | Solo reportes personales |

### 3.2 Permisos (18 totales)

#### Miembros (3)
- `members.read` — Lectura
- `members.create` — Crear
- `members.update` — Editar

#### Transacciones (4)
- `transactions.read` — Lectura
- `transactions.create` — Crear
- `transactions.approve` — Aprobar
- `transactions.void` — Anular

#### Cortes de Caja (3)
- `cash_closings.create` — Crear
- `cash_closings.review` — Revisar
- `cash_closings.close` — Cerrar

#### Bonos (4)
- `bonuses.read` — Lectura
- `bonuses.collect` — Cobrar
- `bonuses.settle` — Registrar/liquidar
- `bonuses.draw` — Sortear/dibujar

#### Generales (4)
- `reports.read` — Ver reportes
- `users.manage` — Gestionar usuarios y roles
- `committee.manage` — Configurar comité
- `audit.read` — Ver auditoría

### 3.3 Matriz Detallada de Permisos por Rol

| Permiso | SuperAdmin | Admin Comité | Presidente | Tesorero | Secretario | Capturista | Vendedor | Auditor | Miembro |
|---------|:----------:|:------------:|:----------:|:--------:|:----------:|:----------:|:--------:|:-------:|:-------:|
| **members.read** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| **members.create** | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **members.update** | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **transactions.read** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| **transactions.create** | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **transactions.approve** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **transactions.void** | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **cash_closings.create** | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **cash_closings.review** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **cash_closings.close** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **bonuses.read** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **bonuses.collect** | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **bonuses.settle** | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **bonuses.draw** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **reports.read** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **users.manage** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **committee.manage** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **audit.read** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

---

## 4. Flujos Principales

### 4.1 Registro e Ingreso al Sistema
1. Usuario se registra con correo/contraseña
2. Selecciona o es asignado a un comité
3. Se le asigna un rol en ese comité
4. En login subsecuente, ve solo comités y datos autorizados

**QA:** Verificar que rol asignado restringe acciones inmediatamente (no aparecen botones de acciones no permitidas).

### 4.2 Gestión de Miembros
1. Secretario/Admin crea miembro con datos básicos
2. Opcionalmente, admin vincula al miembro con un usuario del sistema (con permiso `users.manage`)
3. Se muestra insignia "👤 Con usuario" en listado de miembros
4. En modal de editar miembro: selector "Usuario vinculado" con opciones para asignar/cambiar/desvincular

**QA:** 
- Verificar que solo usuarios con `users.manage` ven el selector
- Probar que no se puede asignar mismo usuario a dos miembros
- Probar desvincular y reasignar

### 4.3 Registro de Transacción Financiera
1. Capturista crea transacción (ingreso/egreso/transferencia)
2. Transacción entra como "pendiente de aprobación"
3. Tesorero o Presidente la revisa y aprueba
4. Se registra en ledger y crea audit log
5. Se ve reflejada en saldos y reportes

**QA:**
- Capturista no puede aprobar (si se intenta debe fallar)
- Tesorero puede crear y aprobar (¿puede aprobar propia? → depende regla)
- Transacción anulada solo con `transactions.void`

### 4.4 Corte de Caja Mensual
1. Tesorero crea corte (toma transacciones del período)
2. Presidente o Tesorero revisa con `cash_closings.review`
3. Tesorero cierra con `cash_closings.close`
4. Sistema calcula saldo final y lo bloquea para edición

**QA:**
- Corte no puede cerrarse si hay transacciones pendientes
- Una vez cerrado, no se puede editar
- Reporte del corte es auditable

### 4.5 Sistema de Bonos (Flujo Anual)
1. **Crear campaña:** Admin define año, montos, reglas
2. **Asignar números:** Admin asigna a beneficiarios
3. **Asignar vendedores:** Tesorero asigna a vendedores
4. **Registrar cobros:** Vendedor cobra durante el año (permiso `bonuses.collect`)
5. **Liquidar:** Tesorero registra entregas (permiso `bonuses.settle`)
6. **Sortear:** Tesorero/Presidente realiza sorteo (permiso `bonuses.draw`)
7. **Pagar premios:** Tesorero crea transacción de egreso para pago de premios

**QA:**
- Vendedor solo ve sus bonos asignados
- Vendedor no puede crear/liquidar/sortear (falta permiso)
- Sorteado se integra automáticamente con transacción de egreso

---

## 5. Consideraciones de Testing

### 5.1 Seguridad (RBAC y Aislamiento)
- ✅ Verificar cada permiso gatea sus acciones
- ✅ Crear usuarios en múltiples comités, verificar no hay cross-contamination
- ✅ Intentar acceso directo a recursos de comité no autorizado (IDOR)
- ✅ Verificar que cambiar rol refresca permisos inmediatamente

### 5.2 Auditoría
- ✅ Toda operación de escritura crea audit log con: usuario, timestamp, acción, valores viejos/nuevos, comité
- ✅ Auditor ve auditoría, otros roles no (o solo partial)
- ✅ Audit logs no pueden ser editados o borrados

### 5.3 Datos Financieros
- ✅ Ledger es fuente de verdad (no editable directamente)
- ✅ Saldos calculados a partir de ledger (no campo editable)
- ✅ Reporte de saldos coincide con suma de ledger
- ✅ Transferencias internas suman cero (salida de A = entrada a B)

### 5.4 Sesiones y Expiración
- ✅ Sesión expira tras 30 min de inactividad
- ✅ Al expirar, usuario redirigido a login
- ✅ Datos sensibles no se cachean en localStorage sin encripción
- ✅ CSRF tokens validan operaciones críticas

### 5.5 Interfaz de Usuario
- ✅ Botones deshabilitados para acciones no permitidas (no solo ocultos)
- ✅ Mensajes de error claros y en español
- ✅ Confirmaciones para operaciones irreversibles (eliminar, cerrar corte, sortear)
- ✅ PWA funciona offline (caché de datos críticos) + sincroniza al reconectar

### 5.6 Miembros y Usuarios
- ✅ Miembro sin usuario vinculado funciona normalmente
- ✅ Usuario sin miembro vinculado funciona normalmente
- ✅ Vincular usuario a miembro muestra insignia "👤 Con usuario" inmediatamente
- ✅ Desvincular usuario actualiza BD y UI sin refresh

---

## 6. Pantallas y Funcionalidades Principales

### 6.1 Autenticación
- `/login` — Inicio de sesión
- `/recuperar` — Recuperación de contraseña
- `/registro` — Registro de usuario
- `/seleccionar-comite` — Selección de comité activo (si usuario tiene acceso a múltiples)

### 6.2 Aplicación Principal
- `/` → Dashboard (próximamente)
- `/miembros` — Listado, alta, edición y eliminación de miembros + asignación de usuarios
- `/configuracion` — Datos del comité + gestión de usuarios y roles
- `/usuarios` — Listado de usuarios con roles y miembros vinculados (alternativa)
- `/bonos` — Gestión de campañas, vendedores, cobros, sorteos
- `/transacciones` — Ingresos, egresos, transferencias
- `/aportaciones` — Aportaciones voluntarias por miembro
- `/cortes` — Cortes de caja mensuales
- `/reportes` — Reportes financieros y de actividad

### 6.3 Componentes Críticos
- Modal de editar miembro (con picker de usuario vinculado)
- Selector de comité activo
- Tabla de transacciones con filtros
- Confirmer para operaciones de cierre/aprobación

---

## 7. Checklist de Validación RBAC

Para cada rol, validar:

- [ ] **Ver menú:** Solo ve opciones permitidas
- [ ] **Crear recurso:** `{recurso}.create` gatea botón "+ Crear"
- [ ] **Editar recurso:** `{recurso}.update` gatea botón "Editar"
- [ ] **Eliminar recurso:** Permiso específico gatea botón "Eliminar"
- [ ] **Aprobar/Revisar:** `{recurso}.approve` / `.review` / `.draw` gatean estos botones
- [ ] **Audit:** Solo con `audit.read` ve el log completo
- [ ] **Gestionar usuarios:** Solo con `users.manage` puede asignar roles/usuarios
- [ ] **Mensajes de error:** Permiso denegado (403) muestra error claro
- [ ] **API:** Server rechaza operación si contexto no tiene permiso

---

## 8. Ambientes y Datos de Prueba

### Datos de Prueba Recomendados

**Usuarios por Rol:**
- `super@example.com` — Superadmin
- `admin@comite-a.com` — Admin Comité A
- `pres@comite-a.com` — Presidente Comité A
- `teso@comite-a.com` — Tesorero Comité A
- `secre@comite-a.com` — Secretario Comité A
- `capt@comite-a.com` — Capturista Comité A
- `vend@comite-a.com` — Vendedor de Bonos Comité A
- `audit@comite-a.com` — Auditor Comité A

**Comités:**
- Comité A (para testing de funcionalidades)
- Comité B (para testing de aislamiento)

**Miembros de Comité A:**
- 5 miembros activos (2 con usuario vinculado, 3 sin)
- 2 miembros inactivos
- 1 miembro dado de baja

---

## 9. Referencias

- **Documento de Requerimientos:** `SAC_requerimientos_diseno_tecnico.md`
- **Código de Roles:** `src/server/role-service.ts`
- **Código de Permisos:** `src/server/authz.ts`
- **Migraciones DB:** `supabase/migrations/0002_identity_authz.sql`
- **Gestión de Miembros:** `src/app/(app)/miembros/`

---

**Última Actualización:** 3 de septiembre de 2026  
**Responsable QA:** [Tu equipo]
