'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { Result, UUID } from '@/domain/types';
import { registerIncomeAction } from '@/server/actions/finance-actions';
import { todayIso } from '@/lib/date';

interface AccountOption { id: UUID; name: string; }
interface CategoryOption { id: UUID; name: string; }

// Mirrors IncomeInput (server-only type not imported here).
interface IncomeFormData {
  accountId: UUID;
  categoryId?: string;
  amount: string;
  date: string;
  description?: string;
  paymentMethod?: string;
}

const AMOUNT_MAX = 999_999_999_999.99;

const PAYMENT_METHODS = ['efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro'] as const;
const PAYMENT_LABELS: Record<string, string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque',
  tarjeta: 'Tarjeta', otro: 'Otro',
};

export function IncomeForm({ accounts, categories, onDone }: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Controlled fields that need validation hints.
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHODS[0]);

  const amountNum = parseFloat(amount);
  const amountValid = amount.trim() !== '' && !isNaN(amountNum) && amountNum > 0
    && amountNum <= AMOUNT_MAX && /^\d+(\.\d{1,2})?$/.test(amount.trim());

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData(event.currentTarget);
    const data: IncomeFormData = {
      accountId,
      categoryId: String(fd.get('categoryId') ?? '') || undefined,
      amount: amount.trim(),
      date: String(fd.get('date') ?? ''),
      description: String(fd.get('description') ?? '') || undefined,
      paymentMethod,
    };
    startTransition(async () => {
      const result: Result<{ transactionId: UUID }> = await registerIncomeAction(data);
      if (!result.ok) { setError(result.error.message); return; }
      setSuccess('Ingreso registrado correctamente.');
      (event.target as HTMLFormElement).reset();
      setAmount('');
      router.refresh();
      onDone?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <h2 className="text-lg font-semibold">Nuevo ingreso</h2>

      {/* Cuenta receptora */}
      <div className="flex flex-col gap-1">
        <label htmlFor="income-account" className="text-sm font-medium">
          Cuenta receptora<span className="ml-0.5 text-red-600">*</span>
        </label>
        <select id="income-account" name="accountId" value={accountId} disabled={isPending}
          onChange={(e) => setAccountId(e.target.value)}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {/* Monto */}
      <div className="flex flex-col gap-1">
        <label htmlFor="income-amount" className="text-sm font-medium">
          Monto<span className="ml-0.5 text-red-600">*</span>
        </label>
        <input id="income-amount" name="amount" type="number" inputMode="decimal"
          min="0.01" step="0.01" placeholder="0.00" value={amount} disabled={isPending}
          onChange={(e) => setAmount(e.target.value)}
          className={`min-h-touch w-full rounded-lg border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:bg-gray-900 ${!amountValid && amount ? 'border-red-400' : 'border-gray-300 dark:border-gray-700'}`}
        />
        {!amountValid && amount ? (
          <p className="text-xs text-red-600">Ingrese un monto válido mayor a 0 con máximo 2 decimales.</p>
        ) : null}
      </div>

      {/* Fecha */}
      <div className="flex flex-col gap-1">
        <label htmlFor="income-date" className="text-sm font-medium">
          Fecha<span className="ml-0.5 text-red-600">*</span>
        </label>
        <input id="income-date" name="date" type="date" required disabled={isPending} defaultValue={todayIso()}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {/* Categoría */}
      <div className="flex flex-col gap-1">
        <label htmlFor="income-category" className="text-sm font-medium">Categoría</label>
        <select id="income-category" name="categoryId" disabled={isPending}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900">
          <option value="">Sin categoría</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Método de pago */}
      <div className="flex flex-col gap-1">
        <label htmlFor="income-payment" className="text-sm font-medium">Método de pago</label>
        <select id="income-payment" name="paymentMethod" value={paymentMethod} disabled={isPending}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900">
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
        </select>
      </div>

      {/* Descripción */}
      <div className="flex flex-col gap-1">
        <label htmlFor="income-description" className="text-sm font-medium">Descripción</label>
        <textarea id="income-description" name="description" rows={2} disabled={isPending}
          placeholder="Concepto del ingreso (opcional)"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {success ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{success}</p> : null}

      <button type="submit" disabled={isPending || !amountValid || !accountId}
        className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
        {isPending ? 'Registrando…' : 'Registrar ingreso'}
      </button>
    </form>
  );
}
