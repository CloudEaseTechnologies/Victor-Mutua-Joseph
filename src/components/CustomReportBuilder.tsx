import React, { useMemo, useState } from 'react';
import { BarChart3, Download, Plus, Save, Trash2 } from 'lucide-react';
import {
  ChartVisualType,
  CleanedLedgerRow,
  CustomReportWidget,
  SavedCustomReport,
  ScenarioName,
} from '../types/finance';
import { ChartDataPoint, InteractiveFinanceChart } from './Charts';

interface CustomReportBuilderProps {
  reports: SavedCustomReport[];
  cleanedLedger: CleanedLedgerRow[];
  canManageReports: boolean;
  onSaveReport: (report: SavedCustomReport) => Promise<void>;
  onDeleteReport: (id: string) => Promise<void>;
  onExportWorkbook: () => Promise<void>;
  onDrillDown: (title: string, subtitle: string, rows: CleanedLedgerRow[]) => void;
}

function buildChartDataForWidget(
  widget: CustomReportWidget,
  cleanedLedger: CleanedLedgerRow[],
): { points: ChartDataPoint[]; matchingRowsMap: Map<string, CleanedLedgerRow[]> } {
  const groups = new Map<string, CleanedLedgerRow[]>();
  for (const r of cleanedLedger) {
    if (r.redacted) continue;
    const key = String(r[widget.dimension] ?? 'Other');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const scenarioMultiplier =
    widget.scenario === 'Upside' ? 1.12 : widget.scenario === 'Downside' ? 0.9 : 1;

  const sortedKeys = Array.from(groups.keys()).sort();
  const points: ChartDataPoint[] = sortedKeys.map((key) => {
    const rows = groups.get(key)!;
    const rev = rows.filter((r) => r.accountCategory === 'Revenue').reduce((s, r) => s + r.amount, 0);
    const revBud = rows.filter((r) => r.accountCategory === 'Revenue').reduce((s, r) => s + r.budget, 0);
    const opex = rows
      .filter((r) => r.accountCategory === 'OpEx' || r.accountCategory === 'Payroll')
      .reduce((s, r) => s + Math.abs(r.amount), 0);
    const opexBud = rows
      .filter((r) => r.accountCategory === 'OpEx' || r.accountCategory === 'Payroll')
      .reduce((s, r) => s + Math.abs(r.budget), 0);
    const cogs = rows.filter((r) => r.accountCategory === 'COGS').reduce((s, r) => s + Math.abs(r.amount), 0);
    const net = rows.reduce((s, r) => s + r.amount, 0);
    const netBud = rows.reduce((s, r) => s + r.budget, 0);

    let val = 0;
    let bud = 0;

    switch (widget.metric) {
      case 'revenue':
        val = rev * scenarioMultiplier;
        bud = revBud;
        break;
      case 'opex':
        val = opex * (widget.scenario === 'Upside' ? 1.03 : widget.scenario === 'Downside' ? 0.95 : 1);
        bud = opexBud;
        break;
      case 'ebitda':
        val = (rev - cogs - opex) * scenarioMultiplier;
        bud = revBud - cogs - opexBud;
        break;
      case 'variance':
        val = rows.reduce((s, r) => s + r.variance, 0);
        bud = 0;
        break;
      case 'netIncome':
      case 'budgetVsActual':
      default:
        val = net * scenarioMultiplier;
        bud = netBud;
        break;
    }

    return {
      label: key,
      value: Math.round(val),
      budget: widget.showBudgetOverlay ? Math.round(bud) : undefined,
      drillKey: key,
    };
  });

  return { points, matchingRowsMap: groups };
}

export const CustomReportBuilder: React.FC<CustomReportBuilderProps> = ({
  reports,
  cleanedLedger,
  canManageReports,
  onSaveReport,
  onDeleteReport,
  onExportWorkbook,
  onDrillDown,
}) => {
  const [selectedReportId, setSelectedReportId] = useState<string>(reports[0]?.id ?? '');
  const [draftReport, setDraftReport] = useState<SavedCustomReport | null>(reports[0] ?? null);
  const [isSaving, setIsSaving] = useState(false);

  const activeReport = useMemo(() => {
    if (draftReport) return draftReport;
    return reports.find((r) => r.id === selectedReportId) ?? reports[0] ?? null;
  }, [draftReport, reports, selectedReportId]);

  const selectReport = (rep: SavedCustomReport) => {
    setSelectedReportId(rep.id);
    setDraftReport(JSON.parse(JSON.stringify(rep)));
  };

  const createNewReport = () => {
    const fresh: SavedCustomReport = {
      id: `rep-${Date.now()}`,
      name: 'Custom Stakeholder Trend Report',
      description: 'Interactive multi-dimensional visualization built from cleaned ERP ledger.',
      ownerRole: 'Analyst',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      widgets: [
        {
          id: `w-${Date.now()}`,
          title: 'Revenue by Customer Segment',
          subtitle: 'Actual vs budget plan across customer tiers',
          chartType: 'bar',
          dimension: 'customerSegment',
          metric: 'revenue',
          showBudgetOverlay: true,
          scenario: 'Base',
        },
      ],
    };
    setSelectedReportId(fresh.id);
    setDraftReport(fresh);
  };

  const addWidget = () => {
    if (!activeReport) return;
    const newW: CustomReportWidget = {
      id: `w-${Date.now()}`,
      title: 'Quarterly Variance Trend',
      subtitle: 'Net budget variance across quarters',
      chartType: 'line',
      dimension: 'quarter',
      metric: 'variance',
      showBudgetOverlay: false,
      scenario: 'Base',
    };
    setDraftReport({
      ...activeReport,
      widgets: [...activeReport.widgets, newW],
    });
  };

  const updateWidget = (wId: string, patch: Partial<CustomReportWidget>) => {
    if (!activeReport) return;
    setDraftReport({
      ...activeReport,
      widgets: activeReport.widgets.map((w) => (w.id === wId ? { ...w, ...patch } : w)),
    });
  };

  const removeWidget = (wId: string) => {
    if (!activeReport) return;
    setDraftReport({
      ...activeReport,
      widgets: activeReport.widgets.filter((w) => w.id !== wId),
    });
  };

  const handleSave = async () => {
    if (!activeReport || !canManageReports) return;
    setIsSaving(true);
    try {
      await onSaveReport(activeReport);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Custom Reports &amp; Trend Builder
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Compose tailored stakeholder trend visualizations, configure scenarios, and export automated Excel packages
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageReports && (
            <>
              <button
                type="button"
                onClick={createNewReport}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                New Report
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !activeReport}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 whitespace-nowrap shrink-0"
              >
                <Save className="h-3.5 w-3.5" />
                {isSaving ? 'Saving...' : 'Save Report'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onExportWorkbook}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 dark:bg-teal-600 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Export Excel Package
          </button>
        </div>
      </div>

      {/* Saved Reports Selector Strip */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-2 lg:col-span-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Saved Reports ({reports.length})
          </div>
          <div className="space-y-2">
            {reports.map((rep) => {
              const selected = activeReport?.id === rep.id;
              return (
                <div
                  key={rep.id}
                  onClick={() => selectReport(rep)}
                  className={`cursor-pointer rounded-lg border p-3.5 transition-colors ${
                    selected
                      ? 'border-teal-700 bg-teal-50/40 dark:border-teal-500 dark:bg-teal-950/30'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{rep.name}</div>
                    {canManageReports && reports.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteReport(rep.id);
                        }}
                        aria-label="Delete report"
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {rep.description}
                  </p>
                  <div className="mt-2 text-[10px] text-slate-400">
                    {rep.widgets.length} charts · Owner: {rep.ownerRole}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Active Report Composer */}
        <div className="space-y-4 lg:col-span-9">
          {activeReport ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex-1 min-w-[240px] space-y-1">
                  <input
                    type="text"
                    value={activeReport.name}
                    disabled={!canManageReports}
                    onChange={(e) => setDraftReport({ ...activeReport, name: e.target.value })}
                    className="w-full bg-transparent font-display text-lg font-semibold text-slate-900 focus:outline-none dark:text-slate-100"
                  />
                  <input
                    type="text"
                    value={activeReport.description}
                    disabled={!canManageReports}
                    onChange={(e) => setDraftReport({ ...activeReport, description: e.target.value })}
                    className="w-full bg-transparent text-xs text-slate-500 focus:outline-none dark:text-slate-400"
                  />
                </div>
                {canManageReports && (
                  <button
                    type="button"
                    onClick={addWidget}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Chart Widget
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4">
                {activeReport.widgets.map((widget) => {
                  const { points, matchingRowsMap } = buildChartDataForWidget(widget, cleanedLedger);
                  return (
                    <div
                      key={widget.id}
                      className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-3 dark:border-slate-800">
                        <div className="min-w-[200px] flex-1">
                          <input
                            type="text"
                            value={widget.title}
                            disabled={!canManageReports}
                            onChange={(e) => updateWidget(widget.id, { title: e.target.value })}
                            className="w-full bg-transparent font-display text-sm font-semibold text-slate-900 focus:outline-none dark:text-slate-100"
                          />
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {widget.subtitle} · Click any data point to drill down
                          </div>
                        </div>

                        {/* Inline Widget Controls */}
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <select
                            value={widget.chartType}
                            disabled={!canManageReports}
                            onChange={(e) =>
                              updateWidget(widget.id, { chartType: e.target.value as ChartVisualType })
                            }
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                          >
                            <option value="area">Area Trend</option>
                            <option value="bar">Comparison Bar</option>
                            <option value="line">Line Series</option>
                            <option value="waterfall">Waterfall</option>
                          </select>

                          <select
                            value={widget.dimension}
                            disabled={!canManageReports}
                            onChange={(e) =>
                              updateWidget(widget.id, {
                                dimension: e.target.value as CustomReportWidget['dimension'],
                              })
                            }
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                          >
                            <option value="month">By Month</option>
                            <option value="quarter">By Quarter</option>
                            <option value="region">By Region</option>
                            <option value="department">By Department</option>
                            <option value="customerSegment">By Segment</option>
                            <option value="accountCategory">By Category</option>
                          </select>

                          <select
                            value={widget.metric}
                            disabled={!canManageReports}
                            onChange={(e) =>
                              updateWidget(widget.id, {
                                metric: e.target.value as CustomReportWidget['metric'],
                              })
                            }
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                          >
                            <option value="revenue">Revenue</option>
                            <option value="ebitda">EBITDA</option>
                            <option value="opex">OpEx Spend</option>
                            <option value="variance">Budget Variance</option>
                            <option value="netIncome">Net Cash Impact</option>
                          </select>

                          <select
                            value={widget.scenario}
                            disabled={!canManageReports}
                            onChange={(e) =>
                              updateWidget(widget.id, { scenario: e.target.value as ScenarioName })
                            }
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                          >
                            <option value="Base">Base</option>
                            <option value="Upside">Upside</option>
                            <option value="Downside">Downside</option>
                          </select>

                          <label className="inline-flex items-center gap-1.5 px-1 text-[11px] text-slate-600 dark:text-slate-400">
                            <input
                              type="checkbox"
                              checked={widget.showBudgetOverlay}
                              disabled={!canManageReports}
                              onChange={(e) =>
                                updateWidget(widget.id, { showBudgetOverlay: e.target.checked })
                              }
                              className="rounded border-slate-300 text-teal-700"
                            />
                            Plan
                          </label>

                          {canManageReports && activeReport.widgets.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeWidget(widget.id)}
                              aria-label="Remove widget"
                              className="p-1 text-slate-400 hover:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <InteractiveFinanceChart
                        data={points}
                        chartType={widget.chartType}
                        showBudgetOverlay={widget.showBudgetOverlay}
                        onPointClick={(pt) => {
                          const rows = matchingRowsMap.get(pt.drillKey ?? pt.label) ?? [];
                          onDrillDown(
                            `${widget.title}: ${pt.label}`,
                            `${rows.length} transactions matching ${widget.dimension} = "${pt.label}"`,
                            rows,
                          );
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
              <BarChart3 className="h-8 w-8 text-slate-400" />
              <div className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                No Custom Report Selected
              </div>
              <p className="mt-1 text-xs text-slate-500">Create a new report to build custom financial trend charts.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
