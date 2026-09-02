'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { Result, UUID } from '@/domain/types';
import { registerExpenseAction } from '@/server/actions/finance-actions';
import { todayIso } from '@/lib/date';

interface AccountOption { id: UUID; name: string; }
interface CategoryOption { id: UUID; name: string; }

interface ExpenseFormData {
  accountId: UUID;
  categoryId: UUID;
  amount: string;
  date: string;
  beneficiary: string;
  description: string;
  paymentMethod: string;
}

const AMOUNT_MAX = 999_999_999.99;

const PAYMENT_METHODS = ['efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro'] as const;
const PAYMENT_LABELS: Record<string, string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque',
  tarjeta: 'Tarjeta', otro: 'Otro',
};

export function ExpenseForm({ accounts, categories, onDone }: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHODS[0]);

  const amountNum = parseFloat(amount);
  const amountValid = amount.trim() !== '' && !isNaN(amountNum) && amountNum >= 0.01
    && amountNum <= AMOUNT_MAX && /^\d+(\.\d{1,2})?$/.test(amount.trim());

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData(event.currentTarget);
    const data: ExpenseFormData = {
      accountId,
      categoryId,
      amount: amount.trim(),
      date: String(fd.get('date') ?? ''),
      beneficiary: String(fd.get('beneficiary') ?? ''),
      description: String(fd.get('description') ?? ''),
      paymentMethod,
    };
    startTransition(async () => {
      const result: Result<{ transactionId: UUID }> = await registerExpenseAction(data);
      if (!result.ok) { setError(result.error.message); return; }
      setSuccess('Egreso registrado correctamente.');
      (event.target as HTMLFormElement).reset();
      setAmount('');
      router.refresh();
      onDone?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <h2 className="text-lg font-semibold">Nuevo egreso</h2>

      {/* Cuenta de origen */}
      <div className="flex flex-col gap-1">
        <label htmlFor="expense-account" className="text-sm font-medium">
          Cuenta de origen<span className="ml-0.5 text-red-600">*</span>
        </label>
        <select id="expense-account" name="accountId" value={accountId} disabled={isPending}
          onChange={(e) => setAccountId(e.target.value)}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {/* Monto */}
      <div className="flex flex-col gap-1">
        <label htmlFor="expense-amount" className="text-sm font-medium">
          Monto<span className="ml-0.5 text-red-600">*</span>
        </label>
        <input id="expense-amount" name="amount" type="number" inputMode="decimal"
          min="0.01" max={AMOUNT_MAX} step="0.01" placeholder="0.00" value={amount}
          disabled={isPending} onChange={(e) => setAmount(e.target.value)}
          className={`min-h-touch w-full rounded-lg border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:bg-gray-900 ${!amountValid && amount ? 'border-red-400' : 'border-gray-300 dark:border-gray-700'}`}
        />
        {!amountValid && amount ? (
          <p className="text-xs text-red-600">Ingrese un monto de 0.01 a 999,999,999.99 con máximo 2 decimales.</p>
        ) : null}
      </div>

      {/* Fecha */}
      <div className="flex flex-col gap-1">
        <label htmlFor="expense-date" className="text-sm font-medium">
          Fecha<span className="ml-0.5 text-red-600">*</span>
        </label>
        <input id="expense-date" name="date" type="date" required disabled={isPending} defaultValue={todayIso()}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {/* Beneficiario */}
      <div className="flex flex-col gap-1">
        <label htmlFor="expense-beneficiary" className="text-sm font-medium">
          Beneficiario<span className="ml-0.5 text-red-600">*</span>
        </label>
        <input id="expense-beneficiary" name="beneficiary" type="text" required disabled={isPending}
          placeholder="Proveedor o persona beneficiaria"
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {/* Descripción */}
      <div className="flex flex-col gap-1">
        <label htmlFor="expense-description" className="text-sm font-medium">
          Descripción<span className="ml-0.5 text-red-600">*</span>
        </label>
        <textarea id="expense-description" name="description" rows={2} required disabled={isPending}
          placeholder="Concepto del egreso"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {/* Categoría */}
      <div className="flex flex-col gap-1">
        <label htmlFor="expense-category" className="text-sm font-medium">
          Categoría<span className="ml-0.5 text-red-600">*</span>
        </label>
        <select id="expense-category" name="categoryId" value={categoryId} disabled={isPending}
          onChange={(e) => setCategoryId(e.target.value)}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900">
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Método de pago */}
      <div className="flex flex-col gap-1">
        <label htmlFor="expense-payment" className="text-sm font-medium">
          Método de pago<span className="ml-0.5 text-red-600">*</span>
        </label>
        <select id="expense-payment" name="paymentMethod" value={paymentMethod} disabled={isPending}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900">
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
        </select>
      </div>

      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {success ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{success}</p> : null}

      <button type="submit" disabled={isPending || !amountValid || !accountId || !categoryId}
        className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
        {isPending ? 'Registrando…' : 'Registrar egreso'}
      </button>
    </form>
  );
}
