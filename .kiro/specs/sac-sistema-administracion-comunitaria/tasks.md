# Implementation Plan: SAC — Sistema de Administración Comunitaria

## Overview

Plan de implementación incremental para SAC, una PWA multi-tenant construida con Next.js + TypeScript + Tailwind sobre Supabase/PostgreSQL. Las tareas siguen las fases del documento fuente (Fase 0 Fundamentos → Fase 5 Reportes/estabilización), de modo que cada tarea construye sobre las anteriores y termina cableando todo. La fuente de verdad financiera es un ledger de apuntes inmutables/reversables; las operaciones críticas se ejecutan como funciones RPC atómicas de PostgreSQL con RLS y RBAC.

Convenciones:
- Los montos se manejan con un tipo `Money` (decimal exacto/centavos), nunca `number` de punto flotante; en PostgreSQL se persisten como `NUMERIC(16,2)`.
- Todas las entidades de comité llevan `committee_id UUID NOT NULL` y políticas RLS por membresía activa.
- Las pruebas basadas en propiedades usan **fast-check** (una prueba por propiedad, mínimo 100 iteraciones) con la etiqueta `// Feature: sac-sistema-administracion-comunitaria, Property N: ...`.
- Las pruebas de integración usan un PostgreSQL real con RLS activo; las de seguridad verifican aislamiento entre comités, alcance del vendedor, auditor de solo lectura y ausencia de `service_role` en el cliente.

## Tasks

- [x] 1. Fase 0 — Fundamentos: scaffolding del proyecto y utilidades base
  - [x] 1.1 Inicializar el proyecto Next.js + TypeScript + Tailwind + PWA
    - Crear la app con App Router y TypeScript estricto (`tsconfig` con `strict: true`)
    - Configurar Tailwind CSS y estilos base mobile-first
    - Configurar PWA (manifest, service worker, íconos) para instalación en Android/iPhone/tablet/desktop
    - Configurar ESLint/Prettier y scripts npm (`build`, `lint`, `test`)
    - Configurar Vitest/Jest y **fast-check** como dependencia de desarrollo para PBT
    - _Requirements: 42.1, 43.1_

  - [x] 1.2 Definir tipos de dominio compartidos y utilidad `Money`
    - Crear `src/domain/types.ts` con `UUID`, `Money`, `Period`, `Ctx`, `Result<T>` (según el diseño)
    - Implementar `src/domain/money.ts`: parseo/validación de decimales exactos (máx. 2 decimales), suma/resta sin punto flotante, comparadores y rangos
    - _Requirements: 41.1_

  - [x] 1.3 Escribir pruebas unitarias de la utilidad `Money`
    - Casos límite: dos decimales, gran magnitud, cero, negativos, entradas no numéricas
    - _Requirements: 41.1_

- [x] 2. Fase 0 — Fundamentos: proyecto Supabase, migraciones del esquema y clientes
  - [x] 2.1 Configurar Supabase y estructura de migraciones SQL
    - Añadir configuración de Supabase local (CLI) y carpeta `supabase/migrations`
    - Crear la migración inicial `0001_extensions.sql` (p. ej. `pgcrypto` para `gen_random_uuid()`)
    - Documentar variables de entorno (anon key en cliente; `service_role` solo en servidor)
    - _Requirements: 40.3, 44.1_

  - [x] 2.2 Migración de identidad y autorización
    - Crear tablas `committees`, `profiles`, `committee_users`, `roles`, `permissions`, `role_permissions`, `user_roles` con checks/uniques del diseño
    - Sembrar los 9 roles y los 18 permisos del catálogo
    - _Requirements: 1.1, 1.3, 2.1, 5.1, 6.1, 8.2_

  - [x] 2.3 Migración de miembros y finanzas
    - Crear tablas `members`, `financial_accounts`, `transaction_categories`, `financial_transactions`, `ledger_entries`, `transaction_attachments`, `transfers`, `cash_closings`, `cash_closing_details` con checks/uniques del diseño (montos `NUMERIC(16,2)`)
    - _Requirements: 7.1, 9.1, 9.2, 10.1, 11.1, 13.3, 14.1, 22.1, 41.1_

  - [x] 2.4 Migración de aportaciones, donaciones y actividades
    - Crear tablas `contributions`, `donations`, `activities`, `activity_members` con checks/uniques (incluye `contributions.financial_transaction_id UNIQUE`)
    - _Requirements: 17.1, 17.4, 18.1, 19.1, 20.1_

  - [x] 2.5 Migración del módulo de bonos
    - Crear tablas `bonus_campaigns`, `bonus_numbers`, `bonus_holder_assignments`, `bonus_sellers`, `bonus_seller_assignments`, `bonus_monthly_dues`, `bonus_collections`, `bonus_settlements`, `bonus_settlement_items`, `bonus_draws`, `bonus_prize_payments`
    - Aplicar uniques clave: `bonus_numbers (campaign_id, number)`, `bonus_monthly_dues (bonus_number_id, period)`, `bonus_draws (campaign_id, period)`, `bonus_settlements.financial_transaction_id UNIQUE`, `bonus_prize_payments.financial_transaction_id UNIQUE`
    - _Requirements: 24.5, 25.2, 29.2, 31.5, 32.2, 33.4, 41.4_

  - [x] 2.6 Migración de auditoría e índices
    - Crear tablas `audit_logs` y `notifications`; índices para agregaciones del dashboard/reportes por `committee_id`, cuenta, periodo
    - _Requirements: 36.1, 45.1_

  - [x] 2.7 Crear clientes Supabase de servidor y de navegador
    - `src/lib/supabase/browser.ts` (solo anon key) y `src/lib/supabase/server.ts` (server-only, puede usar `service_role` en Server Actions)
    - Garantizar que `service_role` nunca se importe en código de cliente
    - _Requirements: 40.2, 40.3_

  - [x] 2.8 Prueba de seguridad: ausencia de `service_role` en el bundle del cliente
    - Analizar el bundle de producción y afirmar que no contiene la `service_role` key
    - _Requirements: 40.3_

- [x] 3. Fase 0 — Fundamentos: RLS, RBAC, Auth y layout PWA
  - [x] 3.1 Implementar funciones y políticas RLS multi-tenant
    - Migración con función segura `has_committee_access(committee_id)` basada en `committee_users` con `status='active'`
    - Políticas RLS SELECT/INSERT/UPDATE/DELETE por `committee_id` en todas las tablas de comité; acceso de superadmin; `audit_logs` sin UPDATE/DELETE para roles de app
    - _Requirements: 2.1, 2.2, 2.4, 2.6, 36.2, 40.2_

  - [x] 3.2 Implementar la capa de autorización (RBAC) en el servidor
    - `src/server/authz.ts`: `effectivePermissions(userId, committeeId)` (unión de roles), `can(ctx, permission)`, `assertCommitteeAccess(ctx, committeeId)`
    - Registrar en auditoría los intentos denegados de acceso/escritura sobre comités ajenos
    - _Requirements: 2.3, 2.5, 5.5, 5.6, 6.2, 6.3_

  - [x] 3.3 Implementar autenticación, sesiones y selección de comité activo
    - `AuthGateway` sobre Supabase Auth: `signIn`, `requestReset` (respuesta genérica), `signOut`, `resolveActiveCommittee`
    - Bloqueo por 5 intentos/15 min, expiración de sesión por inactividad de 30 min, enlace de reset con validez 60 min
    - Middleware que resuelve el `Ctx` (usuario, comité activo, permisos) por solicitud
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 3.4 Construir el layout PWA y las pantallas de autenticación
    - Layout responsivo mobile-first con navegación; pantallas `/login`, recuperar contraseña y selección de comité
    - Componente de confirmación explícita para acciones críticas y validación inmediata de formularios
    - _Requirements: 42.1, 42.2, 42.3, 43.1, 4.8_

  - [x] 3.5 Prueba de propiedad: aislamiento multi-tenant en lectura y escritura
    - **Property 1: Aislamiento multi-tenant en lectura y escritura**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.6**

  - [x] 3.6 Pruebas de integración de RLS y Auth con PostgreSQL real
    - Usuario del Comité A no lee ni escribe datos del Comité B; superadmin sí; auditor solo lectura
    - _Requirements: 2.2, 2.3, 5.5, 5.6_

- [x] 4. Fase 1 — Administración base: CommitteeService y configuración
  - [x] 4.1 Implementar CommitteeService y Server Actions de comité
    - `create`, `updateStatus`, `updateConfig`, `seedDefaultCategories`; validación de nombre 1–150; asignación de `committee_id`; siembra de categorías iniciales al crear
    - Aplicar cambios solo al comité del administrador; auditar cambios de estado/config
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 3.3, 3.4, 13.2_

  - [x] 4.2 Prueba de propiedad: modificar la configuración de un comité preserva los demás
    - **Property 2: Modificar la configuración de un comité preserva los demás**
    - **Validates: Requirements 3.2**

  - [x] 4.3 Pruebas unitarias de validación de comité y configuración
    - Nombre vacío, valores fuera de rango, acceso no autorizado a config ajena
    - _Requirements: 1.2, 3.3, 3.4_

- [x] 5. Fase 1 — Administración base: MemberService, roles y pantallas
  - [x] 5.1 Implementar MemberService y Server Actions de miembros
    - `register` (nombre 1–150, estado {activo,inactivo,baja} default activo, teléfono ≤30, notas ≤500) y `linkUser` (máx. 1 miembro por usuario)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2_

  - [x] 5.2 Implementar asignación de roles a usuarios (users.manage)
    - Validar rol dentro de los 9 predefinidos y que el usuario sea miembro activo; registrar `user_roles`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 5.3 Construir pantallas de miembros y de usuarios/roles/permisos
    - Lista/ficha de miembros con validación inmediata; pantalla de administración de usuarios/roles
    - _Requirements: 7.1, 5.2, 42.2_

  - [x] 5.4 Prueba de propiedad: validación de alta de miembro
    - **Property 3: Validación de alta de miembro**
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5**

- [ ] 6. Fase 1 — Administración base: cuentas financieras y categorías
  - [x] 6.1 Implementar cuentas financieras en FinanceService
    - `createAccount` (nombre ≤80 único por comité, tipo en conjunto permitido, estado activa) y `deactivateAccount` (conserva historial)
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 6.2 Implementar categorías de transacción en FinanceService
    - `createCategory`, `renameCategory` (nombre 1–100, no solo espacios, único por comité), `deleteCategory` (rechaza si tiene ingresos asociados)
    - _Requirements: 13.1, 13.3, 13.4, 13.5_

  - [x] 6.3 Construir pantalla de cuentas y de categorías/configuración del comité
    - Lista de cuentas y gestión de categorías; pantalla de configuración del comité
    - _Requirements: 9.1, 13.1, 3.1_

  - [x] 6.4 Prueba de propiedad: validación y unicidad de cuentas
    - **Property 4: Validación y unicidad de cuentas**
    - **Validates: Requirements 9.1, 9.2**

  - [x] 6.5 Prueba de propiedad: unicidad de nombre de categoría por comité
    - **Property 12: Unicidad de nombre de categoría por comité**
    - **Validates: Requirements 13.3**

  - [x] 6.6 Prueba de propiedad: no se elimina una categoría con ingresos asociados
    - **Property 13: No se elimina una categoría con ingresos asociados**
    - **Validates: Requirements 13.4**

- [~] 7. Checkpoint — Fundamentos y administración base
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Fase 2 — Finanzas: ledger y saldo derivado
  - [x] 8.1 Implementar Ledger_Service (saldo derivado)
    - `getDerivedBalance` = saldo inicial + suma de apuntes; prohibir asignación directa de saldo; reflejar apuntes nuevos
    - Función SQL/vista de saldo derivado por cuenta con índices
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 8.2 Prueba de propiedad: el saldo derivado siempre iguala la suma del ledger
    - **Property 6: El saldo derivado siempre iguala la suma del ledger**
    - **Validates: Requirements 10.1, 10.3**

- [ ] 9. Fase 2 — Finanzas: RPC atómica de ingreso y flujo de registro
  - [x] 9.1 Implementar `rpc_register_income` (PostgreSQL)
    - Crear transacción tipo ingreso + apunte positivo en cuenta receptora; validar comité, permiso `transactions.create`, monto 0.01–límite con ≤2 decimales, cuenta activa/propia; auditar; rollback total
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 41.2, 41.3_

  - [x] 9.2 Implementar `FinanceService.registerIncome` y Server Action + pantalla "Nuevo ingreso"
    - Revalidar datos y RBAC en el servidor; formulario mobile-first con validación inmediata y confirmación
    - _Requirements: 12.1, 12.3, 42.2, 42.3_

  - [x] 9.3 Prueba de propiedad: correspondencia monto–apunte en ingresos y egresos
    - **Property 9: Correspondencia monto–apunte en ingresos y egresos**
    - **Validates: Requirements 12.5, 14.4**

  - [x] 9.4 Prueba de propiedad: validación de monto de ingresos y egresos
    - **Property 10: Validación de monto de ingresos y egresos**
    - **Validates: Requirements 12.2, 14.2**

- [ ] 10. Fase 2 — Finanzas: RPC atómica de egreso y flujo de registro
  - [x] 10.1 Implementar `rpc_register_expense` (PostgreSQL)
    - Crear transacción tipo egreso + apunte negativo en cuenta origen; validar campos obligatorios, monto 0.01–999,999,999.99, cuenta activa; auditar; rollback total
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 41.2, 41.3_

  - [x] 10.2 Implementar `FinanceService.registerExpense` y Server Action + pantalla "Nuevo egreso"
    - Revalidación de servidor y RBAC; formulario mobile-first con validación y confirmación
    - _Requirements: 14.1, 14.3, 42.2, 42.3_

  - [x] 10.3 Prueba de propiedad: los movimientos contra cuentas inactivas se rechazan
    - **Property 5: Los movimientos contra cuentas inactivas se rechazan**
    - **Validates: Requirements 9.4, 14.5**

- [ ] 11. Fase 2 — Finanzas: transferencias internas atómicas
  - [x] 11.1 Implementar `rpc_transfer` (PostgreSQL)
    - Dos apuntes que suman cero (salida/entrada) de forma atómica; rechazar misma cuenta, cuentas de otro comité, monto fuera de rango o saldo insuficiente, y falta de permiso
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 41.2_

  - [x] 11.2 Implementar `FinanceService.transfer` y pantalla "Transferencia"
    - Registrar fila en `transfers` vinculada a la transacción; UI con confirmación explícita
    - _Requirements: 11.1, 42.3_

  - [x] 11.3 Prueba de propiedad: suma cero y saldo consolidado invariante en transferencias
    - **Property 7: La suma de apuntes de una transferencia siempre es cero y no altera el saldo consolidado**
    - **Validates: Requirements 11.2, 11.3**

  - [x] 11.4 Prueba de propiedad: rechazo de transferencias inválidas
    - **Property 8: Rechazo de transferencias inválidas**
    - **Validates: Requirements 11.5, 11.6**

- [ ] 12. Fase 2 — Finanzas: estados, aprobación y anulación controlada
  - [x] 12.1 Implementar aprobación y transición de estados de movimientos
    - `approve` (permiso `transactions.approve`) transiciona a `aprobado` y contabiliza; ciclo borrador→registrado→aprobado
    - _Requirements: 15.1, 15.2_

  - [x] 12.2 Implementar `rpc_void_transaction` y `FinanceService.void`
    - Crear transacción compensatoria con `reversal_of`; impedir modificación/eliminación física de movimientos contabilizados
    - _Requirements: 15.3, 15.4, 41.3_

  - [x] 12.3 Prueba de propiedad: la anulación crea una compensación vinculada sin borrar el original
    - **Property 11: La anulación crea una compensación vinculada sin borrar el original**
    - **Validates: Requirements 15.3, 15.4**

  - [x] 12.4 Pruebas de integración de reversa con PostgreSQL real
    - Reversa compensa el movimiento original dejando saldo neto cero
    - _Requirements: 15.3_

- [ ] 13. Fase 2 — Finanzas: comprobantes en buckets privados
  - [x] 13.1 Configurar Storage privado e implementar adjuntos
    - Bucket privado; `FinanceService.attach` almacena el archivo y registra `transaction_attachments`
    - _Requirements: 16.1, 40.4_

  - [x] 13.2 Implementar generación de Signed_URL autorizada
    - `getSignedUrl` entrega URL de duración limitada solo a usuarios autorizados del comité propietario; negar en caso contrario
    - _Requirements: 16.2, 16.3, 40.4_

  - [x] 13.3 Construir pantalla de movimientos financieros con adjuntos
    - Lista de movimientos, detalle con visualización de comprobantes vía Signed_URL, subida de archivos
    - _Requirements: 16.1, 16.2_

- [ ] 14. Fase 2 — Finanzas: auditoría financiera (AuditService)
  - [x] 14.1 Implementar AuditService integrado en transacciones
    - `record(tx, entry)` participa en la misma transacción de la operación sensible; `query` de solo lectura (incl. auditor); exigir atribución usuario+fecha o rechazar
    - _Requirements: 36.1, 36.3, 36.4, 36.5_

  - [x] 14.2 Construir pantalla de auditoría (solo lectura)
    - Consulta filtrable de `audit_logs` respetando `committee_id`
    - _Requirements: 36.5, 37.1_

  - [x] 14.3 Prueba de propiedad: toda operación sensible exitosa produce auditoría atribuible
    - **Property 36: Toda operación sensible exitosa produce un registro de auditoría atribuible**
    - **Validates: Requirements 36.1**

  - [x] 14.4 Prueba de propiedad: los registros de auditoría son inmutables desde operaciones normales
    - **Property 37: Los registros de auditoría son inmutables desde operaciones normales**
    - **Validates: Requirements 36.2**

  - [x] 14.5 Prueba de propiedad: idempotencia general por referencia única
    - **Property 34: Idempotencia general por referencia única**
    - **Validates: Requirements 41.4**

- [~] 15. Checkpoint — Finanzas
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Fase 3 — Operación comunitaria: aportaciones voluntarias
  - [x] 16.1 Implementar ContributionService
    - `register` (miembro, fecha, periodo, monto>0, método, cuenta; estado en {registrada, sin_aportacion, exento, no_aplica}); nunca genera adeudo automático
    - `confirmMonetary` vincula exactamente una `financial_transaction` de ingreso; rechaza doble vinculación (`financial_transaction_id UNIQUE`)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 16.2 Construir pantalla de aportaciones
    - Registro/listado por miembro y periodo con validación inmediata
    - _Requirements: 17.1, 42.2_

- [x] 17. Fase 3 — Operación comunitaria: donaciones monetarias y en especie
  - [x] 17.1 Implementar DonationService
    - `register` (tipo en conjunto cerrado, origen en conjunto cerrado; especie con descripción 1–500, cantidad>0 ≤límite, destino 1–200, valor estimado opcional marcado "estimado" sin tocar saldo)
    - `confirmMonetary` vincula una `financial_transaction` de ingreso en una única transacción con rollback total ante fallo
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

  - [x] 17.2 Construir pantalla de donaciones
    - Formulario dinámico dinero/especie con validación inmediata
    - _Requirements: 18.1, 42.2_

  - [x] 17.3 Prueba de propiedad: el valor estimado de una donación en especie no altera el saldo de efectivo
    - **Property 14: El valor estimado de una donación en especie no altera el saldo de efectivo**
    - **Validates: Requirements 18.5**

- [x] 18. Fase 3 — Operación comunitaria: actividades y resultado
  - [x] 18.1 Implementar ActivityService (crear y asociar movimientos)
    - `create` (estado {planeada, activa, finalizada, cerrada}; fecha fin ≥ inicio); asociación de movimiento a actividad no cerrada (máx. 1 por movimiento)
    - _Requirements: 19.1, 19.2, 20.1, 20.2_

  - [x] 18.2 Implementar cálculo de resultado de actividad
    - `computeResult` = ingresos aprobados − egresos aprobados, excluyendo no aprobados/anulados; recalcular al asociar/desasociar/aprobar/anular
    - _Requirements: 20.3, 20.4, 20.5_

  - [x] 18.3 Implementar corte de actividad (closeCut)
    - Solo desde estado `finalizada`, con permiso; bloquear doble cierre; generar resumen (ingresos, egresos, resultado, comprobantes, responsable); bloquear modificación tras cierre salvo ajuste auditado
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6_

  - [x] 18.4 Construir pantallas de actividades y corte de actividad
    - Lista/detalle de actividades y vista de corte
    - _Requirements: 19.1, 21.1_

  - [x] 18.5 Prueba de propiedad: validación de fechas de actividad
    - **Property 15: Validación de fechas de actividad**
    - **Validates: Requirements 19.2**

  - [x] 18.6 Prueba de propiedad: el resultado de una actividad suma solo movimientos aprobados
    - **Property 16: El resultado de una actividad suma solo movimientos aprobados**
    - **Validates: Requirements 20.3, 20.4, 20.5**

  - [x] 18.7 Prueba de propiedad: cierre de corte de actividad solo desde estado finalizada y una sola vez
    - **Property 17: Cierre de corte de actividad solo desde estado finalizada y una sola vez**
    - **Validates: Requirements 21.4, 21.5**

- [x] 19. Fase 3 — Operación comunitaria: cortes mensuales de caja
  - [x] 19.1 Implementar CashClosingService (apertura y captura)
    - `open` calcula saldo teórico = saldo inicial + ingresos − egresos del periodo; `captureReal` valida saldo real (0.00–999,999,999.99) y calcula diferencia = real − teórico
    - Flujo abierto→en_revision→aprobado→cerrado (`review`, `approve`)
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 23.1_

  - [x] 19.2 Implementar `rpc_close_cash_closing` (cierre atómico)
    - Transición aprobado→cerrado; rechazar doble cierre; cambios retroactivos requieren ajuste autorizado + auditoría
    - _Requirements: 23.2, 23.3, 23.4_

  - [x] 19.3 Construir pantalla de corte mensual
    - Selección de cuenta+periodo, captura de saldo real, flujo de revisión/aprobación/cierre con confirmación
    - _Requirements: 22.1, 23.1, 42.3_

  - [x] 19.4 Prueba de propiedad: cálculo del corte mensual de caja
    - **Property 18: Cálculo del corte mensual de caja**
    - **Validates: Requirements 22.1, 22.2, 22.4**

  - [x] 19.5 Prueba de propiedad: un corte no se cierra dos veces
    - **Property 19: Un corte no se cierra dos veces**
    - **Validates: Requirements 23.3**

  - [x] 19.6 Prueba de seguridad: capturista sin permiso no cierra corte
    - Verificar rechazo por RBAC cuando falta `cash_closings.close`
    - _Requirements: 6.2, 23.2_

- [~] 20. Checkpoint — Operación comunitaria
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Fase 4 — Bonos: campañas, números y beneficiarios
  - [x] 21.1 Implementar BonusCampaignService (campaña y números)
    - `createCampaign` (año 2000–2100, rango de números válido, aportación/premio>0, meses 1–12, unicidad por año, estado inicial borrador)
    - `generateNumbers` crea `fin−inicio+1` números únicos dentro de la campaña
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 25.1, 25.2_

  - [x] 21.2 Implementar asignación de beneficiarios con historial
    - `assignHolder` conserva la asignación anterior con `valid_to` y crea una nueva vigente; a lo sumo un titular vigente
    - _Requirements: 26.1, 26.2_

  - [x] 21.3 Implementar reglas de elegibilidad configurables
    - `saveEligibilityRules` persiste los seis parámetros con atribución (fecha, usuario, campaña) y marca la campaña con reglas definidas
    - _Requirements: 34.1, 34.2_

  - [x] 21.4 Construir pantallas de campañas y matriz de números/beneficiarios
    - Configuración de campaña, generación de números y matriz con filtros
    - _Requirements: 24.1, 26.1_

  - [x] 21.5 Prueba de propiedad: validación de parámetros de campaña de bonos
    - **Property 20: Validación de parámetros de campaña de bonos**
    - **Validates: Requirements 24.2, 24.3, 24.4**

  - [x] 21.6 Prueba de propiedad: unicidad de campaña por año
    - **Property 21: Unicidad de campaña por año**
    - **Validates: Requirements 24.5**

  - [x] 21.7 Prueba de propiedad: la generación de números produce el rango completo y único
    - **Property 22: La generación de números produce el rango completo y único**
    - **Validates: Requirements 25.1, 25.2**

  - [x] 21.8 Prueba de propiedad: el cambio de titular conserva el historial y deja un único vigente
    - **Property 23: El cambio de titular conserva el historial y deja un único vigente**
    - **Validates: Requirements 26.2**

- [x] 22. Fase 4 — Bonos: vendedores y asignaciones
  - [x] 22.1 Implementar asignación de vendedores
    - `assignSellers` (1–500 números; rechaza número/vendedor inexistente y >500; cierra asignación vigente previa con `valid_to` y crea la nueva); a lo sumo un vendedor vigente por número
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5_

  - [x] 22.2 Implementar estado por vendedor (BonusCollectionService.sellerStatus)
    - Números asignados, esperado, cobrado, entregado, pendiente por cobrar, pendiente por entregar
    - _Requirements: 28.1_

  - [x] 22.3 Construir pantalla de vendedores (administración)
    - Asignación de números y vista de estado por vendedor
    - _Requirements: 27.1, 28.1_

  - [x] 22.4 Prueba de propiedad: a lo sumo un vendedor vigente por número
    - **Property 24: A lo sumo un vendedor vigente por número**
    - **Validates: Requirements 27.4, 27.5**

- [x] 23. Fase 4 — Bonos: mensualidades y cobros
  - [x] 23.1 Implementar generación de mensualidades
    - `generateMonthlyDues` crea una mensualidad por número activo por periodo con UNIQUE(número, periodo); ciclo pendiente→cobrado_vendedor→entregado_tesoreria→confirmado con bitácora de transición
    - _Requirements: 29.1, 29.2, 29.3, 29.4_

  - [x] 23.2 Implementar registro de cobro (recordCollection)
    - Permiso `bonuses.collect`; transiciona a `cobrado_vendedor`; no incrementa saldo del comité; rechaza monto ≤ 0
    - _Requirements: 30.1, 30.2, 30.3_

  - [x] 23.3 Construir pantalla de cobranza mensual (administración)
    - Matriz de cobranza por periodo con registro de cobros
    - _Requirements: 30.1_

  - [x] 23.4 Prueba de propiedad: nunca dos mensualidades para el mismo número y periodo
    - **Property 25: Nunca dos mensualidades para el mismo número y periodo**
    - **Validates: Requirements 29.1, 29.2**

  - [x] 23.5 Prueba de propiedad: un cobro de vendedor no incrementa el saldo del comité
    - **Property 26: Un cobro de vendedor no incrementa el saldo del comité**
    - **Validates: Requirements 30.2**

- [x] 24. Fase 4 — Bonos: entregas y confirmación de tesorería (integración con ledger)
  - [x] 24.1 Implementar reporte de entrega (BonusSettlementService.report)
    - Agrupa uno o más cobros; monto reportado = suma de cobros en rango 0.01–999,999,999.99; estado `reportada`; registra `bonus_settlement_items`
    - _Requirements: 31.1, 31.2_

  - [x] 24.2 Implementar `rpc_confirm_settlement` (confirmación atómica)
    - Rechaza si el confirmador es el vendedor que reportó o falta `bonuses.settle`; rechaza doble confirmación (`financial_transaction_id UNIQUE`)
    - En una transacción: crea ingreso categoría Bonos, transiciona mensualidades a `confirmado`, registra monto/fecha/usuario, marca entrega `confirmada`, audita; rollback total dejando `reportada`
    - _Requirements: 31.3, 31.4, 31.5, 31.6, 41.2, 41.4_

  - [x] 24.3 Construir pantallas de entregas y confirmación de tesorería
    - Reporte de entrega (vendedor) y confirmación (tesorería) con confirmación explícita
    - _Requirements: 31.1, 31.3, 42.3_

  - [x] 24.4 Prueba de propiedad: el monto reportado de una entrega es la suma de sus cobros
    - **Property 27: El monto reportado de una entrega es la suma de sus cobros**
    - **Validates: Requirements 31.1, 31.2**

  - [x] 24.5 Prueba de propiedad: un vendedor nunca confirma su propia entrega
    - **Property 28: Un vendedor nunca confirma su propia entrega**
    - **Validates: Requirements 31.4**

  - [x] 24.6 Prueba de propiedad: confirmar una entrega dos veces nunca crea dos ingresos
    - **Property 29: Confirmar una entrega dos veces nunca crea dos ingresos (idempotencia de entrega)**
    - **Validates: Requirements 31.3, 31.5**

  - [x] 24.7 Pruebas de integración de confirmación de entrega con PostgreSQL real
    - Confirmar → exactamente un ingreso; confirmación concurrente → solo una prospera por `UNIQUE`
    - _Requirements: 31.3, 31.5, 41.4_

- [x] 25. Fase 4 — Bonos: sorteos y pago de premios
  - [x] 25.1 Implementar registro de sorteo (BonusDrawService.registerDraw)
    - Permiso `bonuses.draw`; UNIQUE(campaign_id, period); captura beneficiario vigente; exige los seis parámetros de reglas definidos antes de ejecutar
    - _Requirements: 32.1, 32.2, 34.3, 34.4_

  - [x] 25.2 Implementar `rpc_pay_prize` (pago atómico de premio)
    - Rechaza sorteo inexistente, falta de permiso y segundo pago (`financial_transaction_id UNIQUE`, UNIQUE(draw_id)); crea egreso categoría "Premio de bono" con monto=premio; vincula `prize_payment`; audita; rollback total
    - _Requirements: 33.1, 33.2, 33.3, 33.4, 33.5, 41.2_

  - [x] 25.3 Construir pantallas de sorteo mensual y pago de premio
    - Registro de sorteo con evidencia y pago de premio con confirmación
    - _Requirements: 32.1, 33.1, 42.3_

  - [x] 25.4 Prueba de propiedad: nunca dos sorteos por campaña y periodo
    - **Property 30: Nunca dos sorteos por campaña y periodo**
    - **Validates: Requirements 32.2**

  - [x] 25.5 Prueba de propiedad: pagar un premio dos veces nunca crea dos egresos
    - **Property 31: Pagar un premio dos veces nunca crea dos egresos (idempotencia de premio)**
    - **Validates: Requirements 33.1, 33.4**

  - [x] 25.6 Prueba de propiedad: el sorteo exige las seis reglas definidas y aplica solo las configuradas
    - **Property 32: El sorteo exige las seis reglas definidas y aplica solo las configuradas**
    - **Validates: Requirements 34.3, 34.4**

  - [x] 25.7 Pruebas de integración de pago de premio con PostgreSQL real
    - Pagar premio → exactamente un egreso; segundo pago rechazado
    - _Requirements: 33.1, 33.4_

- [x] 26. Fase 4 — Bonos: portal de vendedor mobile-first
  - [x] 26.1 Implementar el Seller_Portal (backend de acceso restringido)
    - Devolver solo los números asignados al vendedor en el comité activo con importes cobrado/por cobrar/por entregar; acciones registrar cobro y reportar entrega restringidas a sus asignaciones; negar acceso a asignaciones ajenas/otro comité
    - Manejo de fallo de dependencia preservando datos previos
    - _Requirements: 39.1, 39.2, 39.3, 39.4, 39.5, 39.6, 39.7_

  - [x] 26.2 Construir la UI mobile-first del portal de vendedor
    - Vista de números del periodo, registrar cobro y reportar entrega (sin confirmar su propia recepción)
    - _Requirements: 39.1, 39.2, 39.5, 42.1_

  - [x] 26.3 Prueba de propiedad: reportes, indicadores y portal restringidos al comité y al vendedor
    - **Property 38: Reportes, indicadores y portal restringidos al comité y al vendedor**
    - **Validates: Requirements 37.1, 38.2, 39.1, 39.7, 45.1**

  - [x] 26.4 Prueba de seguridad: el vendedor solo ve y opera sus números asignados
    - Un vendedor no accede a números ajenos ni de otro comité
    - _Requirements: 39.1, 39.7_

- [~] 27. Checkpoint — Bonos
  - Ensure all tests pass, ask the user if questions arise.

- [x] 28. Fase 5 — Reportes y estabilización: reportes, exportaciones, corte de bonos
  - [x] 28.1 Implementar ReportService (reportes y corte mensual de bonos)
    - `bonusMonthlyCut` (esperado, cobrado, pendiente de cobro, entregado, en poder de vendedores, premio, pagado/pendiente, resultado de caja); `generate` restringido al comité activo (permiso `reports.read`)
    - _Requirements: 35.1, 37.1_

  - [x] 28.2 Implementar exportaciones PDF/XLSX/CSV
    - `export` produce el archivo en el formato solicitado (PDF, XLSX o CSV)
    - _Requirements: 37.2_

  - [x] 28.3 Construir pantalla de reportes
    - Selección de reporte, parámetros y botones de exportación
    - _Requirements: 37.1, 37.2_

  - [x] 28.4 Prueba de propiedad: identidades de agregación del corte mensual de bonos
    - **Property 33: Identidades de agregación del corte mensual de bonos**
    - **Validates: Requirements 35.1**

  - [x] 28.5 Pruebas unitarias del corte de bonos y exportaciones
    - Ejemplo $3,000/$2,850/$150 y verificación de formato de cada exportación
    - _Requirements: 35.1, 37.2_

- [x] 29. Fase 5 — Reportes y estabilización: dashboard
  - [x] 29.1 Implementar Dashboard_Service con agregaciones del servidor
    - Indicadores (saldo consolidado/por cuenta, ingresos/egresos/resultado del mes, miembros activos, cobrado por vendedores, entregado, pendiente de entregar, comprobantes faltantes) restringidos al `committee_id`, usando agregaciones/índices del servidor
    - _Requirements: 38.1, 38.2, 45.1_

  - [x] 29.2 Construir la pantalla de dashboard
    - Tarjetas de indicadores responsivas mobile-first
    - _Requirements: 38.1, 42.1_

- [x] 30. Fase 5 — Reportes y estabilización: escalabilidad, seguridad e integración final
  - [x] 30.1 Implementar rate limiting, escalabilidad multi-tenant y respaldos programados
    - Rate limiting en operaciones críticas; alta de nuevo comité sin instalación separada; scripts/config de respaldos de PostgreSQL y de comprobantes
    - _Requirements: 40.1, 40.5, 44.1, 44.2_

  - [x] 30.2 Cablear la navegación completa y el flujo end-to-end del MVP
    - Integrar todas las pantallas en la navegación (comité→miembros→cuentas→finanzas→actividades→bonos→reportes→auditoría) y verificar el recorrido completo del criterio de éxito del MVP mediante código
    - _Requirements: 43.1, 1.1, 12.1, 31.3, 33.1, 23.2_

  - [x] 30.3 Prueba de propiedad: atomicidad y rollback total de operaciones críticas
    - **Property 35: Atomicidad y rollback total de operaciones críticas**
    - **Validates: Requirements 18.7, 31.6, 33.5, 36.4, 41.3**

  - [x] 30.4 Pruebas de integración financieras end-to-end con PostgreSQL real
    - Ingreso/egreso/transferencia/reversa; transferencia no altera saldo consolidado; idempotencia por referencia
    - _Requirements: 11.3, 15.3, 41.4_

  - [x] 30.5 Suite de pruebas de seguridad de estabilización
    - Aislamiento A/B, vendedor restringido, auditor solo lectura, capturista sin cierre, `service_role` ausente en cliente
    - _Requirements: 2.2, 5.6, 6.2, 39.7, 40.3_

- [~] 31. Checkpoint final — Reportes y estabilización
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Las tareas marcadas con `*` son opcionales (pruebas unitarias, de propiedad, de integración y de seguridad) y pueden omitirse para un MVP más rápido, aunque se recomiendan por tratarse de un sistema financiero.
- Cada tarea referencia requerimientos específicos (Requirements N.M) para trazabilidad; las pruebas de propiedad referencian además su Property del diseño.
- Las 38 correctness properties del diseño se implementan cada una como una sola prueba con **fast-check**, mínimo 100 iteraciones, etiquetadas con `// Feature: sac-sistema-administracion-comunitaria, Property N: ...`.
- Las operaciones críticas (ingreso, egreso, transferencia, anulación, confirmación de entrega, pago de premio, cierre de corte) se implementan como RPC atómicas de PostgreSQL con rollback total y auditoría en la misma transacción.
- Los checkpoints permiten validación incremental al término de cada fase.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 3, "tasks": ["2.7", "3.1"] },
    { "id": 4, "tasks": ["2.8", "3.2", "3.3"] },
    { "id": 5, "tasks": ["3.4", "3.5", "3.6", "4.1"] },
    { "id": 6, "tasks": ["4.2", "4.3", "5.1", "5.2", "6.1", "6.2"] },
    { "id": 7, "tasks": ["5.3", "5.4", "6.3", "6.4", "6.5", "6.6", "8.1", "14.1"] },
    { "id": 8, "tasks": ["8.2", "9.1", "10.1", "11.1", "14.2", "14.3", "14.4", "14.5"] },
    { "id": 9, "tasks": ["9.2", "9.3", "9.4", "10.2", "10.3", "11.2", "12.1"] },
    { "id": 10, "tasks": ["11.3", "11.4", "12.2", "13.1"] },
    { "id": 11, "tasks": ["12.3", "12.4", "13.2"] },
    { "id": 12, "tasks": ["13.3", "16.1", "17.1", "18.1", "19.1"] },
    { "id": 13, "tasks": ["16.2", "17.2", "17.3", "18.2", "19.2"] },
    { "id": 14, "tasks": ["18.3", "18.5", "18.6", "19.3", "19.4", "19.5", "19.6"] },
    { "id": 15, "tasks": ["18.4", "18.7", "21.1"] },
    { "id": 16, "tasks": ["21.2", "21.3", "21.5", "21.6", "21.7"] },
    { "id": 17, "tasks": ["21.4", "21.8", "22.1", "23.1"] },
    { "id": 18, "tasks": ["22.2", "22.4", "23.2", "23.4", "23.5"] },
    { "id": 19, "tasks": ["22.3", "23.3", "24.1"] },
    { "id": 20, "tasks": ["24.2", "24.4"] },
    { "id": 21, "tasks": ["24.3", "24.5", "24.6", "24.7", "25.1"] },
    { "id": 22, "tasks": ["25.2", "25.4", "25.6"] },
    { "id": 23, "tasks": ["25.3", "25.5", "25.7", "26.1"] },
    { "id": 24, "tasks": ["26.2", "26.3", "26.4", "28.1"] },
    { "id": 25, "tasks": ["28.2", "28.4", "28.5", "29.1"] },
    { "id": 26, "tasks": ["28.3", "29.2", "30.1"] },
    { "id": 27, "tasks": ["30.2", "30.3"] },
    { "id": 28, "tasks": ["30.4", "30.5"] }
  ]
}
```
