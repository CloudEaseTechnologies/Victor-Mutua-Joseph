import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronRight, Lock, Unlock } from 'lucide-react';
import {
  CleanedLedgerRow,
  CloseTask,
  EvaluatedCell,
  FiscalPeriodState,
  ScenarioName,
} from '../types/finance';
import { ChartDataPoint, InteractiveFinanceChart } from './Charts';

interface ExecutiveDashboardProps {
  evaluatedModel: Record<string, Record<string, EvaluatedCell>>;
  cleanedLedger: CleanedLedgerRow[];
  closeTasks: CloseTask[];
  fiscalPeriod: FiscalPeriodState;
  scenario: ScenarioName;
  onScenarioChange: (s: ScenarioName) => void;
  onDrillDown: (title: string, subtitle: string, rows: CleanedLedgerRow[]) => void;
  onNavigateTab: (tab: 'dashboard' | 'model' | 'power-query' | 'pivot' | 'reports' | 'close') => void;
}

function fmtMoneyCompact(val: number): string {
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtMoneyFull(val: number): string {
  const abs = Math.abs(val).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return val < 0 ? `($${abs})` : `$${abs}`;
}

interface KpiSparklineProps {
  values: number[];
  positive?: boolean;
  label: string;
}

const KpiSparkline: React.FC<KpiSparklineProps> = ({ values, positive = true, label }) => {
  if (!values || values.length < 2) return null;

  const width = 132;
  const height = 34;
  const padX = 3;
  const padY = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1e-6, max - min);

  const coords = values.map((v, idx) => {
    const x = padX + (idx / Math.max(1, values.length - 1)) * (width - padX * 2);
    const y = padY + ((max - v) / range) * (height - padY * 2);
    return { x, y };
  });

  const linePath = coords
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(height - 1).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(height - 1).toFixed(1)} Z`;

  const last = coords[coords.length - 1];
  const strokeClass = positive
    ? 'text-teal-700 dark:text-teal-400'
    : 'text-amber-600 dark:text-amber-400';
  const fillClass = positive
    ? 'fill-teal-600/12 dark:fill-teal-400/12'
    : 'fill-amber-500/12 dark:fill-amber-400/12';

  // Compute coefficient of variation / relative volatility across the period
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const cvPct = Math.abs(mean) > 1e-6 ? Math.min(99.9, (stdDev / Math.abs(mean)) * 100) : 0;

  return (
    <div className="mt-3 flex items-end justify-between gap-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-8 w-[132px] shrink-0 overflow-visible"
        role="img"
        aria-label={`${label} fiscal period sparkline`}
      >
        <line
          x1={padX}
          x2={width - padX}
          y1={height / 2}
          y2={height / 2}
          stroke="currentColor"
          strokeDasharray="2 2"
          className="text-slate-200 dark:text-slate-800"
          strokeWidth={1}
        />
        <path d={areaPath} className={fillClass} />
        <path
          d={linePath}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={strokeClass}
        />
        <circle
          cx={last.x}
          cy={last.y}
          r={2.5}
          className={positive ? 'fill-teal-700 dark:fill-teal-400' : 'fill-amber-600 dark:fill-amber-400'}
        />
      </svg>
      <span className="font-mono text-[10px] tabular-nums text-slate-400 dark:text-slate-500 whitespace-nowrap">
        Vol {cvPct.toFixed(1)}%
      </span>
    </div>
  );
};

export const ExecutiveDashboard: React.FC<ExecutiveDashboardProps> = ({
  evaluatedModel,
  cleanedLedger,
  closeTasks,
  fiscalPeriod,
  scenario,
  onScenarioChange,
  onDrillDown,
  onNavigateTab,
}) => {
  const pl = evaluatedModel['pl-statement'] || {};
  const cf = evaluatedModel['cash-flow'] || {};
  const dcf = evaluatedModel['dcf-valuation'] || {};

  const fyRevenue = Number(pl.N2?.value ?? 0);
  const fyGrossProfit = Number(pl.N4?.value ?? 0);
  const fyEbitda = Number(pl.N7?.value ?? 0);
  const fyEbitdaMargin = Number(pl.N8?.value ?? 0);
  const fyNetIncome = Number(pl.N12?.value ?? 0);
  const endingCash = Number(cf.N7?.value ?? 0);
  const impliedEv = Number(dcf.B10?.value ?? 0);

  // Monthly revenue & budget from cleaned GL + model
  const monthlySeries: ChartDataPoint[] = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const cols = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    return months.map((m, idx) => {
      const col = cols[idx];
      const modelRev = Number(pl[`${col}2`]?.value ?? 0);
      const monthStr = `2026-${String(idx + 1).padStart(2, '0')}`;
      const ledgerRev = cleanedLedger
        .filter((r) => !r.redacted && r.month === monthStr && r.accountCategory === 'Revenue')
        .reduce((s, r) => s + r.amount, 0);
      const budgetRev = cleanedLedger
        .filter((r) => !r.redacted && r.month === monthStr && r.accountCategory === 'Revenue')
        .reduce((s, r) => s + r.budget, 0);
      return {
        label: m,
        value: modelRev,
        budget: budgetRev > 0 ? Math.round(modelRev * (budgetRev / Math.max(1, ledgerRev))) : Math.round(modelRev * 0.96),
        drillKey: monthStr,
      };
    });
  }, [pl, cleanedLedger]);

  // P&L Waterfall Bridge
  const waterfallData: ChartDataPoint[] = useMemo(() => {
    const rev = Number(pl.N2?.value ?? 0);
    const cogs = Number(pl.N3?.value ?? 0);
    const gp = Number(pl.N4?.value ?? 0);
    const opex = Number(pl.N6?.value ?? 0);
    const ebitda = Number(pl.N7?.value ?? 0);
    const da = Number(pl.N9?.value ?? 0);
    const tax = Number(pl.N11?.value ?? 0);
    const net = Number(pl.N12?.value ?? 0);

    return [
      { label: 'Revenue', value: rev, isSubtotal: true, drillKey: 'Revenue' },
      { label: 'COGS', value: -cogs, drillKey: 'COGS' },
      { label: 'Gross Profit', value: gp, isSubtotal: true },
      { label: 'OpEx', value: -opex, drillKey: 'OpEx' },
      { label: 'EBITDA', value: ebitda, isSubtotal: true },
      { label: 'D&A + Tax', value: -(da + tax) },
      { label: 'Net Income', value: net, isSubtotal: true },
    ];
  }, [pl]);

  // Regional summary from Cleaned Ledger
  const regionalStats = useMemo(() => {
    const map = new Map<string, { revenue: number; spend: number; budget: number; count: number; rows: CleanedLedgerRow[] }>();
    for (const r of cleanedLedger) {
      if (r.redacted) continue;
      if (!map.has(r.region)) {
        map.set(r.region, { revenue: 0, spend: 0, budget: 0, count: 0, rows: [] });
      }
      const entry = map.get(r.region)!;
      if (r.accountCategory === 'Revenue') entry.revenue += r.amount;
      else entry.spend += Math.abs(r.amount);
      entry.budget += r.budget;
      entry.count += 1;
      entry.rows.push(r);
    }
    return Array.from(map.entries())
      .map(([region, stats]) => ({
        region,
        ...stats,
        netContribution: stats.revenue - stats.spend,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [cleanedLedger]);

  const [heatmapDim, setHeatmapDim] = useState<'department' | 'region'>('department');
  const [heatmapBaseline, setHeatmapBaseline] = useState<'budget' | 'forecast'>('budget');

  const closeProgress = useMemo(() => {
    const done = closeTasks.filter((t) => t.status === 'Signed Off' || t.status === 'Reconciled').length;
    return { done, total: closeTasks.length, pct: Math.round((done / Math.max(1, closeTasks.length)) * 100) };
  }, [closeTasks]);

  const heatmapData = useMemo(() => {
    const quarters = ['2026 Q1', '2026 Q2', '2026 Q3', '2026 Q4'];
    const rowSet = new Set<string>();
    const cellMap = new Map<
      string,
      {
        actual: number;
        budget: number;
        forecast: number;
        rows: CleanedLedgerRow[];
      }
    >();

    for (const r of cleanedLedger) {
      if (r.redacted) continue;
      const rowKey = heatmapDim === 'department' ? r.department : r.region;
      rowSet.add(rowKey);

      const forecastMult =
        r.accountCategory === 'Revenue'
          ? scenario === 'Upside'
            ? 1.08
            : scenario === 'Downside'
              ? 0.92
              : 1.02
          : scenario === 'Upside'
            ? 1.03
            : scenario === 'Downside'
              ? 0.96
              : 1.01;
      const forecastVal = r.budget * forecastMult;

      for (const qKey of [r.quarter, 'FY Total']) {
        const key = `${rowKey}::${qKey}`;
        if (!cellMap.has(key)) {
          cellMap.set(key, { actual: 0, budget: 0, forecast: 0, rows: [] });
        }
        const entry = cellMap.get(key)!;
        entry.actual += r.amount;
        entry.budget += r.budget;
        entry.forecast += forecastVal;
        entry.rows.push(r);
      }
    }

    const rowKeys = Array.from(rowSet).sort();
    let riskCellCount = 0;
    let watchCellCount = 0;

    const matrix = rowKeys.map((rk) => {
      const cells = [...quarters, 'FY Total'].map((qk) => {
        const entry = cellMap.get(`${rk}::${qk}`);
        if (!entry || entry.rows.length === 0) {
          return {
            quarter: qk,
            actual: 0,
            baseline: 0,
            variance: 0,
            variancePct: 0,
            tier: 'empty' as const,
            rows: [] as CleanedLedgerRow[],
          };
        }
        const baseline = heatmapBaseline === 'budget' ? entry.budget : entry.forecast;
        const variance = entry.actual - baseline;
        const denom = Math.max(1, Math.abs(baseline));
        const variancePct = (variance / denom) * 100;

        let tier: 'favorable' | 'nominal' | 'watch' | 'risk' = 'nominal';
        if (variancePct >= 2.0) tier = 'favorable';
        else if (variancePct <= -4.5) tier = 'risk';
        else if (variancePct < -1.5) tier = 'watch';

        if (qk !== 'FY Total') {
          if (tier === 'risk') riskCellCount++;
          else if (tier === 'watch') watchCellCount++;
        }

        return {
          quarter: qk,
          actual: entry.actual,
          baseline,
          variance,
          variancePct,
          tier,
          rows: entry.rows,
        };
      });
      return { rowKey: rk, cells };
    });

    return { quarters, matrix, riskCellCount, watchCellCount };
  }, [cleanedLedger, heatmapDim, heatmapBaseline, scenario]);

  // Sparkline series across the 12-month fiscal period
  const sparklineSeries = useMemo(() => {
    const cols = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    const revenue = cols.map((col) => Number(pl[`${col}2`]?.value ?? 0));
    const ebitda = cols.map((col) => Number(pl[`${col}7`]?.value ?? 0));
    const cash = cols.map((col) => Number(cf[`${col}7`]?.value ?? 0));
    const monthlyVarianceVol = cols.slice(0, 11).map((_, idx) => {
      const monthStr = `2026-${String(idx + 1).padStart(2, '0')}`;
      return cleanedLedger
        .filter((r) => !r.redacted && r.month === monthStr)
        .reduce((sum, r) => sum + Math.abs(r.variance), 0);
    });
    return { revenue, ebitda, cash, monthlyVarianceVol };
  }, [pl, cf, cleanedLedger]);

  const calcPeriodDelta = (series: number[], invertPositive = false) => {
    if (series.length < 2) return { pct: 0, text: '+0.0%', favorable: true };
    const curr = series[series.length - 1];
    const prev = series[series.length - 2];
    const pct = ((curr - prev) / Math.max(1, Math.abs(prev))) * 100;
    const sign = pct >= 0 ? '+' : '';
    const favorable = invertPositive ? pct <= 0 : pct >= 0;
    return {
      pct,
      text: `${sign}${pct.toFixed(1)}%`,
      favorable,
    };
  };

  const revPeriodDelta = calcPeriodDelta(sparklineSeries.revenue);
  const ebitdaPeriodDelta = calcPeriodDelta(sparklineSeries.ebitda);
  const cashPeriodDelta = calcPeriodDelta(sparklineSeries.cash);
  const closePeriodDelta = calcPeriodDelta(sparklineSeries.monthlyVarianceVol, true);

  const kpis = [
    {
      label: 'FY26 Projected Revenue',
      value: fmtMoneyCompact(fyRevenue),
      sub: `${scenario} Scenario · Gross Margin ${((fyGrossProfit / Math.max(1, fyRevenue)) * 100).toFixed(1)}%`,
      contextTag: 'MoM Run-Rate',
      periodDelta: revPeriodDelta,
      series: sparklineSeries.revenue,
      onClick: () =>
        onDrillDown(
          'Consolidated Revenue Transactions',
          'All recognized revenue journal entries from Power Query cleaned ledger',
          cleanedLedger.filter((r) => r.accountCategory === 'Revenue'),
        ),
    },
    {
      label: 'Consolidated EBITDA',
      value: fmtMoneyCompact(fyEbitda),
      sub: `Margin ${(fyEbitdaMargin * 100).toFixed(1)}% · Net Income ${fmtMoneyCompact(fyNetIncome)}`,
      contextTag: 'MoM Operating',
      periodDelta: ebitdaPeriodDelta,
      series: sparklineSeries.ebitda,
      onClick: () =>
        onDrillDown(
          'Operating Expense & COGS Ledger',
          'Underlying cost drivers contributing to EBITDA',
          cleanedLedger.filter((r) => r.accountCategory === 'COGS' || r.accountCategory === 'OpEx'),
        ),
    },
    {
      label: 'Ending Cash Liquidity',
      value: fmtMoneyCompact(endingCash),
      sub: `DCF Implied EV ${fmtMoneyCompact(impliedEv)}`,
      contextTag: 'MoM Liquidity',
      periodDelta: cashPeriodDelta,
      series: sparklineSeries.cash,
      onClick: () => onNavigateTab('model'),
    },
    {
      label: 'Monthly Close Readiness',
      value: `${closeProgress.done} / ${closeProgress.total}`,
      sub: `${fiscalPeriod.periodLabel} · ${closeProgress.pct}% reconciled`,
      contextTag: fiscalPeriod.isLocked ? 'Period Locked' : 'Var vs Prior Mo',
      periodDelta: closePeriodDelta,
      series: sparklineSeries.monthlyVarianceVol,
      onClick: () => onNavigateTab('close'),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
            Executive Financial Intelligence
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {fiscalPeriod.periodLabel} · {cleanedLedger.length.toLocaleString()} cleaned journal entries · Live formula synchronization
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            {(['Base', 'Upside', 'Downside'] as ScenarioName[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onScenarioChange(s)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  scenario === s
                    ? 'bg-slate-900 text-white dark:bg-teal-600 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('close')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {fiscalPeriod.isLocked ? <Lock className="h-3.5 w-3.5 text-emerald-700" /> : <Unlock className="h-3.5 w-3.5 text-amber-600" />}
            {fiscalPeriod.isLocked ? 'Period Locked' : 'Close Workflow'}
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <button
            key={kpi.label}
            type="button"
            onClick={kpi.onClick}
            className="group flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 text-left transition-colors hover:border-teal-600/50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500/50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{kpi.label}</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                {kpi.contextTag}
              </span>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                {kpi.value}
              </span>
              <span
                className={`inline-flex items-center gap-0.5 font-mono text-xs font-semibold tabular-nums whitespace-nowrap ${
                  kpi.periodDelta.favorable
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-700 dark:text-rose-400'
                }`}
              >
                {kpi.periodDelta.pct >= 0 ? (
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 shrink-0" />
                )}
                {kpi.periodDelta.text}
              </span>
            </div>
            <KpiSparkline values={kpi.series} positive={kpi.periodDelta.favorable} label={kpi.label} />
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span className="truncate">{kpi.sub}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </button>
        ))}
      </div>

      {/* Primary Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-7">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Monthly Revenue Run-Rate vs Plan
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Click any month point to drill down into underlying GL transactions
              </p>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-3 bg-teal-700 dark:bg-teal-400" />
                Model ({scenario})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3 border-t-2 border-dashed border-slate-400" />
                Plan Baseline
              </span>
            </div>
          </div>

          <InteractiveFinanceChart
            data={monthlySeries}
            chartType="area"
            showBudgetOverlay
            onPointClick={(pt) => {
              const rows = cleanedLedger.filter((r) => r.month === pt.drillKey);
              onDrillDown(
                `${pt.label} 2026 Ledger Drill-Down`,
                `Filtered from cleaned ERP dataset (${rows.length} entries)`,
                rows,
              );
            }}
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                FY26 Revenue-to-Net Income Bridge
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Multi-step P&amp;L margin waterfall · Click cost bars to inspect
              </p>
            </div>
          </div>

          <InteractiveFinanceChart
            data={waterfallData}
            chartType="waterfall"
            showBudgetOverlay={false}
            onPointClick={(pt) => {
              if (!pt.drillKey) return;
              const rows = cleanedLedger.filter((r) => r.accountCategory === pt.drillKey);
              onDrillDown(
                `${pt.label} Ledger Breakdown`,
                `All ${pt.drillKey} entries driving the P&L bridge`,
                rows,
              );
            }}
          />
        </div>
      </div>

      {/* Variance Heatmap Matrix (Actual vs Budget / Forecast) */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Performance Variance &amp; Risk Heatmap
              </h2>
              {heatmapData.riskCellCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 dark:text-rose-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {heatmapData.riskCellCount} high-risk {heatmapData.riskCellCount === 1 ? 'cell' : 'cells'} · {heatmapData.watchCellCount} watch
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Compares actual GL performance against {heatmapBaseline === 'budget' ? 'Budget Plan' : `${scenario} Forecast`} · Click any cell to inspect transactions
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setHeatmapDim('department')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  heatmapDim === 'department'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                By Department
              </button>
              <button
                type="button"
                onClick={() => setHeatmapDim('region')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  heatmapDim === 'region'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                By Region
              </button>
            </div>

            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setHeatmapBaseline('budget')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  heatmapBaseline === 'budget'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                vs Budget
              </button>
              <button
                type="button"
                onClick={() => setHeatmapBaseline('forecast')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  heatmapBaseline === 'forecast'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                vs Forecast ({scenario})
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto p-4">
          <table className="w-full border-separate border-spacing-1.5 text-xs">
            <thead>
              <tr className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <th className="px-2 py-1.5 text-left">
                  {heatmapDim === 'department' ? 'Department' : 'Operating Region'}
                </th>
                {heatmapData.quarters.map((q) => (
                  <th key={q} className="px-2 py-1.5 text-center whitespace-nowrap">
                    {q}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-center font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                  FY Total
                </th>
              </tr>
            </thead>
            <tbody>
              {heatmapData.matrix.map((row) => (
                <tr key={row.rowKey}>
                  <td className="px-2 py-2 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {row.rowKey}
                  </td>
                  {row.cells.map((cell) => {
                    if (cell.tier === 'empty') {
                      return (
                        <td
                          key={cell.quarter}
                          className="rounded-md border border-slate-100 bg-slate-50/40 px-3 py-2 text-center font-mono text-[11px] text-slate-400 dark:border-slate-800/60 dark:bg-slate-950/30"
                        >
                          —
                        </td>
                      );
                    }

                    const toneClass =
                      cell.tier === 'favorable'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-400 dark:border-emerald-900/70 dark:bg-emerald-950/50 dark:text-emerald-100'
                        : cell.tier === 'risk'
                          ? 'border-rose-200 bg-rose-50 text-rose-950 hover:border-rose-400 dark:border-rose-900/70 dark:bg-rose-950/55 dark:text-rose-100'
                          : cell.tier === 'watch'
                            ? 'border-amber-200 bg-amber-50 text-amber-950 hover:border-amber-400 dark:border-amber-900/70 dark:bg-amber-950/50 dark:text-amber-100'
                            : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-100';

                    const tierLabel =
                      cell.tier === 'favorable'
                        ? 'Favorable'
                        : cell.tier === 'risk'
                          ? 'At Risk'
                          : cell.tier === 'watch'
                            ? 'Watch'
                            : 'On Track';

                    const sign = cell.variancePct > 0 ? '+' : '';

                    return (
                      <td key={cell.quarter} className="p-0">
                        <button
                          type="button"
                          onClick={() =>
                            onDrillDown(
                              `Variance Drill-Down: ${row.rowKey} · ${cell.quarter}`,
                              `Actual ${fmtMoneyFull(cell.actual)} vs ${heatmapBaseline === 'budget' ? 'Budget' : 'Forecast'} ${fmtMoneyFull(cell.baseline)} (${cell.rows.length} entries)`,
                              cell.rows,
                            )
                          }
                          title={`Actual: ${fmtMoneyFull(cell.actual)} | ${heatmapBaseline === 'budget' ? 'Budget' : 'Forecast'}: ${fmtMoneyFull(cell.baseline)}`}
                          className={`flex w-full flex-col items-center justify-center rounded-md border px-2.5 py-2 transition-colors ${toneClass} ${
                            cell.quarter === 'FY Total' ? 'font-semibold' : ''
                          }`}
                        >
                          <div className="font-mono text-xs font-semibold tabular-nums">
                            {sign}
                            {cell.variancePct.toFixed(1)}%
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] opacity-80">
                            <span className="font-mono tabular-nums">{fmtMoneyCompact(cell.variance)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{tierLabel}</span>
                          </div>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-2 pt-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-xs border border-emerald-300 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900" />
                Favorable (≥ +2.0%)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-xs border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800" />
                On Track (-1.5% to +2.0%)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-xs border border-amber-300 bg-amber-100 dark:border-amber-700 dark:bg-amber-900" />
                Watch (-4.5% to -1.5%)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-xs border border-rose-300 bg-rose-100 dark:border-rose-700 dark:bg-rose-900" />
                At Risk (&lt; -4.5%)
              </span>
            </div>
            <span>Positive variance indicates favorable revenue beat or cost savings</span>
          </div>
        </div>
      </div>

      {/* Regional Performance & Close Readiness Split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Regional Contribution &amp; Ledger Density
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Aggregated from Power Query cleaned dataset · Click a row to inspect records
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('pivot')}
              className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400 whitespace-nowrap shrink-0"
            >
              Open Pivot Builder
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-2.5">Region</th>
                  <th className="px-3 py-2.5 text-right">Journal Rows</th>
                  <th className="px-3 py-2.5 text-right">Recognized Revenue</th>
                  <th className="px-3 py-2.5 text-right">Direct &amp; OpEx Spend</th>
                  <th className="px-5 py-2.5 text-right">Net Contribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {regionalStats.map((reg) => (
                  <tr
                    key={reg.region}
                    onClick={() =>
                      onDrillDown(
                        `${reg.region} Operating Ledger`,
                        `${reg.count} cleaned transactions across ${reg.region}`,
                        reg.rows,
                      )
                    }
                    className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-5 py-3 font-medium text-slate-900 dark:text-slate-100">{reg.region}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {reg.count.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {fmtMoneyFull(reg.revenue)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {fmtMoneyFull(reg.spend)}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-mono tabular-nums font-semibold ${
                        reg.netContribution >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {fmtMoneyFull(reg.netContribution)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Monthly Close Checkpoints
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Critical reconciliations ahead of period lock
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('close')}
              className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400 whitespace-nowrap shrink-0"
            >
              Manage Close
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {closeTasks.slice(0, 5).map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">{task.title}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {task.owner} · {task.dueDay}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={`text-[11px] font-medium ${
                      task.status === 'Signed Off'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : task.status === 'Reconciled'
                          ? 'text-teal-700 dark:text-teal-400'
                          : task.status === 'In Progress'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {task.status}
                  </div>
                  {task.varianceAmount !== 0 && (
                    <div className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      Var {fmtMoneyFull(task.varianceAmount)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
