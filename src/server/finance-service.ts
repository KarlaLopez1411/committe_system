import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Money, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';
import { add, ZERO, isValid, greaterThan, greaterThanOrEqual, lessThanOrEqual, parse } from '@/domain/money';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { assertCommitteeAccess, can } from '@/server/authz';

/**
 * FinanceService — servicio financiero cohesivo del comité (design.md >
 * "FinanceService"). Agrupa cuentas, categorías, ledger, transacciones y
 * comprobantes. Se construye mediante el factory `createFinanceService` para
 * poder inyectar dependencias (cliente Supabase) en pruebas.
 *
 * Este módulo alojará progresivamente el resto de la superficie de
 * FinanceService a medida que avancen las tareas del plan:
 *   - Cuentas financieras (ESTA tarea 6.1): `createAccount`, `deactivateAccount`.
 *   - Categorías de transacción (tarea 6.2).
 *   - Saldo derivado / ledger (tarea 8.1).
 *   - Movimientos: ingresos, egresos, transferencias, aprobación, anulación
 *     (tareas 9–15).
 *
 * Para evitar conflictos entre tareas, cada área vive en una SECCIÓN claramente
 * delimitada por comentarios. La tarea actual implementa ÚNICAMENTE las cuentas
 * financieras (Requirements 9.1, 9.2, 9.3).
 *
 * SEGURIDAD (Requirements 40.2, 40.3): `server-only` impide que este módulo
 * llegue al bundle del navegador. Usa el cliente admin (`service_role`) porque
 * la administración de cuentas es una operación de comité que también debe
 * escribir en `audit_logs`; la autorización se valida contra el `Ctx` antes de
 * tocar datos.
 */

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Cuentas financieras (Requirements 9.1, 9.2, 9.3)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Tipos de cuenta permitidos (alineado con el CHECK de
 * `financial_accounts.type`). Requirements 9.1, 9.2 (RF-030).
 */
export const ACCOUNT_TYPES = [
  'caja_general',
  'cuenta_bancaria',
  'caja_actividad',
  'cuenta_digital',
  'otra',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Longitud mínima y máxima del nombre de una cuenta (Requirements 9.1, 9.2). */
export const ACCOUNT_NAME_MIN = 1;
export const ACCOUNT_NAME_MAX = 80;

/** Código PostgreSQL de violación de restricción UNIQUE. */
const PG_UNIQUE_VIOLATION = '23505';

/** Datos de creación de una cuenta financiera (design.md > FinanceService). */
export interface AccountInput {
  /** Nombre de la cuenta (1–80, único por comité). */
  name: string;
  /** Tipo de la cuenta dentro del conjunto permitido. */
  type: AccountType;
  /** Saldo inicial opcional (por defecto 0). Se persiste como NUMERIC(16,2). */
  openingBalance?: string;
}

/**
 * Valida el nombre de una cuenta: no vacío tras recortar y entre 1 y 80
 * caracteres (Requirements 9.1, 9.2). Devuelve el nombre recortado si es válido.
 */
export function validateAccountName(name: unknown): Result<string> {
  if (typeof name !== 'string') {
    return err('account/invalid-name', 'El nombre de la cuenta es obligatorio.', 'name');
  }
  const trimmed = name.trim();
  if (trimmed.length < ACCOUNT_NAME_MIN) {
    return err('account/invalid-name', 'El nombre de la cuenta es obligatorio.', 'name');
  }
  if (trimmed.length > ACCOUNT_NAME_MAX) {
    return err(
      'account/invalid-name',
      `El nombre de la cuenta no puede exceder ${ACCOUNT_NAME_MAX} caracteres.`,
      'name',
    );
  }
  return ok(trimmed);
}

/**
 * Valida que el tipo de cuenta pertenezca al conjunto permitido
 * (Requirements 9.1, 9.2).
 */
export function validateAccountType(type: unknown): Result<AccountType> {
  if (typeof type !== 'string' || !ACCOUNT_TYPES.includes(type as AccountType)) {
    return err(
      'account/invalid-type',
      'El tipo de cuenta no es válido.',
      'type',
    );
  }
  return ok(type as AccountType);
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Transferencias (Requirements 11.1–11.6, 41.2, 41.3)
// ═════════════════════════════════════════════════════════════════════════════

/** Monto mínimo y máximo de una transferencia (mismo límite que egreso). */
export const TRANSFER_AMOUNT_MIN = '0.01';
export const TRANSFER_AMOUNT_MAX = '999999999.99';

/** Datos de registro de una transferencia interna. */
export interface TransferInput {
  fromAccountId: UUID;
  toAccountId: UUID;
  /** Cadena decimal exacta 0.01–999,999,999.99, ≤2 decimales (R11.6). */
  amount: string;
  /** Fecha efectiva YYYY-MM-DD. */
  date: string;
  description?: string | null;
}

/**
 * Valida el monto de una transferencia: ≥ 0.01, ≤ límite, ≤ 2 decimales.
 */
export function validateTransferAmount(amount: unknown): Result<Money> {
  if (!isValid(amount)) {
    return err('transfer/invalid-amount', 'El monto de la transferencia no es válido.', 'amount');
  }
  const m = parse(amount as Money);
  if (!greaterThanOrEqual(m, TRANSFER_AMOUNT_MIN)) {
    return err('transfer/invalid-amount', 'El monto de la transferencia debe ser al menos 0.01.', 'amount');
  }
  if (!lessThanOrEqual(m, TRANSFER_AMOUNT_MAX)) {
    return err('transfer/invalid-amount', `El monto no puede exceder ${TRANSFER_AMOUNT_MAX}.`, 'amount');
  }
  return ok(m);
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Ingresos (Requirements 12.1–12.6, 41.2, 41.3)
// ═════════════════════════════════════════════════════════════════════════════

/** Monto máximo de ingreso en texto (R12.2). */
export const INCOME_AMOUNT_MAX = '999999999999.99';

/** Datos de registro de un ingreso (design.md > FinanceService). */
export interface IncomeInput {
  accountId: UUID;
  categoryId?: UUID | null;
  activityId?: UUID | null;
  /** Cadena decimal exacta con ≤2 decimales y > 0 (R12.2). */
  amount: string;
  /** Fecha efectiva YYYY-MM-DD. */
  date: string;
  description?: string | null;
  sourceType?: string | null;
  sourceId?: UUID | null;
  origin?: string | null;
  paymentMethod?: string | null;
}

/**
 * Valida el monto de un ingreso: > 0, ≤ límite, ≤ 2 decimales (R12.2).
 * Devuelve el valor parseado como Money canónico si es válido.
 */
export function validateIncomeAmount(amount: unknown): Result<Money> {
  if (!isValid(amount)) {
    return err('income/invalid-amount', 'El monto del ingreso no es válido.', 'amount');
  }
  const m = parse(amount as Money);
  if (!greaterThan(m, '0.00')) {
    return err('income/invalid-amount', 'El monto del ingreso debe ser mayor a 0.', 'amount');
  }
  if (!lessThanOrEqual(m, INCOME_AMOUNT_MAX)) {
    return err('income/invalid-amount', `El monto no puede exceder ${INCOME_AMOUNT_MAX}.`, 'amount');
  }
  return ok(m);
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Egresos (Requirements 14.1–14.5, 41.2, 41.3)
// ═════════════════════════════════════════════════════════════════════════════

/** Monto mínimo de un egreso en texto (R14.2). */
export const EXPENSE_AMOUNT_MIN = '0.01';
/** Monto máximo de un egreso en texto (R14.2). */
export const EXPENSE_AMOUNT_MAX = '999999999.99';

/** Datos de registro de un egreso (design.md > FinanceService). */
export interface ExpenseInput {
  accountId: UUID;
  /** Obligatorio para egresos (R14.3). */
  categoryId: UUID;
  activityId?: UUID | null;
  /** Cadena decimal exacta 0.01–999,999,999.99, ≤2 decimales (R14.2). */
  amount: string;
  /** Fecha efectiva YYYY-MM-DD (R14.3). */
  date: string;
  /** Beneficiario/proveedor (R14.3). */
  beneficiary: string;
  /** Concepto/descripción (R14.3). */
  description: string;
  /** Método de pago (R14.3). */
  paymentMethod: string;
  sourceType?: string | null;
  sourceId?: UUID | null;
}

/**
 * Valida el monto de un egreso: ≥ 0.01, ≤ 999,999,999.99, ≤ 2 decimales (R14.2).
 * Devuelve el valor parseado como Money canónico si es válido.
 */
export function validateExpenseAmount(amount: unknown): Result<Money> {
  if (!isValid(amount)) {
    return err('expense/invalid-amount', 'El monto del egreso no es válido.', 'amount');
  }
  const m = parse(amount as Money);
  if (!greaterThanOrEqual(m, EXPENSE_AMOUNT_MIN)) {
    return err('expense/invalid-amount', 'El monto del egreso debe ser al menos 0.01.', 'amount');
  }
  if (!lessThanOrEqual(m, EXPENSE_AMOUNT_MAX)) {
    return err('expense/invalid-amount', `El monto no puede exceder ${EXPENSE_AMOUNT_MAX}.`, 'amount');
  }
  return ok(m);
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Categorías de transacción (Requirements 13.1, 13.3, 13.4, 13.5)
// ═════════════════════════════════════════════════════════════════════════════

/** Longitud mínima y máxima del nombre de una categoría (Requirements 13.5). */
export const CATEGORY_NAME_MIN = 1;
export const CATEGORY_NAME_MAX = 100;

/**
 * Valida el nombre de una categoría: debe ser texto, no estar compuesto
 * únicamente de espacios en blanco y tener entre 1 y 100 caracteres tras
 * recortar (Requirements 13.5). Devuelve el nombre recortado si es válido.
 */
export function validateCategoryName(name: unknown): Result<string> {
  if (typeof name !== 'string') {
    return err('category/invalid-name', 'El nombre de la categoría es obligatorio.', 'name');
  }
  const trimmed = name.trim();
  // R13.5: no puede estar compuesto únicamente de espacios en blanco.
  if (trimmed.length < CATEGORY_NAME_MIN) {
    return err(
      'category/invalid-name',
      'El nombre de la categoría no puede estar vacío ni contener solo espacios.',
      'name',
    );
  }
  if (trimmed.length > CATEGORY_NAME_MAX) {
    return err(
      'category/invalid-name',
      `El nombre de la categoría no puede exceder ${CATEGORY_NAME_MAX} caracteres.`,
      'name',
    );
  }
  return ok(trimmed);
}

// ═════════════════════════════════════════════════════════════════════════════
// SECCIÓN: Ledger / saldo derivado (Requirements 10.1, 10.2, 10.3)
// ═════════════════════════════════════════════════════════════════════════════
//
// RF-031: el saldo de una cuenta SIEMPRE es un valor DERIVADO del ledger:
//
//   Derived_Balance(cuenta) = opening_balance + SUM(ledger_entries.amount)
//
// (Requirements 10.1). No existe —ni debe existir— una columna de saldo
// editable en `financial_accounts`; la tabla solo expone `opening_balance`
// (saldo inicial) y el saldo vigente se calcula al vuelo sumando los apuntes
// asociados a la cuenta dentro del comité. En consecuencia:
//
//   - No hay forma de ASIGNAR directamente un saldo a una cuenta: el servicio
//     no ofrece ningún método de escritura de saldo y el esquema carece de la
//     columna correspondiente (Requirements 10.2). Toda variación de saldo
//     ocurre exclusivamente al insertar apuntes de ledger.
//   - Cualquier apunte nuevo (ingreso, egreso, transferencia, ajuste) queda
//     reflejado AUTOMÁTICAMENTE en el saldo derivado, porque este se recalcula
//     en cada consulta a partir de la suma vigente de apuntes (Requirements
//     10.3). No hay estado cacheado que sincronizar.
//
// La aritmética se realiza con la utilidad `Money` (centavos exactos, nunca
// punto flotante) para preservar la integridad financiera (Requirements 41.1).

/**
 * Fila mínima de apunte de ledger usada para el cálculo del saldo derivado.
 */
interface LedgerAmountRow {
  amount: string | number;
}

/**
 * Suma exacta de un conjunto de apuntes usando la utilidad `Money`, partiendo
 * de un saldo inicial. No usa aritmética de punto flotante (Requirements 41.1).
 */
export function sumLedger(openingBalance: Money | number, entries: LedgerAmountRow[]): Money {
  let balance: Money = add(openingBalance, ZERO); // normaliza a Money canónico
  for (const entry of entries) {
    balance = add(balance, String(entry.amount));
  }
  return balance;
}

// ═════════════════════════════════════════════════════════════════════════════
// Contrato y factory del servicio
// ═════════════════════════════════════════════════════════════════════════════

/** Dependencias inyectables (permite simular Supabase en pruebas). */
export interface FinanceServiceDeps {
  client?: SupabaseClient;
}

export interface FinanceService {
  // Cuentas — R9
  createAccount(ctx: Ctx, data: AccountInput): Promise<Result<{ accountId: UUID }>>;
  deactivateAccount(ctx: Ctx, accountId: UUID): Promise<Result<void>>;

  // Ledger / saldo derivado — R10
  getDerivedBalance(ctx: Ctx, accountId: UUID): Promise<Result<Money>>;

  // Categorías — R13
  createCategory(ctx: Ctx, name: string): Promise<Result<{ categoryId: UUID }>>;
  renameCategory(ctx: Ctx, id: UUID, name: string): Promise<Result<void>>;
  deleteCategory(ctx: Ctx, id: UUID): Promise<Result<void>>;

  // Ingresos — R12
  registerIncome(ctx: Ctx, data: IncomeInput): Promise<Result<{ transactionId: UUID }>>;

  // Egresos — R14
  registerExpense(ctx: Ctx, data: ExpenseInput): Promise<Result<{ transactionId: UUID }>>;

  // Transferencias — R11
  transfer(ctx: Ctx, data: TransferInput): Promise<Result<{ transactionId: UUID }>>;

  // Aprobación — R15.1, R15.2
  approve(ctx: Ctx, transactionId: UUID): Promise<Result<void>>;

  // Anulación — R15.3, R15.4
  void(ctx: Ctx, transactionId: UUID, reason?: string | null): Promise<Result<{ reversalId: UUID }>>;

  // Cancelar (descartar) una transacción en borrador: la elimina junto con sus
  // apuntes de ledger, de modo que deja de afectar el saldo. Solo para 'draft'.
  cancelDraft(ctx: Ctx, transactionId: UUID): Promise<Result<void>>;

  // Adjuntos — R16.1
  attach(ctx: Ctx, transactionId: UUID, storagePath: string, kind?: string | null): Promise<Result<{ attachmentId: UUID }>>;

  // Signed URL — R16.2, R16.3
  getSignedUrl(ctx: Ctx, attachmentId: UUID): Promise<Result<string>>;
}

/**
 * Crea una instancia de FinanceService sobre Supabase.
 *
 * Por defecto usa el cliente admin (`service_role`), apropiado para la
 * administración de cuentas por el comité y para escribir auditoría. Las
 * pruebas pueden inyectar un cliente simulado.
 */
export function createFinanceService(
  deps: FinanceServiceDeps = {},
): FinanceService {
  const getClient = (): SupabaseClient => deps.client ?? createSupabaseAdminClient();

  return {
    // ─────────────────────────────────────────────────────────────────────────
    // Cuentas financieras (Requirements 9.1, 9.2, 9.3)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Crea una cuenta con estado `active` asociada al comité del usuario
     * (Requirements 9.1). Requiere el permiso `committee.manage` (R9.1). Valida
     * nombre 1–80 (R9.2), tipo dentro del conjunto permitido (R9.1, R9.2) y
     * unicidad del nombre por comité; rechaza duplicados sin crear la cuenta
     * (R9.2). Audita la creación (R36.1).
     */
    async createAccount(ctx, data): Promise<Result<{ accountId: UUID }>> {
      // R9.1: solo con permiso committee.manage (o superadministrador).
      if (!can(ctx, 'committee.manage')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para administrar cuentas del comité.',
        );
      }

      // R9.2: validación de nombre.
      const nameCheck = validateAccountName(data?.name);
      if (!nameCheck.ok) {
        return nameCheck as Result<{ accountId: UUID }>;
      }

      // R9.1, R9.2: validación de tipo.
      const typeCheck = validateAccountType(data?.type);
      if (!typeCheck.ok) {
        return typeCheck as Result<{ accountId: UUID }>;
      }

      const client = getClient();

      const { data: created, error } = await client
        .from('financial_accounts')
        .insert({
          committee_id: ctx.committeeId, // R9.1: asociada al comité del usuario
          name: nameCheck.value,
          type: typeCheck.value,
          opening_balance: data.openingBalance ?? '0',
          status: 'active', // R9.1: estado inicial activa
        })
        .select('id')
        .single();

      if (error || !created) {
        // R9.2: nombre duplicado dentro del mismo comité (UNIQUE committee_id,name).
        if (error?.code === PG_UNIQUE_VIOLATION) {
          return err(
            'account/duplicate-name',
            'Ya existe una cuenta con ese nombre en el comité.',
            'name',
          );
        }
        return err(
          'account/create-failed',
          `No se pudo crear la cuenta: ${error?.message ?? 'error desconocido'}.`,
        );
      }

      const accountId = (created as { id: UUID }).id;

      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'account.create',
        entityId: accountId,
        newValues: {
          name: nameCheck.value,
          type: typeCheck.value,
          status: 'active',
        },
      });

      return ok({ accountId });
    },

    /**
     * Desactiva una cuenta marcándola como `inactive`, conservando ÍNTEGRAMENTE
     * su historial de apuntes en el ledger (Requirements 9.3: NO se elimina).
     * Requiere el permiso `committee.manage` y que la cuenta pertenezca al
     * comité del usuario. Audita el cambio.
     */
    async deactivateAccount(ctx, accountId): Promise<Result<void>> {
      // R9.3: solo con permiso committee.manage (o superadministrador).
      if (!can(ctx, 'committee.manage')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para administrar cuentas del comité.',
        );
      }

      const client = getClient();

      // Lee la cuenta para confirmar existencia, pertenencia al comité y estado
      // previo (para auditoría old→new). El filtro por committee_id garantiza el
      // aislamiento: no se puede desactivar una cuenta de otro comité.
      const { data: prev, error: readError } = await client
        .from('financial_accounts')
        .select('status, committee_id')
        .eq('id', accountId)
        .single();

      if (readError || !prev) {
        return err('account/not-found', 'La cuenta indicada no existe.');
      }

      const row = prev as { status: string; committee_id: UUID };

      // R2.3/R9.3: solo cuentas del comité del usuario (o superadmin); audita
      // el intento ajeno.
      try {
        await assertCommitteeAccess(ctx, row.committee_id);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado a la cuenta solicitada.');
      }

      // R9.3: marcar como inactiva SIN tocar ledger_entries (se conserva el
      // historial completo). El filtro por committee_id refuerza el aislamiento.
      const { error } = await client
        .from('financial_accounts')
        .update({ status: 'inactive' })
        .eq('id', accountId)
        .eq('committee_id', row.committee_id);

      if (error) {
        return err(
          'account/update-failed',
          `No se pudo desactivar la cuenta: ${error.message}.`,
        );
      }

      await recordAudit(client, {
        committeeId: row.committee_id,
        userId: ctx.userId,
        action: 'account.deactivate',
        entityId: accountId,
        oldValues: { status: row.status },
        newValues: { status: 'inactive' },
      });

      return ok(undefined);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Ledger / saldo derivado (Requirements 10.1, 10.2, 10.3)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Devuelve el saldo DERIVADO de una cuenta como
     *   opening_balance + SUM(ledger_entries.amount)
     * calculado siempre al vuelo, nunca leído de un campo de saldo editable
     * (Requirements 10.1, 10.2). Como se recalcula en cada consulta, refleja
     * automáticamente cualquier apunte nuevo (Requirements 10.3).
     *
     * El cálculo está acotado por `committee_id`, de modo que solo intervienen
     * la cuenta y los apuntes del comité del contexto (aislamiento multi-tenant,
     * Requirements 2.x). Requiere el permiso `transactions.read`. La aritmética
     * usa la utilidad `Money` para preservar exactitud decimal (Requirements
     * 41.1).
     */
    async getDerivedBalance(ctx, accountId): Promise<Result<Money>> {
      // Lectura financiera: exige el permiso de lectura de transacciones.
      if (!can(ctx, 'transactions.read')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para consultar el saldo de la cuenta.',
        );
      }

      const client = getClient();

      // Confirma existencia, pertenencia al comité del contexto y obtiene el
      // saldo inicial. El filtro por committee_id garantiza el aislamiento: no
      // se puede consultar el saldo de una cuenta de otro comité (R2.x, R10.1).
      const { data: account, error: readError } = await client
        .from('financial_accounts')
        .select('opening_balance')
        .eq('id', accountId)
        .eq('committee_id', ctx.committeeId)
        .single();

      if (readError || !account) {
        return err('account/not-found', 'La cuenta indicada no existe.');
      }

      const openingBalance = (account as { opening_balance: string | number }).opening_balance;

      // Suma de apuntes de la cuenta dentro del comité (R10.1). Cualquier apunte
      // nuevo queda incluido porque el saldo se computa aquí (R10.3).
      const { data: entries, error: entriesError } = await client
        .from('ledger_entries')
        .select('amount')
        .eq('committee_id', ctx.committeeId)
        .eq('account_id', accountId);

      if (entriesError) {
        return err(
          'ledger/balance-failed',
          `No se pudo calcular el saldo derivado: ${entriesError.message}.`,
        );
      }

      const balance = sumLedger(openingBalance, (entries ?? []) as LedgerAmountRow[]);
      return ok(balance);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Categorías de transacción (Requirements 13.1, 13.3, 13.4, 13.5)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Crea una categoría de transacción en el catálogo del comité del usuario
     * (Requirements 13.1). Requiere el permiso `committee.manage`. Valida el
     * nombre 1–100 y no vacío/solo espacios (R13.5) y rechaza duplicados por
     * comité mapeando la violación UNIQUE de PostgreSQL (R13.3). Audita.
     */
    async createCategory(ctx, name): Promise<Result<{ categoryId: UUID }>> {
      // R13.1 (RF-041): la administración de categorías es competencia del
      // administrador del comité (permiso committee.manage) o superadmin.
      if (!can(ctx, 'committee.manage')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para administrar categorías del comité.',
        );
      }

      // R13.5: validación de nombre (1–100, no solo espacios).
      const nameCheck = validateCategoryName(name);
      if (!nameCheck.ok) {
        return nameCheck as Result<{ categoryId: UUID }>;
      }

      const client = getClient();

      const { data: created, error } = await client
        .from('transaction_categories')
        .insert({
          committee_id: ctx.committeeId, // R13.1: solo el catálogo del comité del usuario
          name: nameCheck.value,
        })
        .select('id')
        .single();

      if (error || !created) {
        // R13.3: nombre duplicado dentro del mismo comité (UNIQUE committee_id,name).
        if (error?.code === PG_UNIQUE_VIOLATION) {
          return err(
            'category/duplicate-name',
            'Ya existe una categoría con ese nombre en el comité.',
            'name',
          );
        }
        return err(
          'category/create-failed',
          `No se pudo crear la categoría: ${error?.message ?? 'error desconocido'}.`,
        );
      }

      const categoryId = (created as { id: UUID }).id;

      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'category.create',
        entityType: 'transaction_category',
        entityId: categoryId,
        newValues: { name: nameCheck.value },
      });

      return ok({ categoryId });
    },

    /**
     * Renombra una categoría existente dentro del comité del usuario
     * (Requirements 13.1). Requiere el permiso `committee.manage`. Valida el
     * nuevo nombre (R13.5) y rechaza duplicados por comité (R13.3). El filtro
     * por `committee_id` garantiza que no se pueda renombrar una categoría de
     * otro comité. Audita el cambio old→new.
     */
    async renameCategory(ctx, id, name): Promise<Result<void>> {
      if (!can(ctx, 'committee.manage')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para administrar categorías del comité.',
        );
      }

      // R13.5: validación de nombre (1–100, no solo espacios).
      const nameCheck = validateCategoryName(name);
      if (!nameCheck.ok) {
        return nameCheck as Result<void>;
      }

      const client = getClient();

      // Lee la categoría para confirmar existencia y pertenencia al comité
      // (aislamiento R13.1) y capturar el nombre previo para auditoría.
      const { data: prev, error: readError } = await client
        .from('transaction_categories')
        .select('name, committee_id')
        .eq('id', id)
        .eq('committee_id', ctx.committeeId)
        .single();

      if (readError || !prev) {
        return err('category/not-found', 'La categoría indicada no existe.');
      }

      const row = prev as { name: string; committee_id: UUID };

      const { error } = await client
        .from('transaction_categories')
        .update({ name: nameCheck.value })
        .eq('id', id)
        .eq('committee_id', ctx.committeeId); // R13.1: solo el catálogo del comité

      if (error) {
        // R13.3: el nuevo nombre choca con otra categoría del comité (UNIQUE).
        if (error.code === PG_UNIQUE_VIOLATION) {
          return err(
            'category/duplicate-name',
            'Ya existe una categoría con ese nombre en el comité.',
            'name',
          );
        }
        return err(
          'category/update-failed',
          `No se pudo renombrar la categoría: ${error.message}.`,
        );
      }

      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'category.rename',
        entityType: 'transaction_category',
        entityId: id,
        oldValues: { name: row.name },
        newValues: { name: nameCheck.value },
      });

      return ok(undefined);
    },

    /**
     * Elimina una categoría del comité del usuario (Requirements 13.1). Requiere
     * el permiso `committee.manage`. RECHAZA la eliminación si la categoría está
     * asociada a al menos un ingreso/transacción registrada (R13.4), consultando
     * `financial_transactions.category_id`. El filtro por `committee_id`
     * garantiza el aislamiento. Audita la eliminación.
     */
    async deleteCategory(ctx, id): Promise<Result<void>> {
      if (!can(ctx, 'committee.manage')) {
        return err(
          'AUTHZ_FORBIDDEN',
          'No tiene permiso para administrar categorías del comité.',
        );
      }

      const client = getClient();

      // Confirma existencia y pertenencia al comité (aislamiento R13.1) y
      // captura el nombre previo para auditoría.
      const { data: prev, error: readError } = await client
        .from('transaction_categories')
        .select('name, committee_id')
        .eq('id', id)
        .eq('committee_id', ctx.committeeId)
        .single();

      if (readError || !prev) {
        return err('category/not-found', 'La categoría indicada no existe.');
      }

      const row = prev as { name: string; committee_id: UUID };

      // R13.4: no eliminar si hay al menos un ingreso/transacción asociado.
      const { count, error: countError } = await client
        .from('financial_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('committee_id', ctx.committeeId)
        .eq('category_id', id);

      if (countError) {
        return err(
          'category/delete-failed',
          `No se pudo verificar el uso de la categoría: ${countError.message}.`,
        );
      }

      if ((count ?? 0) > 0) {
        return err(
          'category/in-use',
          'No se puede eliminar la categoría porque tiene ingresos asociados.',
        );
      }

      const { error } = await client
        .from('transaction_categories')
        .delete()
        .eq('id', id)
        .eq('committee_id', ctx.committeeId); // R13.1: solo el catálogo del comité

      if (error) {
        return err(
          'category/delete-failed',
          `No se pudo eliminar la categoría: ${error.message}.`,
        );
      }

      await recordAudit(client, {
        committeeId: ctx.committeeId,
        userId: ctx.userId,
        action: 'category.delete',
        entityType: 'transaction_category',
        entityId: id,
        oldValues: { name: row.name },
      });

      return ok(undefined);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Ingresos (Requirements 12.1–12.6, 41.2, 41.3)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Registra un ingreso de forma atómica llamando a `rpc_register_income`
     * (Requirements 12.1–12.6). Requiere el permiso `transactions.create`
     * (R12.3). Valida el monto en el servidor (R12.2) antes de delegar al RPC,
     * que ejecuta la transacción de BD, el apunte de ledger y la auditoría de
     * forma atómica con rollback total ante fallos (R41.3).
     */
    async registerIncome(ctx, data): Promise<Result<{ transactionId: UUID }>> {
      if (!can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para registrar ingresos.');
      }

      const amountCheck = validateIncomeAmount(data?.amount);
      if (!amountCheck.ok) return amountCheck as Result<{ transactionId: UUID }>;

      if (!data?.accountId) {
        return err('income/missing-account', 'La cuenta receptora es obligatoria.', 'accountId');
      }
      if (!data?.date) {
        return err('income/missing-date', 'La fecha del ingreso es obligatoria.', 'date');
      }

      const client = getClient();
      const { data: txId, error } = await client.rpc('rpc_register_income', {
        p_committee_id: ctx.committeeId,
        p_actor: ctx.userId,
        p_account_id: data.accountId,
        p_category_id: data.categoryId ?? null,
        p_activity_id: data.activityId ?? null,
        p_amount: amountCheck.value,
        p_date: data.date,
        p_description: data.description ?? null,
        p_source_type: data.sourceType ?? null,
        p_source_id: data.sourceId ?? null,
        p_origin: data.origin ?? null,
        p_payment_method: data.paymentMethod ?? null,
      });

      if (error) {
        const msg = error.message ?? '';
        if (msg.includes('no está activa') || msg.includes('not active')) {
          return err('income/account-inactive', 'La cuenta receptora no está activa.', 'accountId');
        }
        if (msg.includes('no pertenece') || msg.includes('does not belong')) {
          return err('income/account-not-found', 'La cuenta receptora no pertenece al comité.', 'accountId');
        }
        if (msg.includes('no existe') || msg.includes('does not exist')) {
          return err('income/account-not-found', 'La cuenta receptora no existe.', 'accountId');
        }
        return err('income/register-failed', `No se pudo registrar el ingreso: ${msg}.`);
      }

      return ok({ transactionId: txId as UUID });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Egresos (Requirements 14.1–14.5, 41.2, 41.3)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Registra un egreso de forma atómica llamando a `rpc_register_expense`
     * (Requirements 14.1–14.5). Requiere el permiso `transactions.create`
     * (R14.1). Valida el monto (R14.2) y los campos obligatorios (R14.3) antes
     * de delegar al RPC con rollback total (R41.3).
     */
    async registerExpense(ctx, data): Promise<Result<{ transactionId: UUID }>> {
      if (!can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para registrar egresos.');
      }

      const amountCheck = validateExpenseAmount(data?.amount);
      if (!amountCheck.ok) return amountCheck as Result<{ transactionId: UUID }>;

      if (!data?.accountId) {
        return err('expense/missing-account', 'La cuenta de origen es obligatoria.', 'accountId');
      }
      if (!data?.categoryId) {
        return err('expense/missing-category', 'La categoría es obligatoria.', 'categoryId');
      }
      if (!data?.date) {
        return err('expense/missing-date', 'La fecha del egreso es obligatoria.', 'date');
      }
      if (!data?.beneficiary?.trim()) {
        return err('expense/missing-beneficiary', 'El beneficiario es obligatorio.', 'beneficiary');
      }
      if (!data?.description?.trim()) {
        return err('expense/missing-description', 'La descripción es obligatoria.', 'description');
      }
      if (!data?.paymentMethod?.trim()) {
        return err('expense/missing-payment-method', 'El método de pago es obligatorio.', 'paymentMethod');
      }

      const client = getClient();
      const { data: txId, error } = await client.rpc('rpc_register_expense', {
        p_committee_id: ctx.committeeId,
        p_actor: ctx.userId,
        p_account_id: data.accountId,
        p_category_id: data.categoryId,
        p_activity_id: data.activityId ?? null,
        p_amount: amountCheck.value,
        p_date: data.date,
        p_beneficiary: data.beneficiary,
        p_description: data.description,
        p_payment_method: data.paymentMethod,
        p_source_type: data.sourceType ?? null,
        p_source_id: data.sourceId ?? null,
      });

      if (error) {
        const msg = error.message ?? '';
        if (msg.includes('no está activa') || msg.includes('not active')) {
          return err('expense/account-inactive', 'La cuenta de origen no está activa.', 'accountId');
        }
        if (msg.includes('no pertenece') || msg.includes('does not belong')) {
          return err('expense/account-not-found', 'La cuenta de origen no pertenece al comité.', 'accountId');
        }
        if (msg.includes('no existe') || msg.includes('does not exist')) {
          return err('expense/account-not-found', 'La cuenta de origen no existe.', 'accountId');
        }
        return err('expense/register-failed', `No se pudo registrar el egreso: ${msg}.`);
      }

      return ok({ transactionId: txId as UUID });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Transferencias (Requirements 11.1–11.6, 41.2, 41.3)
    // ─────────────────────────────────────────────────────────────────────────

    async transfer(ctx, data): Promise<Result<{ transactionId: UUID }>> {
      if (!can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para registrar transferencias.');
      }

      const amountCheck = validateTransferAmount(data?.amount);
      if (!amountCheck.ok) return amountCheck as Result<{ transactionId: UUID }>;

      if (!data?.fromAccountId) {
        return err('transfer/missing-from', 'La cuenta de origen es obligatoria.', 'fromAccountId');
      }
      if (!data?.toAccountId) {
        return err('transfer/missing-to', 'La cuenta de destino es obligatoria.', 'toAccountId');
      }
      if (data.fromAccountId === data.toAccountId) {
        return err('transfer/same-account', 'Las cuentas de origen y destino deben ser distintas.', 'toAccountId');
      }
      if (!data?.date) {
        return err('transfer/missing-date', 'La fecha es obligatoria.', 'date');
      }

      const client = getClient();
      const { data: txId, error } = await client.rpc('rpc_transfer', {
        p_committee_id: ctx.committeeId,
        p_actor: ctx.userId,
        p_from_account: data.fromAccountId,
        p_to_account: data.toAccountId,
        p_amount: amountCheck.value,
        p_date: data.date,
        p_description: data.description ?? null,
      });

      if (error) {
        const msg = error.message ?? '';
        if (msg.includes('misma cuenta') || msg.includes('distintas') || msg.includes('deben ser distintas')) {
          return err('transfer/same-account', 'Las cuentas de origen y destino deben ser distintas.', 'toAccountId');
        }
        if (msg.includes('no está activa')) {
          return err('transfer/account-inactive', 'Una de las cuentas no está activa.');
        }
        if (msg.includes('no pertenece') || msg.includes('no existe')) {
          return err('transfer/account-not-found', 'Una de las cuentas no existe o no pertenece al comité.');
        }
        return err('transfer/failed', `No se pudo registrar la transferencia: ${msg}.`);
      }

      return ok({ transactionId: txId as UUID });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Aprobación (Requirements 15.1, 15.2)
    // ─────────────────────────────────────────────────────────────────────────

    async approve(ctx, transactionId): Promise<Result<void>> {
      if (!can(ctx, 'transactions.approve')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para aprobar transacciones.');
      }

      const client = getClient();

      const { data: tx, error: readErr } = await client
        .from('financial_transactions')
        .select('status, committee_id')
        .eq('id', transactionId)
        .single();

      if (readErr || !tx) {
        return err('transaction/not-found', 'La transacción indicada no existe.');
      }

      const row = tx as { status: string; committee_id: UUID };

      try {
        await assertCommitteeAccess(ctx, row.committee_id);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado a la transacción.');
      }

      if (row.status !== 'draft') {
        return err('transaction/invalid-status', `Solo se pueden aprobar transacciones en estado borrador (estado actual: ${row.status}).`);
      }

      const { error } = await client
        .from('financial_transactions')
        .update({ status: 'posted', approved_by: ctx.userId })
        .eq('id', transactionId)
        .eq('committee_id', row.committee_id);

      if (error) {
        return err('transaction/approve-failed', `No se pudo aprobar la transacción: ${error.message}.`);
      }

      await recordAudit(client, {
        committeeId: row.committee_id,
        userId: ctx.userId,
        action: 'transaction.approved',
        entityType: 'financial_transaction',
        entityId: transactionId,
        oldValues: { status: 'draft' },
        newValues: { status: 'posted' },
      });

      return ok(undefined);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Anulación (Requirements 15.3, 15.4, 41.3)
    // ─────────────────────────────────────────────────────────────────────────

    async void(ctx, transactionId, reason): Promise<Result<{ reversalId: UUID }>> {
      if (!can(ctx, 'transactions.approve')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para anular transacciones.');
      }

      const client = getClient();
      const { data: reversalId, error } = await client.rpc('rpc_void_transaction', {
        p_committee_id: ctx.committeeId,
        p_actor: ctx.userId,
        p_transaction_id: transactionId,
        p_reason: reason ?? null,
      });

      if (error) {
        const msg = error.message ?? '';
        if (msg.includes('no encontrada') || msg.includes('no pertenece')) {
          return err('transaction/not-found', 'La transacción indicada no existe en este comité.');
        }
        if (msg.includes('estado actual')) {
          return err('transaction/invalid-status', 'Solo se pueden anular transacciones en estado aprobado (posted).');
        }
        return err('transaction/void-failed', `No se pudo anular la transacción: ${msg}.`);
      }

      return ok({ reversalId: reversalId as UUID });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Cancelar (descartar) borrador
    // Elimina una transacción en estado 'draft' junto con sus apuntes de ledger,
    // de forma que deje de sumar/restar al saldo de la cuenta. No genera reversal
    // porque el movimiento nunca fue aprobado. Solo aplica a 'draft'.
    // ─────────────────────────────────────────────────────────────────────────

    async cancelDraft(ctx, transactionId): Promise<Result<void>> {
      if (!can(ctx, 'transactions.create') && !can(ctx, 'transactions.approve')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para cancelar transacciones.');
      }

      const client = getClient();

      const { data: tx, error: readErr } = await client
        .from('financial_transactions')
        .select('status, committee_id, type')
        .eq('id', transactionId)
        .single();

      if (readErr || !tx) {
        return err('transaction/not-found', 'La transacción indicada no existe.');
      }

      const row = tx as { status: string; committee_id: UUID; type: string };

      try {
        await assertCommitteeAccess(ctx, row.committee_id);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado a la transacción.');
      }

      if (row.status !== 'draft') {
        return err(
          'transaction/invalid-status',
          `Solo se pueden cancelar transacciones en borrador. Una transacción aprobada debe anularse. (estado actual: ${row.status}).`,
        );
      }

      // Desvincular posibles orígenes de dominio (aportaciones/donaciones) que
      // referencien esta transacción, para no romper sus FK al borrarla.
      await client
        .from('contributions')
        .update({ financial_transaction_id: null })
        .eq('committee_id', row.committee_id)
        .eq('financial_transaction_id', transactionId);
      await client
        .from('donations')
        .update({ financial_transaction_id: null })
        .eq('committee_id', row.committee_id)
        .eq('financial_transaction_id', transactionId);

      // Borrar hijos antes de la cabecera (todas las FK son RESTRICT).
      await client.from('transaction_attachments').delete().eq('committee_id', row.committee_id).eq('transaction_id', transactionId);
      await client.from('transfers').delete().eq('committee_id', row.committee_id).eq('transaction_id', transactionId);
      const { error: leErr } = await client
        .from('ledger_entries')
        .delete()
        .eq('committee_id', row.committee_id)
        .eq('transaction_id', transactionId);
      if (leErr) {
        return err('transaction/cancel-failed', `No se pudo cancelar la transacción: ${leErr.message}.`);
      }

      const { error: delErr } = await client
        .from('financial_transactions')
        .delete()
        .eq('id', transactionId)
        .eq('committee_id', row.committee_id);
      if (delErr) {
        return err('transaction/cancel-failed', `No se pudo cancelar la transacción: ${delErr.message}.`);
      }

      await recordAudit(client, {
        committeeId: row.committee_id,
        userId: ctx.userId,
        action: 'transaction.cancelled',
        entityType: 'financial_transaction',
        entityId: transactionId,
        oldValues: { status: 'draft', type: row.type },
        newValues: null,
      });

      return ok(undefined);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Adjuntos (Requirements 16.1, 40.4)
    // ─────────────────────────────────────────────────────────────────────────

    /** Bucket privado para comprobantes (R16.1). La creación del bucket en
     *  Supabase Dashboard/CLI es un paso de infraestructura fuera de esta capa. */
    async attach(ctx, transactionId, storagePath, kind): Promise<Result<{ attachmentId: UUID }>> {
      if (!can(ctx, 'transactions.create')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para adjuntar comprobantes.');
      }

      const client = getClient();

      // Verify transaction belongs to this committee.
      const { data: tx, error: txErr } = await client
        .from('financial_transactions')
        .select('id')
        .eq('id', transactionId)
        .eq('committee_id', ctx.committeeId)
        .single();

      if (txErr || !tx) {
        return err('transaction/not-found', 'La transacción indicada no existe en este comité.');
      }

      const { data: inserted, error } = await client
        .from('transaction_attachments')
        .insert({
          committee_id: ctx.committeeId,
          transaction_id: transactionId,
          storage_path: storagePath,
          kind: kind ?? null,
          uploaded_by: ctx.userId,
        })
        .select('id')
        .single();

      if (error || !inserted) {
        return err('attachment/failed', `No se pudo registrar el adjunto: ${error?.message ?? 'error desconocido'}.`);
      }

      return ok({ attachmentId: (inserted as { id: UUID }).id });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Signed URL (Requirements 16.2, 16.3, 40.4)
    // ─────────────────────────────────────────────────────────────────────────

    async getSignedUrl(ctx, attachmentId): Promise<Result<string>> {
      if (!can(ctx, 'transactions.read')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para ver comprobantes.');
      }

      const client = getClient();

      const { data: att, error: attErr } = await client
        .from('transaction_attachments')
        .select('storage_path, committee_id')
        .eq('id', attachmentId)
        .single();

      if (attErr || !att) {
        return err('attachment/not-found', 'El adjunto indicado no existe.');
      }

      const row = att as { storage_path: string; committee_id: UUID };

      // Aislamiento: solo el comité propietario puede obtener la URL (R16.3).
      try {
        await assertCommitteeAccess(ctx, row.committee_id);
      } catch {
        return err('AUTHZ_FORBIDDEN', 'Acceso no autorizado al adjunto solicitado.');
      }

      const { data: signed, error: urlErr } = await client.storage
        .from('transaction-attachments')
        .createSignedUrl(row.storage_path, 3600); // 1 h (R16.2)

      if (urlErr || !signed?.signedUrl) {
        return err('attachment/url-failed', 'No se pudo generar la URL del comprobante.');
      }

      return ok(signed.signedUrl);
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Auditoría (compartida por las operaciones de FinanceService)
// ═════════════════════════════════════════════════════════════════════════════

interface AuditInput {
  committeeId: UUID;
  userId: UUID;
  action: string;
  entityId: UUID;
  /** Tipo de entidad auditada; por defecto `financial_account`. */
  entityType?: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

/**
 * Escribe un registro de auditoría atribuible a usuario y fecha (Requirements
 * 36.1). No propaga errores de auditoría para no enmascarar el éxito de la
 * operación de negocio; los registra por consola.
 */
async function recordAudit(client: SupabaseClient, entry: AuditInput): Promise<void> {
  try {
    const { error } = await client.from('audit_logs').insert({
      committee_id: entry.committeeId,
      user_id: entry.userId,
      entity_type: entry.entityType ?? 'financial_account',
      entity_id: entry.entityId,
      action: entry.action,
      old_values: entry.oldValues ?? null,
      new_values: entry.newValues ?? null,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudo auditar la operación de cuenta:', error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('No se pudo auditar la operación de cuenta:', e);
  }
}
