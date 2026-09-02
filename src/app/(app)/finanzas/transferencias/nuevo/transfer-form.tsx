'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { Result, UUID } from '@/domain/types';
import { transferAction } from '@/server/actions/finance-actions';
import { todayIso } from '@/lib/date';

interface AccountOption { id: UUID; name: string; }

const AMOUNT_MAX = 999_999_999.99;

export function TransferForm({ accounts, onDone }: { accounts: AccountOption[]; onDone?: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [fromId, setFromId] = useState(accounts[0]?.id ?? '');
  const [toId, setToId] = useState(accounts[1]?.id ?? accounts[0]?.id ?? '');

  const amountNum = parseFloat(amount);
  const amountValid = amount.trim() !== '' && !isNaN(amountNum) && amountNum >= 0.01
    && amountNum <= AMOUNT_MAX && /^\d+(\.\d{1,2})?$/.test(amount.trim());
  const accountsValid = !!fromId && !!toId && fromId !== toId;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm(`¿Confirmar transferencia de $${amount} de la cuenta seleccionada?`)) return;
    setError(null);
    setSuccess(null);
    const fd = new FormData(event.currentTarget);
    startTransition(async () => {
      const result: Result<{ transactionId: UUID }> = await transferAction({
        fromAccountId: fromId,
        toAccountId: toId,
        amount: amount.trim(),
        date: String(fd.get('date') ?? ''),
        description: String(fd.get('description') ?? '') || null,
      });
      if (!result.ok) { setError(result.error.message); return; }
      setSuccess('Transferencia registrada correctamente.');
      (event.target as HTMLFormElement).reset();
      setAmount('');
      router.refresh();
      onDone?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
      <h2 className="text-lg font-semibold">Nueva transferencia</h2>

      <div className="flex flex-col gap-1">
        <label htmlFor="tf-from" className="text-sm font-medium">
          Cuenta origen<span className="ml-0.5 text-red-600">*</span>
        </label>
        <select id="tf-from" value={fromId} disabled={isPending} onChange={(e) => setFromId(e.target.value)}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="tf-to" className="text-sm font-medium">
          Cuenta destino<span className="ml-0.5 text-red-600">*</span>
        </label>
        <select id="tf-to" value={toId} disabled={isPending} onChange={(e) => setToId(e.target.value)}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {fromId === toId && fromId ? <p className="text-xs text-red-600">Las cuentas deben ser distintas.</p> : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="tf-amount" className="text-sm font-medium">
          Monto<span className="ml-0.5 text-red-600">*</span>
        </label>
        <input id="tf-amount" type="number" inputMode="decimal" min="0.01" step="0.01"
          placeholder="0.00" value={amount} disabled={isPending} onChange={(e) => setAmount(e.target.value)}
          className={`min-h-touch w-full rounded-lg border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:bg-gray-900 ${!amountValid && amount ? 'border-red-400' : 'border-gray-300 dark:border-gray-700'}`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="tf-date" className="text-sm font-medium">
          Fecha<span className="ml-0.5 text-red-600">*</span>
        </label>
        <input id="tf-date" name="date" type="date" required disabled={isPending} defaultValue={todayIso()}
          className="min-h-touch w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="tf-desc" className="text-sm font-medium">Descripción</label>
        <textarea id="tf-desc" name="description" rows={2} disabled={isPending}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      {success ? <p role="status" className="text-sm text-green-700 dark:text-green-400">{success}</p> : null}

      <button type="submit" disabled={isPending || !amountValid || !accountsValid}
        className="min-h-touch rounded-lg bg-brand px-4 py-2 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
        {isPending ? 'Registrando…' : 'Registrar transferencia'}
      </button>
    </form>
  );
}
