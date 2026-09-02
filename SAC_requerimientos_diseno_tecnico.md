# SAC — Sistema de Administración Comunitaria

**Documento de Requerimientos y Diseño Técnico**  
**Versión:** 1.0  
**Fecha:** 30 de agosto de 2026  
**Arquitectura propuesta:** Next.js + TypeScript + Supabase/PostgreSQL + PWA

---

## 1. Resumen ejecutivo

SAC es una plataforma multi-comité para administrar las operaciones financieras y organizativas de comités de ayuda comunitaria. El sistema centraliza ingresos, egresos, aportaciones voluntarias, donaciones, actividades, cortes de caja, miembros, usuarios, comprobantes y un sistema anual de bonos con beneficiarios, vendedores, cobros, entregas, sorteos y premios.

El sistema se diseñará desde el inicio como **multi-tenant (multi-comité)**, de modo que una misma plataforma pueda atender múltiples comités manteniendo aislamiento estricto de datos. La fuente de verdad financiera será un **ledger de movimientos**, no un saldo editable.

La primera versión será una **PWA responsiva** usable desde Android, iPhone, tablet y computadora. La inteligencia artificial se incorporará de forma desacoplada en fases posteriores para lectura de comprobantes, clasificación, consultas y alertas, siempre con confirmación humana para operaciones financieras.

---

## 2. Objetivos

1. Mantener trazabilidad completa del dinero del comité.
2. Facilitar cortes mensuales de caja y cortes por actividad.
3. Registrar ingresos, egresos, donaciones y aportaciones voluntarias.
4. Administrar miembros activos y usuarios de acceso por separado.
5. Controlar el sistema anual de bonos, beneficiarios, vendedores y rendición de dinero.
6. Mantener auditoría de cambios y operaciones.
7. Permitir reportes y transparencia sin exponer información sensible.
8. Escalar a múltiples comités sin crear instalaciones independientes.
9. Preparar la arquitectura para integraciones futuras con IA.

---

## 3. Alcance del MVP

El MVP incluirá:

- Creación y configuración de comités.
- Login, recuperación de contraseña y sesiones.
- Usuarios, roles y permisos.
- Registro de miembros.
- Cajas y cuentas financieras.
- Ingresos, egresos y transferencias internas.
- Comprobantes.
- Aportaciones voluntarias.
- Donaciones monetarias y en especie.
- Actividades y cortes por actividad.
- Cortes mensuales de caja.
- Campañas anuales de bonos.
- Números, beneficiarios y vendedores de bonos.
- Cobros mensuales y entregas de vendedores.
- Sorteos, ganadores y pago de premios.
- Integración automática de bonos con ingresos/egresos.
- Reportes básicos.
- Auditoría.

Fuera del MVP inicial:

- OCR/IA de comprobantes.
- Asistente financiero conversacional.
- Detección de anomalías mediante IA.
- Aplicaciones móviles nativas.
- Cobros electrónicos integrados.
- Portal público avanzado de transparencia.

---

## 4. Arquitectura funcional

```text
                         SAC
                          │
          ┌───────────────┼───────────────┐
          │               │               │
      Comité A        Comité B        Comité C
          │               │               │
   ┌──────┼──────┐        │               │
   │      │      │        │               │
Finanzas Miembros Bonos  ...             ...
   │             │
Actividades    Vendedores
   │             │
 Cortes       Cobros/Entregas
   │             │
Reportes       Sorteos
```

Cada registro operativo tendrá un `committee_id` que identifica al tenant propietario.

---

# 5. Requerimientos funcionales

## 5.1 Comités

### RF-001 — Crear y administrar comités

Cada comité podrá registrar:

- Nombre.
- Logo.
- Localidad/dirección administrativa.
- Teléfono.
- Correo.
- Responsables.
- Configuración financiera.
- Configuración de bonos.
- Estado del comité.

### RF-002 — Aislamiento de información

Un usuario solo podrá acceder a los comités a los que esté asignado. El aislamiento se aplicará en PostgreSQL mediante Row Level Security (RLS), además de validaciones del servidor.

### RF-003 — Configuración por comité

Cada comité podrá configurar categorías, cuentas, reglas de bonos, roles y parámetros operativos sin afectar a otros comités.

---

## 5.2 Usuarios, roles y permisos

### RF-010 — Autenticación

- Inicio de sesión con correo y contraseña.
- Recuperación de contraseña.
- Cierre de sesión.
- Control de sesiones.
- MFA para roles sensibles en una fase de endurecimiento de seguridad.

### RF-011 — Roles iniciales

| Rol | Alcance principal |
|---|---|
| Superadministrador | Administración global de plataforma |
| Administrador del comité | Configuración del comité |
| Presidente | Supervisión y aprobaciones |
| Tesorero | Operaciones financieras |
| Secretario | Miembros y actividades |
| Capturista | Captura limitada |
| Vendedor de bonos | Bonos asignados y cobros |
| Auditor | Solo lectura y auditoría |
| Miembro | Información limitada propia |

### RF-012 — RBAC granular

Permisos sugeridos:

```text
members.read
members.create
members.update
transactions.read
transactions.create
transactions.approve
transactions.void
cash_closings.create
cash_closings.review
cash_closings.close
bonuses.read
bonuses.collect
bonuses.settle
bonuses.draw
reports.read
users.manage
committee.manage
audit.read
```

Los roles son agrupaciones de permisos; no se codificarán como reglas rígidas.

---

## 5.3 Miembros

### RF-020 — Registro de miembros

Campos mínimos:

- ID.
- Nombre.
- Teléfono.
- Fecha de incorporación.
- Cargo o función.
- Estado.
- Notas.

Estados iniciales: `activo`, `inactivo`, `baja`.

### RF-021 — Separación miembro/usuario

Un miembro no necesita una cuenta de acceso. Un usuario puede estar vinculado opcionalmente con un miembro.

---

## 5.4 Cajas y cuentas financieras

### RF-030 — Cuentas

Tipos iniciales:

- Caja general.
- Cuenta bancaria.
- Caja de actividad.
- Cuenta digital.
- Otra.

### RF-031 — Saldo

El saldo será derivado del ledger:

```text
Saldo inicial
+ ingresos
- egresos
± transferencias
= saldo calculado
```

No existirá un campo de saldo que pueda editarse arbitrariamente.

### RF-032 — Transferencias internas

Una transferencia entre dos cuentas del mismo comité no genera un nuevo ingreso ni egreso económico. Genera dos apuntes relacionados en el ledger: salida de una cuenta y entrada en otra.

---

## 5.5 Ingresos

### RF-040 — Registrar ingreso

Campos:

- Fecha efectiva.
- Monto.
- Categoría/subcategoría.
- Concepto.
- Persona u origen.
- Método de pago.
- Cuenta receptora.
- Actividad relacionada, opcional.
- Comprobantes.
- Observaciones.
- Usuario creador.
- Fecha/hora de captura.
- Estado.

Categorías iniciales: aportaciones, donaciones, bonos, actividades, ventas, cooperación extraordinaria, otros.

### RF-041 — Categorías configurables

Cada comité administrará sus categorías sin modificar el catálogo de otros comités.

---

## 5.6 Egresos

### RF-050 — Registrar egreso

Campos:

- Fecha efectiva.
- Monto.
- Beneficiario/proveedor.
- Concepto.
- Categoría.
- Método de pago.
- Cuenta de origen.
- Actividad relacionada.
- Comprobantes.
- Responsable.
- Autorización.
- Observaciones.

### RF-051 — Estados

`borrador → registrado → aprobado`

Un movimiento aprobado podrá anularse mediante una operación compensatoria/controlada; no deberá borrarse silenciosamente.

---

## 5.7 Comprobantes

### RF-060

Un movimiento podrá tener uno o varios archivos:

- Imagen.
- Ticket.
- Factura.
- Recibo.
- PDF.
- Otro documento.

Los archivos se almacenarán en buckets privados y se entregarán mediante URLs firmadas de duración limitada.

---

## 5.8 Aportaciones voluntarias

### RF-070

Registrar:

- Miembro.
- Fecha.
- Periodo.
- Monto.
- Método.
- Cuenta receptora.
- Comprobante.

Estados: `registrada`, `sin_aportacion`, `exento`, `no_aplica`.

La falta de aportación no se tratará automáticamente como deuda.

---

## 5.9 Donaciones

### RF-080

Tipos: dinero, material, bien, servicio, otro.

Origen: persona, empresa, institución, anónimo.

Para donaciones en especie:

- Descripción.
- Cantidad.
- Valor estimado opcional.
- Destino.

El valor estimado se identificará expresamente y no incrementará automáticamente el saldo de efectivo.

---

## 5.10 Actividades

### RF-090 — Crear actividad

Campos:

- Nombre.
- Objetivo.
- Fecha inicio/fin.
- Responsable.
- Descripción.
- Estado.

Estados: `planeada`, `activa`, `finalizada`, `cerrada`.

### RF-091 — Movimientos asociados

Ingresos y egresos podrán asociarse a una actividad.

```text
Resultado de actividad = ingresos asociados - egresos asociados
```

### RF-092 — Corte de actividad

Al cerrar una actividad se generará un resumen con ingresos, egresos, resultado, comprobantes y responsable.

---

## 5.11 Cortes mensuales

### RF-100 — Cálculo

```text
Saldo inicial
+ ingresos del periodo
- egresos del periodo
= saldo teórico

Diferencia = saldo real capturado - saldo teórico
```

### RF-101 — Flujo

`abierto → en_revision → aprobado → cerrado`

Una vez cerrado, los cambios retroactivos requerirán un ajuste autorizado y registro de auditoría.

---

# 6. Sistema anual de bonos

## 6.1 Campaña

### RF-110 — Configurar campaña

Parámetros:

- Año/nombre.
- Cantidad de números.
- Número inicial/final.
- Aportación mensual.
- Premio mensual.
- Meses activos.
- Reglas de elegibilidad.
- Estado.

Configuración actual de referencia:

```text
100 números
$30 por número/mes
$1,500 de premio mensual
12 meses
```

Cálculo teórico:

```text
100 × $30 = $3,000 mensuales esperados
$3,000 - $1,500 = $1,500 resultado bruto mensual teórico
100 × $30 × 12 = $36,000 recaudación anual teórica
$1,500 × 12 = $18,000 premios anuales
$36,000 - $18,000 = $18,000 resultado bruto anual teórico
```

El resultado supone 100 % de cobranza y ningún otro gasto.

---

## 6.2 Números y beneficiarios

### RF-111 — Generación de números

Al crear la campaña, el sistema podrá generar automáticamente los números configurados.

### RF-112 — Beneficiario/titular

Cada número tendrá un beneficiario vigente y un historial de asignaciones con fechas de inicio y fin. Cambiar el titular no eliminará la asignación anterior.

---

## 6.3 Vendedores

### RF-120 — Asignación

Uno o más números se asignarán a un vendedor responsable de cobranza.

### RF-121 — Estado por vendedor

El sistema mostrará:

- Números asignados.
- Importe esperado.
- Importe cobrado.
- Importe entregado a tesorería.
- Pendiente por cobrar.
- Pendiente por entregar.

---

## 6.4 Flujo del dinero

```text
Beneficiario
     │ paga
     ▼
Vendedor
     │ entrega
     ▼
Tesorería
     │ confirma
     ▼
Caja / ledger del comité
```

Se distinguirán tres eventos:

1. Aportación esperada.
2. Cobro realizado por vendedor.
3. Dinero recibido/confirmado por tesorería.

Un cobro en manos del vendedor no se considera todavía saldo disponible del comité.

---

## 6.5 Mensualidades

### RF-130

Cada número activo generará una mensualidad por periodo.

Estados:

`pendiente → cobrado_vendedor → entregado_tesoreria → confirmado`

Cada transición registrará fecha, usuario y referencia.

---

## 6.6 Entregas de vendedores

### RF-131

Una entrega agrupará cobros realizados por un vendedor.

Ejemplo:

```text
Vendedor: Juan Pérez
5 bonos × $30 = $150
Entrega: BN-2027-08-001
```

El vendedor reporta la entrega y tesorería la confirma. El vendedor no puede confirmar su propia recepción.

Al confirmarse se genera automáticamente un ingreso del ledger con categoría `Bonos` y referencia a la entrega.

---

## 6.7 Sorteos y premios

### RF-140 — Sorteo

Registrar:

- Campaña.
- Periodo.
- Fecha.
- Número ganador.
- Beneficiario vigente.
- Premio.
- Responsable.
- Evidencia.

### RF-141 — Pago del premio

Al confirmarse el pago se genera automáticamente un egreso con categoría `Premio de bono` y referencia al sorteo.

### RF-142 — Reglas configurables

Deben definirse por comité/campaña:

- Si un número pendiente participa.
- Fecha límite de pago para elegibilidad.
- Si un número puede ganar más de una vez.
- Qué sucede si el premio no se reclama.
- Reglas de cambio de beneficiario.
- Reglas de cambio de vendedor.

Estas reglas no se asumirán en código hasta ser definidas formalmente.

---

## 6.8 Corte mensual de bonos

El reporte mostrará por separado:

- Total esperado.
- Total cobrado por vendedores.
- Total pendiente de cobro.
- Total entregado a tesorería.
- Total todavía en poder de vendedores.
- Premio del periodo.
- Premio pagado/pendiente.
- Resultado de caja del periodo.

Ejemplo:

```text
Esperado                         $3,000
Cobrado                          $2,850
Pendiente de cobro                 $150
Entregado a tesorería            $2,700
En poder de vendedores             $150
Premio                           $1,500
Resultado de caja recibido       $1,200
```

---

# 7. Auditoría

### RF-150 — Registro de auditoría

Se almacenará:

- Comité.
- Usuario.
- Fecha/hora.
- Acción.
- Entidad y registro afectados.
- Valor anterior.
- Valor nuevo.
- Motivo cuando corresponda.
- Información técnica de sesión cuando sea pertinente.

Los registros de auditoría no podrán modificarse desde las operaciones normales de la aplicación.

---

# 8. Reportes

El MVP incluirá:

1. Estado general del comité.
2. Corte mensual.
3. Estado por caja/cuenta.
4. Ingresos por periodo/categoría.
5. Egresos por periodo/categoría.
6. Aportaciones de miembros.
7. Donaciones.
8. Actividades y cortes.
9. Estado mensual de bonos.
10. Bonos pendientes.
11. Estado por vendedor.
12. Entregas de vendedores.
13. Sorteos y ganadores.
14. Premios pagados/pendientes.
15. Histórico anual de bonos.
16. Comprobantes faltantes.
17. Auditoría.

Exportaciones previstas: PDF, XLSX y CSV.

---

# 9. Dashboard

Indicadores iniciales:

- Saldo consolidado.
- Saldo por cuenta.
- Ingresos del mes.
- Egresos del mes.
- Resultado del mes.
- Miembros activos.
- Aportaciones del periodo.
- Actividades abiertas.
- Bonos activos.
- Bonos pagados/pendientes.
- Cobrado por vendedores.
- Entregado a tesorería.
- Dinero pendiente de entregar.
- Comprobantes faltantes.
- Corte mensual pendiente.

---

# 10. Portal de vendedor

Diseñado prioritariamente para móvil:

```text
BONOS — AGOSTO

✓ #01  $30
✓ #02  $30
○ #03  Pendiente
✓ #04  $30

Cobrado:       $90
Por cobrar:    $30
Por entregar:  $90

[Registrar cobro]
[Reportar entrega]
```

El vendedor solo tendrá acceso a sus asignaciones y operaciones permitidas.

---

# 11. Requerimientos no funcionales

## RNF-001 — Seguridad

- HTTPS obligatorio en producción.
- RLS en tablas multi-tenant expuestas.
- RBAC y mínimo privilegio.
- Service keys exclusivamente en servidor.
- Buckets privados para comprobantes.
- Sesiones seguras.
- MFA para perfiles sensibles cuando se habilite.
- Rate limiting en operaciones críticas.
- Separación entre desarrollo, staging y producción.

## RNF-002 — Integridad financiera

- Montos almacenados en unidades monetarias exactas (`numeric`/decimal), nunca `float`.
- Operaciones críticas ejecutadas dentro de transacciones de base de datos.
- Movimientos aprobados no se eliminan físicamente.
- Correcciones mediante reversas/ajustes.
- Idempotencia en procesos automáticos para evitar ingresos duplicados.

## RNF-003 — Auditoría

Toda operación sensible deberá ser atribuible a usuario y fecha.

## RNF-004 — Usabilidad

- Diseño mobile-first.
- Objetivo: captura normal de ingreso/egreso en menos de 30 segundos.
- Formularios con validación inmediata.
- Acciones críticas con confirmación explícita.

## RNF-005 — Disponibilidad

La aplicación deberá funcionar como PWA y adaptarse a computadora, tablet, Android y iPhone.

## RNF-006 — Escalabilidad

La incorporación de un nuevo comité no requerirá una nueva aplicación ni una nueva base de datos.

## RNF-007 — Respaldos

- Respaldos programados de PostgreSQL.
- Estrategia independiente de respaldo de archivos/comprobantes.
- Procedimiento documentado de restauración.

## RNF-008 — Rendimiento

Las consultas principales del dashboard deberán usar índices y agregaciones eficientes. Se evitarán cálculos de históricos completos en el cliente.

---

# 12. Diseño técnico propuesto

## 12.1 Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js + TypeScript |
| UI | Tailwind CSS + componentes accesibles |
| Aplicación | PWA responsiva |
| Backend/BaaS | Supabase |
| Base de datos | PostgreSQL |
| Autenticación | Supabase Auth |
| Autorización | RLS + RBAC |
| Archivos | Supabase Storage |
| Lógica crítica | PostgreSQL Functions/RPC + servidor Next.js/Edge Functions según caso |
| IA futura | Servicio desacoplado mediante API |
| Hosting frontend | Plataforma compatible con Next.js |

---

## 12.2 Diagrama de arquitectura

```text
┌───────────────────────────────────────────────┐
│                Clientes                      │
│ Android / iPhone / Tablet / Desktop          │
└──────────────────────┬────────────────────────┘
                       │ HTTPS
                       ▼
┌───────────────────────────────────────────────┐
│             Next.js PWA / TypeScript          │
│                                               │
│ UI • Validación • Server Actions/API          │
│ Dashboard • Reportes • Formularios            │
└──────────────┬───────────────────┬─────────────┘
               │                   │
               ▼                   ▼
┌────────────────────────┐   ┌──────────────────┐
│       Supabase         │   │ Servicio IA      │
│                        │   │ (fase posterior) │
│ Auth                   │   │ OCR              │
│ PostgreSQL             │   │ Clasificación    │
│ RLS                    │   │ Consultas        │
│ Storage                │   │ Anomalías        │
│ Functions/RPC          │   └──────────────────┘
└────────────┬───────────┘
             │
             ▼
┌────────────────────────┐
│ PostgreSQL Ledger      │
│ Fuente de verdad       │
│ financiera             │
└────────────────────────┘
```

---

# 13. Principios de arquitectura

## 13.1 Multi-tenancy

Todas las entidades propiedad de un comité contendrán `committee_id UUID NOT NULL` y políticas RLS basadas en la membresía del usuario al comité.

## 13.2 Ledger financiero

No se mantendrá un saldo editable como fuente de verdad. Cada operación financiera generará apuntes inmutables o reversables.

Conceptualmente:

```text
financial_transactions
        │
        └── ledger_entries
                ├── cuenta A -$100
                └── cuenta B +$100
```

Para un ingreso ordinario puede existir una entrada positiva a la cuenta; para egreso, negativa; para transferencia, dos entradas compensadas.

## 13.3 Separación de dominio y contabilidad

Una operación de negocio —por ejemplo, una entrega de bonos— tendrá su registro de dominio (`bonus_settlement`) y, una vez confirmada, generará exactamente una transacción financiera vinculada.

Esto permite rastrear:

```text
Entrega de vendedor
        ↓
Transacción financiera
        ↓
Ledger
```

## 13.4 Idempotencia

Los procesos automáticos usarán claves únicas/referencias para impedir que confirmar dos veces una entrega cree dos ingresos.

---

# 14. Modelo de datos preliminar

## 14.1 Identidad y autorización

```text
committees
profiles
committee_users
roles
permissions
role_permissions
user_roles
```

### committees

```text
id UUID PK
name TEXT
slug TEXT UNIQUE
logo_path TEXT NULL
status TEXT
settings JSONB
created_at TIMESTAMPTZ
```

### committee_users

```text
id UUID PK
committee_id UUID FK
user_id UUID FK -> auth.users
member_id UUID NULL
status TEXT
created_at TIMESTAMPTZ
UNIQUE (committee_id, user_id)
```

---

## 14.2 Miembros

```text
members
- id UUID PK
- committee_id UUID FK
- full_name TEXT
- phone TEXT NULL
- joined_at DATE NULL
- position TEXT NULL
- status TEXT
- notes TEXT NULL
- created_at TIMESTAMPTZ
- created_by UUID
```

---

## 14.3 Finanzas

```text
financial_accounts
transaction_categories
financial_transactions
ledger_entries
transaction_attachments
transfers
cash_closings
cash_closing_details
```

### financial_transactions

```text
id UUID PK
committee_id UUID FK
type TEXT              -- income, expense, transfer, adjustment
status TEXT            -- draft, posted, reversed
transaction_date DATE
description TEXT
category_id UUID NULL
activity_id UUID NULL
source_type TEXT NULL
source_id UUID NULL
created_by UUID
approved_by UUID NULL
created_at TIMESTAMPTZ
posted_at TIMESTAMPTZ NULL
reversal_of UUID NULL
```

### ledger_entries

```text
id UUID PK
committee_id UUID FK
transaction_id UUID FK
account_id UUID FK
amount NUMERIC(14,2)    -- positivo/negativo según convención
created_at TIMESTAMPTZ
```

Restricción lógica: la suma de los apuntes de una transferencia debe ser cero.

---

## 14.4 Aportaciones y donaciones

```text
contributions
donations
```

Las aportaciones monetarias confirmadas se vincularán con `financial_transactions`. Las donaciones en especie podrán no generar movimiento de caja.

---

## 14.5 Actividades

```text
activities
activity_members
```

Los movimientos se relacionarán mediante `financial_transactions.activity_id`.

---

## 14.6 Bonos

```text
bonus_campaigns
bonus_numbers
bonus_holder_assignments
bonus_sellers
bonus_seller_assignments
bonus_monthly_dues
bonus_collections
bonus_settlements
bonus_settlement_items
bonus_draws
bonus_prize_payments
```

### bonus_campaigns

```text
id UUID PK
committee_id UUID FK
name TEXT
year INT
number_start INT
number_end INT
monthly_amount NUMERIC(14,2)
monthly_prize NUMERIC(14,2)
start_date DATE
end_date DATE
rules JSONB
status TEXT
```

### bonus_numbers

```text
id UUID PK
committee_id UUID FK
campaign_id UUID FK
number INT
status TEXT
UNIQUE (campaign_id, number)
```

### bonus_holder_assignments

```text
id UUID PK
committee_id UUID FK
bonus_number_id UUID FK
beneficiary_name TEXT
member_id UUID NULL
valid_from DATE
valid_to DATE NULL
created_by UUID
```

### bonus_seller_assignments

```text
id UUID PK
committee_id UUID FK
bonus_number_id UUID FK
seller_id UUID FK
valid_from DATE
valid_to DATE NULL
```

### bonus_monthly_dues

```text
id UUID PK
committee_id UUID FK
campaign_id UUID FK
bonus_number_id UUID FK
period DATE
amount NUMERIC(14,2)
status TEXT
UNIQUE (bonus_number_id, period)
```

### bonus_collections

```text
id UUID PK
committee_id UUID FK
monthly_due_id UUID FK
seller_id UUID FK
amount NUMERIC(14,2)
collected_at TIMESTAMPTZ
created_by UUID
```

### bonus_settlements

```text
id UUID PK
committee_id UUID FK
campaign_id UUID FK
seller_id UUID FK
reference TEXT
reported_amount NUMERIC(14,2)
confirmed_amount NUMERIC(14,2) NULL
status TEXT
reported_at TIMESTAMPTZ
confirmed_at TIMESTAMPTZ NULL
confirmed_by UUID NULL
financial_transaction_id UUID NULL UNIQUE
```

La unicidad de `financial_transaction_id` y el estado del settlement ayudarán a impedir doble contabilización.

### bonus_draws

```text
id UUID PK
committee_id UUID FK
campaign_id UUID FK
period DATE
draw_date DATE
winning_bonus_number_id UUID FK
beneficiary_snapshot TEXT
prize_amount NUMERIC(14,2)
evidence_path TEXT NULL
status TEXT
UNIQUE (campaign_id, period)
```

### bonus_prize_payments

```text
id UUID PK
committee_id UUID FK
draw_id UUID FK
amount NUMERIC(14,2)
paid_at TIMESTAMPTZ
financial_transaction_id UUID UNIQUE
created_by UUID
```

---

## 14.7 Auditoría y notificaciones

```text
audit_logs
notifications
```

### audit_logs

```text
id UUID PK
committee_id UUID NULL
user_id UUID
entity_type TEXT
entity_id UUID NULL
action TEXT
old_values JSONB NULL
new_values JSONB NULL
reason TEXT NULL
created_at TIMESTAMPTZ
```

---

# 15. Relaciones principales

```text
Committee
 ├── CommitteeUsers ── Users/Roles
 ├── Members
 ├── FinancialAccounts
 │     └── LedgerEntries ── FinancialTransactions
 ├── Activities ── FinancialTransactions
 ├── Contributions ── FinancialTransactions
 ├── Donations ── FinancialTransactions (cuando aplique)
 ├── CashClosings
 └── BonusCampaigns
       ├── BonusNumbers
       │    ├── HolderAssignments
       │    ├── SellerAssignments
       │    └── MonthlyDues
       │          └── Collections
       ├── Settlements ── FinancialTransactions
       └── Draws
            └── PrizePayments ── FinancialTransactions
```

---

# 16. Seguridad RLS — diseño conceptual

Una función segura obtendrá los comités del usuario autenticado.

Política conceptual:

```sql
SELECT permitido
SI existe committee_users
WHERE committee_users.user_id = auth.uid()
  AND committee_users.committee_id = row.committee_id
  AND committee_users.status = 'active'
```

Para escritura se agregará comprobación de permisos RBAC. Las operaciones especialmente sensibles —cerrar cortes, confirmar entregas, pagar premios— podrán ejecutarse mediante funciones RPC/servidor que validen permisos y estado dentro de una transacción.

Nunca se expondrá una `service_role` key al navegador.

---

# 17. Flujos técnicos críticos

## 17.1 Registrar ingreso

```text
Usuario
  ↓
Formulario
  ↓
Validación cliente/servidor
  ↓
Verificar comité + permiso
  ↓
Crear financial_transaction
  ↓
Crear ledger_entry
  ↓
Adjuntar comprobantes
  ↓
Audit log
  ↓
Actualizar UI/dashboard
```

## 17.2 Confirmar entrega de bonos

```text
Vendedor reporta settlement
          ↓
Tesorería revisa
          ↓
Confirma monto
          ↓
Transacción DB atómica
          ├── marcar settlement confirmado
          ├── actualizar mensualidades incluidas
          ├── crear financial_transaction ingreso
          ├── crear ledger_entry
          └── audit_log
          ↓
Ingreso visible en caja
```

Si la transacción falla en cualquier punto, se revierte completa.

## 17.3 Pago de premio

```text
Sorteo registrado
      ↓
Tesorería registra pago
      ↓
Validar que no exista pago previo
      ↓
Crear egreso financiero
      ↓
Crear ledger entry
      ↓
Vincular prize_payment
      ↓
Auditoría
```

## 17.4 Cierre mensual

```text
Seleccionar cuenta + periodo
      ↓
Calcular saldo inicial
      ↓
Sumar ledger del periodo
      ↓
Obtener saldo teórico
      ↓
Capturar saldo real
      ↓
Calcular diferencia
      ↓
Revisión/aprobación
      ↓
Cerrar
```

---

# 18. Navegación y pantallas

## 18.1 Estructura principal

```text
/login
/dashboard
/comite
/miembros
/finanzas
    /movimientos
    /ingresos
    /egresos
    /cuentas
    /transferencias
    /cortes
/aportaciones
/donaciones
/actividades
/bonos
    /campanas
    /numeros
    /beneficiarios
    /vendedores
    /cobranza
    /entregas
    /sorteos
    /reportes
/reportes
/auditoria
/configuracion
```

## 18.2 Pantallas MVP

1. Login.
2. Recuperar contraseña.
3. Selección de comité si el usuario pertenece a más de uno.
4. Dashboard.
5. Lista/ficha de miembros.
6. Lista de cuentas.
7. Movimientos financieros.
8. Nuevo ingreso.
9. Nuevo egreso.
10. Transferencia.
11. Corte mensual.
12. Actividades.
13. Corte de actividad.
14. Aportaciones.
15. Donaciones.
16. Campañas de bonos.
17. Matriz de números/beneficiarios/vendedores.
18. Cobranza mensual.
19. Portal de vendedor.
20. Entregas.
21. Confirmación de tesorería.
22. Sorteo mensual.
23. Pago de premio.
24. Reportes.
25. Auditoría.
26. Usuarios/roles/permisos.
27. Configuración del comité.

---

# 19. Diseño UX del módulo de bonos

La vista administrativa principal deberá permitir visualizar los 100 números como tabla/matriz:

| Nº | Beneficiario | Vendedor | Mes | Cobro | Entrega |
|---:|---|---|---|---|---|
| 01 | Persona A | Vendedor 1 | Ago | Pagado | Confirmado |
| 02 | Persona B | Vendedor 1 | Ago | Pendiente | — |
| 03 | Persona C | Vendedor 2 | Ago | Cobrado | Por entregar |

Filtros:

- Periodo.
- Vendedor.
- Estado de cobro.
- Estado de entrega.
- Número.
- Beneficiario.

Acciones masivas controladas podrán incorporarse posteriormente, pero el MVP priorizará trazabilidad individual.

---

# 20. API / servicios de aplicación

Aunque Supabase expone APIs sobre PostgreSQL, la aplicación no deberá permitir que toda la lógica de negocio crítica dependa del cliente.

Servicios previstos:

```text
CommitteeService
MemberService
FinanceService
CashClosingService
ActivityService
ContributionService
DonationService
BonusCampaignService
BonusCollectionService
BonusSettlementService
BonusDrawService
ReportService
AuditService
```

Operaciones críticas deberán centralizarse en Server Actions/API routes o funciones PostgreSQL/Edge Functions con transacciones y autorización.

---

# 21. Validaciones principales

- Monto > 0 para ingresos/egresos normales.
- No usar `float` para dinero.
- No confirmar dos veces una entrega.
- No pagar dos veces un mismo premio.
- No crear dos mensualidades para el mismo número/periodo.
- No crear dos sorteos para la misma campaña/periodo salvo procedimiento explícito de anulación.
- No cerrar dos veces un corte.
- No permitir que un vendedor confirme su propia entrega.
- No permitir movimientos contra cuentas inactivas.
- No permitir acceso cruzado entre comités.
- No permitir edición silenciosa de movimientos contabilizados.

---

# 22. IA — arquitectura futura

La IA será una capa auxiliar, no la fuente de verdad.

```text
Usuario
  ↓
SAC
  ↓
Servicio de IA
  ↓
Resultado sugerido
  ↓
Validación humana
  ↓
Operación normal SAC
```

## Fase IA-1 — OCR/comprobantes

Extraer y sugerir:

- Fecha.
- Proveedor.
- Total.
- Impuestos cuando sea posible.
- Categoría probable.

Nunca contabilizar automáticamente sin confirmación.

## Fase IA-2 — Clasificación

Sugerir categoría, actividad y concepto a partir de texto.

## Fase IA-3 — Consultas conversacionales

Ejemplos:

- “¿Cuánto gastamos en mantenimiento este año?”
- “¿Qué vendedores tienen dinero pendiente de entregar?”
- “¿Cuánto recaudaron los bonos en agosto?”

La capa de consulta deberá respetar los permisos y `committee_id` del usuario.

## Fase IA-4 — Anomalías

Alertas informativas sobre montos atípicos, duplicados potenciales o comprobantes faltantes. Una alerta no constituye prueba de irregularidad.

---

# 23. Estrategia de desarrollo

## Fase 0 — Fundamentos

- Repositorio y CI.
- Next.js/TypeScript.
- Proyecto Supabase de desarrollo.
- Migraciones SQL.
- Auth.
- Modelo multi-tenant.
- RLS.
- Layout PWA.

## Fase 1 — Administración base

- Comités.
- Usuarios/roles/permisos.
- Miembros.
- Cuentas financieras.
- Categorías.

## Fase 2 — Finanzas

- Ledger.
- Ingresos.
- Egresos.
- Transferencias.
- Comprobantes.
- Auditoría financiera.

## Fase 3 — Operación comunitaria

- Aportaciones.
- Donaciones.
- Actividades.
- Cortes de actividad.
- Cortes mensuales.

## Fase 4 — Bonos

- Campañas.
- Números.
- Beneficiarios.
- Vendedores.
- Mensualidades.
- Cobros.
- Entregas.
- Confirmación e integración con ledger.
- Sorteos.
- Premios.
- Reportes.

## Fase 5 — Reportes y estabilización

- Dashboard final.
- Exportaciones.
- Pruebas de RLS.
- Pruebas financieras.
- Pruebas de concurrencia/idempotencia.
- Backups y recuperación.
- PWA instalable.

## Fase 6 — Evolución

- Transparencia pública/QR.
- Notificaciones.
- IA/OCR.
- Consultas conversacionales.
- Alertas inteligentes.
- Cobros electrónicos si se decide.

---

# 24. Estrategia de pruebas

## Unitarias

- Cálculo de cortes.
- Cálculo de bonos.
- Estados de mensualidades.
- Elegibilidad según reglas configuradas.

## Integración

- Confirmar entrega → genera exactamente un ingreso.
- Pagar premio → genera exactamente un egreso.
- Transferencia → no altera saldo consolidado.
- Reversa → compensa movimiento original.

## Seguridad

- Usuario A no puede leer Comité B.
- Vendedor solo ve números asignados.
- Auditor no modifica.
- Capturista no cierra corte si carece de permiso.
- Service role no aparece en cliente.

## Aceptación

Pruebas con casos reales del comité antes de producción.

---

# 25. Observabilidad y operación

Registrar:

- Errores de aplicación.
- Fallos de funciones críticas.
- Operaciones financieras rechazadas.
- Tiempos de respuesta.
- Intentos de acceso no autorizado cuando sea viable.

No registrar contraseñas, tokens ni datos sensibles innecesarios en logs.

---

# 26. Estrategia de respaldo

1. Backups periódicos de PostgreSQL.
2. Copia separada de comprobantes almacenados.
3. Política de retención.
4. Prueba periódica de restauración.
5. Exportación administrativa de información crítica.

La existencia de un backup sin una prueba de restauración no se considerará suficiente.

---

# 27. Decisiones pendientes de negocio

Antes de cerrar el diseño de bonos deben definirse formalmente:

1. ¿Un número que no pagó el mes participa en el sorteo?
2. ¿Cuál es la fecha límite de pago?
3. ¿Un mismo número puede ganar varias veces durante el año?
4. ¿Qué ocurre con un premio no reclamado?
5. ¿Cómo se autoriza un cambio de beneficiario?
6. ¿Cómo se autoriza un cambio de vendedor?
7. ¿Se permiten pagos adelantados de varios meses?
8. ¿Se permiten pagos parciales de los $30?
9. ¿Qué procedimiento se sigue ante diferencias entre lo reportado por vendedor y lo recibido por tesorería?
10. ¿Quién puede anular o corregir un cobro?

Estas decisiones deben convertirse en reglas configurables o políticas documentadas antes de implementar los flujos definitivos.

---

# 28. Criterios de éxito del MVP

El MVP se considerará funcional cuando sea posible realizar de extremo a extremo:

```text
Crear comité
→ crear usuarios/miembros
→ configurar cuentas
→ registrar ingresos/egresos
→ crear actividad
→ cerrar actividad
→ crear campaña de bonos
→ asignar 100 números
→ asignar beneficiarios/vendedores
→ generar mensualidades
→ registrar cobros
→ reportar entrega
→ confirmar tesorería
→ generar ingreso automático
→ registrar sorteo
→ pagar premio
→ generar egreso automático
→ realizar corte mensual
→ consultar reportes/auditoría
```

Todo ello deberá mantener aislamiento multi-comité y trazabilidad financiera.

---

# 29. Fuentes técnicas consultadas

Documentación oficial recomendada para validar y mantener la implementación:

- Next.js Documentation: https://nextjs.org/docs
- Next.js Blog / Security Updates: https://nextjs.org/blog
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Authentication / MFA: https://supabase.com/docs/guides/auth/auth-mfa
- Supabase Database: https://supabase.com/docs/guides/database/overview
- Supabase Pricing: https://supabase.com/pricing
- Supabase Edge Functions Pricing: https://supabase.com/docs/guides/functions/pricing

> Los precios, límites y características comerciales de proveedores externos cambian con el tiempo. Deben verificarse nuevamente en sus páginas oficiales antes de contratar infraestructura.

---

# 30. Propuesta final

La arquitectura recomendada para SAC es:

```text
Next.js + TypeScript
        │
        ├── PWA mobile-first
        │
        ▼
Supabase
        ├── Auth
        ├── PostgreSQL
        ├── RLS
        ├── Storage
        └── Functions/RPC
        │
        ▼
Ledger financiero auditable
        │
        └── IA desacoplada en fases posteriores
```

Esta propuesta prioriza integridad financiera, seguridad multi-comité, trazabilidad, facilidad de uso desde teléfono y capacidad de crecimiento sin exigir aplicaciones separadas para cada comité.
