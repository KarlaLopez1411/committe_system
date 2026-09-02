'use client';

import { useState } from 'react';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Miembro que ya reportó su aportación en el periodo. */
export interface ReportedMember {
  memberId: string;
  name: string;
  amount: string | null;
}

/** Miembro comprometido que aún falta por reportar en el periodo. */
export interface MissingMember {
  memberId: string;
  name: string;
}

/** Seguimiento de un periodo (mes/año) de aportaciones. */
export interface ContributionPeriod {
  /** Primer día del periodo, 'YYYY-MM-01'. */
  period: string;
  reported: ReportedMember[];
  missing: MissingMember[];
}

/** Etiqueta legible del periodo: 'Agosto 2026'. */
function periodLabel(period: string): string {
  const [year, month] = period.split('-');
  const m = Number(month);
  const name = MONTH_NAMES[m - 1] ?? month;
  return `${name} ${year}`;
}

/**
 * Tabla colapsable de aportaciones por periodo (mes/año). Cada fila es un
 * periodo con aportaciones registradas; al expandirla muestra los miembros que
 * ya se reportaron y los miembros comprometidos que aún faltan.
 */
export function ContributionPeriods({ periods }: { periods: ContributionPeriod[] }) {
  // El periodo más reciente arranca expandido.
  const [openPeriods, setOpenPeriods] = useState<Set<string>>(
    () => new Set(periods.length > 0 ? [periods[0]!.period] : []),
  );

  function toggle(period: string) {
    setOpenPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(period)) next.delete(period);
      else next.add(period);
      return next;
    });
  }

  if (periods.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        Aún no hay aportaciones registradas.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {periods.map((p) => {
        const isOpen = openPeriods.has(p.period);
        return (
          <li key={p.period} className="rounded-2xl border border-gray-200 dark:border-gray-800">
            {/* Cabecera del periodo (clic para colapsar/expandir) */}
            <button
              type="button"
              onClick={() => toggle(p.period)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}
                >
                  ▶
                </span>
                <span className="font-semibold">{periodLabel(p.period)}</span>
              </span>
              <span className="flex items-center gap-2 text-xs font-medium">
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                  {p.reported.length} reportado{p.reported.length === 1 ? '' : 's'}
                </span>
                {p.missing.length > 0 ? (
                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">
                    {p.missing.length} faltante{p.missing.length === 1 ? '' : 's'}
                  </span>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    Sin faltantes
                  </span>
                )}
              </span>
            </button>

            {/* Detalle */}
            {isOpen ? (
              <div className="grid gap-4 border-t border-gray-100 p-4 dark:border-gray-900 sm:grid-cols-2">
                {/* Reportados */}
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Reportados ({p.reported.length})
                  </h4>
                  {p.reported.length === 0 ? (
                    <p className="text-sm text-gray-400">Nadie ha reportado.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {p.reported.map((m) => (
                        <li
                          key={m.memberId}
                          className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-1.5 text-sm dark:bg-green-900/20"
                        >
                          <span>{m.name}</span>
                          {m.amount ? (
                            <span className="font-semibold tabular-nums text-green-700 dark:text-green-400">
                              ${m.amount}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Comprometidos faltantes */}
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Comprometidos faltantes ({p.missing.length})
                  </h4>
                  {p.missing.length === 0 ? (
                    <p className="text-sm text-gray-400">Todos los comprometidos reportaron.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {p.missing.map((m) => (
                        <li
                          key={m.memberId}
                          className="rounded-lg bg-yellow-50 px-3 py-1.5 text-sm dark:bg-yellow-900/20"
                        >
                          {m.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
