import Link from 'next/link';

export const dynamic = 'force-dynamic';

const REPORTS = [
  { href: '/reportes/corte-bonos', label: 'Corte mensual de bonos', description: 'Esperado, cobrado, entregado, premios — por campaña y periodo.' },
];

export default function ReportesPage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-bold">Reportes</h1>
      <ul className="flex flex-col gap-3">
        {REPORTS.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="block rounded-2xl border border-gray-200 p-4 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900">
              <p className="font-semibold">{r.label}</p>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{r.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
