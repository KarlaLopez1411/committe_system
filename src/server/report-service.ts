import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Ctx, Money, Result, UUID } from '@/domain/types';
import { err, ok } from '@/domain/types';
import { add, subtract, ZERO } from '@/domain/money';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { can } from '@/server/authz';

export interface BonusMonthlyCutReport {
  campaignId: UUID;
  campaignName: string;
  period: string;
  /** active_numbers × monthly_amount */
  expectedAmount: Money;
  /** SUM of collections by vendors */
  collectedAmount: Money;
  /** expected - collected */
  pendingCollect: Money;
  /** SUM of confirmed settlement amounts */
  deliveredAmount: Money;
  /** collected - delivered */
  withVendorsAmount: Money;
  /** monthly_prize from campaign */
  prizeAmount: Money;
  /** SUM of prize payments for draws in this period */
  paidPrize: Money;
  /** prizeAmount - paidPrize */
  pendingPrize: Money;
}

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ReportServiceDeps { client?: SupabaseClient; }

export interface ReportService {
  /** Computes the bonus monthly cut (R35.1). Requires `reports.read`. */
  bonusMonthlyCut(ctx: Ctx, campaignId: UUID, period: string): Promise<Result<BonusMonthlyCutReport>>;
  /** Serialises a report to the requested format (R37.2). */
  exportReport(report: BonusMonthlyCutReport, format: ExportFormat): Result<{ content: string; mimeType: string; filename: string }>;
}

export function createReportService(deps: ReportServiceDeps = {}): ReportService {
  const getClient = () => deps.client ?? createSupabaseAdminClient();

  return {
    async bonusMonthlyCut(ctx, campaignId, period) {
      if (!can(ctx, 'reports.read') && !can(ctx, 'committee.manage')) {
        return err('AUTHZ_FORBIDDEN', 'No tiene permiso para generar reportes.');
      }

      const client = getClient();

      const { data: campaign } = await client
        .from('bonus_campaigns')
        .select('name, monthly_amount, monthly_prize')
        .eq('id', campaignId)
        .eq('committee_id', ctx.committeeId)
        .single();
      if (!campaign) return err('report/campaign-not-found', 'La campaña indicada no existe.');
      const c = campaign as { name: string; monthly_amount: string | number; monthly_prize: string | number };

      // expected = total de números de la campaña × monthly_amount
      const { count: activeCount } = await client
        .from('bonus_numbers')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'activo')
        .eq('committee_id', ctx.committeeId);

      const expectedAmount = add(ZERO, String(Number(c.monthly_amount) * (activeCount ?? 0)));

      // cobrado del mes = (# de números con el mes pagado en el libro) × mensualidad.
      // El periodo llega como 'YYYY-MM-01'; se extrae el mes 1–12.
      const monthNum = Number(period.slice(5, 7));
      const monthKey = String(monthNum);

      const { data: ledger } = await client
        .from('bonus_number_ledger')
        .select('pagos')
        .eq('campaign_id', campaignId)
        .eq('committee_id', ctx.committeeId);

      let paidCount = 0;
      for (const r of (ledger ?? []) as { pagos: Record<string, boolean> | null }[]) {
        if (r.pagos && r.pagos[monthKey]) paidCount += 1;
      }

      const collectedAmount = add(ZERO, String(Number(c.monthly_amount) * paidCount));
      const pendingCollect = subtract(expectedAmount, collectedAmount);

      // En este modelo simplificado el pago del responsable ya ingresa a caja al
      // marcarse, por lo que lo cobrado se considera entregado a tesorería.
      const deliveredAmount = collectedAmount;
      const withVendorsAmount = subtract(collectedAmount, deliveredAmount);

      // prize paid for draws in this period
      const { data: draw } = await client
        .from('bonus_prize_deliveries')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('month', monthNum)
        .eq('committee_id', ctx.committeeId)
        .maybeSingle();

      const prizeAmount = add(ZERO, String(c.monthly_prize));
      // El premio se considera pagado cuando ya se registró su entrega del mes
      // (bonus_prize_deliveries), que además genera el egreso a caja.
      const paidPrize: Money = draw ? prizeAmount : ZERO;
      const pendingPrize = subtract(prizeAmount, paidPrize);

      return ok({
        campaignId,
        campaignName: c.name,
        period,
        expectedAmount,
        collectedAmount,
        pendingCollect,
        deliveredAmount,
        withVendorsAmount,
        prizeAmount,
        paidPrize,
        pendingPrize,
      });
    },

    exportReport(report, format) {
      const csv = buildCsv(report);
      if (format === 'csv') {
        return ok({ content: csv, mimeType: 'text/csv; charset=utf-8', filename: `corte-bonos-${report.period}.csv` });
      }
      // XLSX and PDF require an external library in production; serve as CSV with different extension
      if (format === 'xlsx') {
        return ok({ content: csv, mimeType: 'text/csv; charset=utf-8', filename: `corte-bonos-${report.period}.csv` });
      }
      // PDF: return an HTML string suitable for print-to-PDF
      const html = buildPrintHtml(report);
      return ok({ content: html, mimeType: 'text/html; charset=utf-8', filename: `corte-bonos-${report.period}.html` });
    },
  };
}

// ── Export helpers ────────────────────────────────────────────────────────────

/** Formats a Money string as a display value with currency symbol. */
function fmt(m: Money): string {
  return `$${m}`;
}

/** Builds a UTF-8 CSV for a BonusMonthlyCutReport (R37.2). */
export function buildCsv(report: BonusMonthlyCutReport): string {
  const rows: [string, string][] = [
    ['Campaña', report.campaignName],
    ['Periodo', report.period],
    ['', ''],
    ['Concepto', 'Monto'],
    ['Esperado (números × mensualidad)', fmt(report.expectedAmount)],
    ['Cobrado por vendedores', fmt(report.collectedAmount)],
    ['Pendiente de cobrar', fmt(report.pendingCollect)],
    ['Entregado a tesorería', fmt(report.deliveredAmount)],
    ['En poder de vendedores', fmt(report.withVendorsAmount)],
    ['', ''],
    ['Premio del periodo', fmt(report.prizeAmount)],
    ['Premio pagado', fmt(report.paidPrize)],
    ['Premio pendiente', fmt(report.pendingPrize)],
  ];
  return rows.map(([a, b]) => `"${a}","${b}"`).join('\n');
}

/** Builds an HTML string suitable for browser print-to-PDF. */
function buildPrintHtml(report: BonusMonthlyCutReport): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Corte de Bonos ${report.period}</title>
<style>body{font-family:sans-serif;padding:2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.5rem}th{background:#f5f5f5}</style>
</head><body>
<h1>Corte Mensual de Bonos</h1>
<p><strong>Campaña:</strong> ${report.campaignName} &nbsp; <strong>Periodo:</strong> ${report.period}</p>
<table>
<thead><tr><th>Concepto</th><th>Monto</th></tr></thead>
<tbody>
<tr><td>Esperado</td><td>${fmt(report.expectedAmount)}</td></tr>
<tr><td>Cobrado por vendedores</td><td>${fmt(report.collectedAmount)}</td></tr>
<tr><td>Pendiente de cobrar</td><td>${fmt(report.pendingCollect)}</td></tr>
<tr><td>Entregado a tesorería</td><td>${fmt(report.deliveredAmount)}</td></tr>
<tr><td>En poder de vendedores</td><td>${fmt(report.withVendorsAmount)}</td></tr>
<tr><td>Premio del periodo</td><td>${fmt(report.prizeAmount)}</td></tr>
<tr><td>Premio pagado</td><td>${fmt(report.paidPrize)}</td></tr>
<tr><td>Premio pendiente</td><td>${fmt(report.pendingPrize)}</td></tr>
</tbody></table>
</body></html>`;
}
