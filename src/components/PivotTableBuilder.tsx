import React, { useMemo, useState } from 'react';
import { Download, SlidersHorizontal, Table2 } from 'lucide-react';
import { computePivotTable } from '../engine/pivotEngine';
import { CleanedLedgerRow, PivotAggregation, PivotConfig } from '../types/finance';

interface PivotTableBuilderProps {
  cleanedLedger: CleanedLedgerRow[];
  onDrillDown: (title: string, subtitle: string, rows: CleanedLedgerRow[]) => void;
}

const DIMENSIONS: Array<{ key: keyof CleanedLedgerRow; label: string }> = [
  { key: 'region', label: 'Region' },
  { key: 'department', label: 'Department' },
  { key: 'accountCategory', label: 'Account Category' },
  { key: 'customerSegment', label: 'Customer Segment' },
  { key: 'quarter', label: 'Fiscal Quarter' },
  { key: 'month', label: 'Month' },
  { key: 'entity', label: 'Legal Entity' },
  { key: 'status', label: 'Journal Status' },
];

export const PivotTableBuilder: React.FC<PivotTableBuilderProps> = ({
  cleanedLedger,
  onDrillDown,
}) => {
  const [config, setConfig] = useState<PivotConfig>({
    rowField: 'department',
    colField: 'quarter',
    valueField: 'amount',
    aggregation: 'SUM',
    filters: {
      region: 'ALL',
      accountCategory: 'ALL',
      status: 'ALL',
    },
    sortBy: 'total_desc',
  });

  const ledgerById = useMemo(() => {
    const map = new Map<string, CleanedLedgerRow>();
    for (const r of cleanedLedger) map.set(r.id, r);
    return map;
  }, [cleanedLedger]);

  const filterOptions = useMemo(() => {
    const regions = new Set<string>();
    const categories = new Set<string>();
    const statuses = new Set<string>();
    for (const r of cleanedLedger) {
      regions.add(r.region);
      categories.add(r.accountCategory);
      statuses.add(r.status);
    }
    return {
      regions: Array.from(regions).sort(),
      categories: Array.from(categories).sort(),
      statuses: Array.from(statuses).sort(),
    };
  }, [cleanedLedger]);

  const pivot = useMemo(() => computePivotTable(cleanedLedger, config), [cleanedLedger, config]);

  const formatCell = (val: number): string => {
    if (config.aggregation === 'PCT_TOTAL' || config.aggregation === 'PCT_ROW') {
      return `${val.toFixed(1)}%`;
    }
    if (config.aggregation === 'COUNT' || config.valueField === 'units') {
      return Math.round(val).toLocaleString('en-US');
    }
    const abs = Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return val < 0 ? `($${abs})` : `$${abs}`;
  };

  const openDrill = (label: string, ids: string[]) => {
    const rows = ids.map((id) => ledgerById.get(id)).filter((x): x is CleanedLedgerRow => Boolean(x));
    onDrillDown(`Pivot Drill-Down: ${label}`, `${rows.length.toLocaleString()} underlying journal records`, rows);
  };

  const exportPivotCsv = () => {
    const header = [String(config.rowField), ...pivot.colKeys, 'Grand Total'].join(',');
    const lines = [
      header,
      ...pivot.rowKeys.map((rk) =>
        [
          `"${rk}"`,
          ...pivot.colKeys.map((ck) => (pivot.matrix[rk]?.[ck]?.displayValue ?? 0).toFixed(2)),
          (pivot.rowTotals[rk]?.displayValue ?? 0).toFixed(2),
        ].join(','),
      ),
      [
        '"Grand Total"',
        ...pivot.colKeys.map((ck) => (pivot.colTotals[ck]?.displayValue ?? 0).toFixed(2)),
        pivot.grandTotal.displayValue.toFixed(2),
      ].join(','),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pivot_${String(config.rowField)}_by_${String(config.colField)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Interactive Pivot &amp; Drill-Down
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Slice {cleanedLedger.length.toLocaleString()} cleaned transactions dynamically · Click any numeric cell to inspect source entries
          </p>
        </div>

        <button
          type="button"
          onClick={exportPivotCsv}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          Export Pivot CSV
        </button>
      </div>

      {/* Configurator Bar */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-6">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Rows</label>
          <select
            value={String(config.rowField)}
            onChange={(e) => setConfig((c) => ({ ...c, rowField: e.target.value as keyof CleanedLedgerRow }))}
            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {DIMENSIONS.map((d) => (
              <option key={String(d.key)} value={String(d.key)}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Columns</label>
          <select
            value={String(config.colField)}
            onChange={(e) =>
              setConfig((c) => ({ ...c, colField: e.target.value as keyof CleanedLedgerRow | 'NONE' }))
            }
            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="NONE">Single Total Column</option>
            {DIMENSIONS.map((d) => (
              <option key={String(d.key)} value={String(d.key)}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Value Metric</label>
          <select
            value={config.valueField}
            onChange={(e) =>
              setConfig((c) => ({ ...c, valueField: e.target.value as PivotConfig['valueField'] }))
            }
            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="amount">Actual Amount ($)</option>
            <option value="budget">Budget Plan ($)</option>
            <option value="variance">Variance ($)</option>
            <option value="units">Volume / Units</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Aggregation</label>
          <select
            value={config.aggregation}
            onChange={(e) => setConfig((c) => ({ ...c, aggregation: e.target.value as PivotAggregation }))}
            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="SUM">Sum</option>
            <option value="AVERAGE">Average</option>
            <option value="COUNT">Count of Entries</option>
            <option value="MIN">Minimum</option>
            <option value="MAX">Maximum</option>
            <option value="PCT_TOTAL">% of Grand Total</option>
            <option value="PCT_ROW">% of Row Total</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Filter: Category
          </label>
          <select
            value={config.filters.accountCategory ?? 'ALL'}
            onChange={(e) =>
              setConfig((c) => ({ ...c, filters: { ...c.filters, accountCategory: e.target.value } }))
            }
            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="ALL">All Categories</option>
            {filterOptions.categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Filter: Region</label>
          <select
            value={config.filters.region ?? 'ALL'}
            onChange={(e) => setConfig((c) => ({ ...c, filters: { ...c.filters, region: e.target.value } }))}
            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="ALL">All Regions</option>
            {filterOptions.regions.map((reg) => (
              <option key={reg} value={reg}>
                {reg}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Pivot Grid */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
            <Table2 className="h-4 w-4 text-teal-700 dark:text-teal-400" />
            {DIMENSIONS.find((d) => d.key === config.rowField)?.label} ×{' '}
            {config.colField === 'NONE'
              ? 'Total'
              : DIMENSIONS.find((d) => d.key === config.colField)?.label}{' '}
            ({config.aggregation})
          </div>

          <div className="flex items-center gap-2 text-xs">
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={config.sortBy}
              onChange={(e) => setConfig((c) => ({ ...c, sortBy: e.target.value as PivotConfig['sortBy'] }))}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="total_desc">Sort: Total Descending</option>
              <option value="total_asc">Sort: Total Ascending</option>
              <option value="label">Sort: Label A–Z</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5 text-left">
                  {DIMENSIONS.find((d) => d.key === config.rowField)?.label}
                </th>
                {pivot.colKeys.map((ck) => (
                  <th key={ck} className="px-3 py-2.5 text-right whitespace-nowrap">
                    {ck}
                  </th>
                ))}
                <th className="bg-slate-100/80 px-4 py-2.5 text-right font-semibold text-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                  Grand Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pivot.rowKeys.map((rk) => {
                const rowTot = pivot.rowTotals[rk];
                return (
                  <tr key={rk} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {rk}
                    </td>
                    {pivot.colKeys.map((ck) => {
                      const cell = pivot.matrix[rk]?.[ck];
                      const hasRecords = (cell?.count ?? 0) > 0;
                      return (
                        <td
                          key={ck}
                          onClick={() => hasRecords && openDrill(`${rk} · ${ck}`, cell!.recordIds)}
                          title={hasRecords ? `Click to inspect ${cell!.count} records` : undefined}
                          className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                            hasRecords
                              ? 'cursor-pointer text-slate-800 hover:bg-teal-50 hover:text-teal-800 dark:text-slate-200 dark:hover:bg-teal-950/40 dark:hover:text-teal-300'
                              : 'text-slate-300 dark:text-slate-600'
                          } ${
                            (cell?.displayValue ?? 0) < 0 ? 'text-rose-700 dark:text-rose-400' : ''
                          }`}
                        >
                          {hasRecords ? formatCell(cell!.displayValue) : '—'}
                        </td>
                      );
                    })}
                    <td
                      onClick={() => rowTot?.count && openDrill(`${rk} (All)`, rowTot.recordIds)}
                      className="cursor-pointer bg-slate-50/80 px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900 hover:bg-teal-50 dark:bg-slate-800/30 dark:text-slate-100 dark:hover:bg-teal-950/40"
                    >
                      {formatCell(rowTot?.displayValue ?? 0)}
                    </td>
                  </tr>
                );
              })}

              {pivot.rowKeys.length === 0 && (
                <tr>
                  <td colSpan={pivot.colKeys.length + 2} className="px-6 py-10 text-center text-xs text-slate-500">
                    No records match the current pivot filters.
                  </td>
                </tr>
              )}
            </tbody>
            {pivot.rowKeys.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 bg-slate-100/70 font-semibold dark:border-slate-700 dark:bg-slate-950/70">
                <tr>
                  <td className="px-4 py-3 text-slate-900 dark:text-slate-100">Grand Total</td>
                  {pivot.colKeys.map((ck) => {
                    const colTot = pivot.colTotals[ck];
                    return (
                      <td
                        key={ck}
                        onClick={() => colTot?.count && openDrill(`Column: ${ck}`, colTot.recordIds)}
                        className="cursor-pointer px-3 py-3 text-right font-mono tabular-nums text-slate-900 hover:text-teal-700 dark:text-slate-100"
                      >
                        {formatCell(colTot?.displayValue ?? 0)}
                      </td>
                    );
                  })}
                  <td
                    onClick={() =>
                      pivot.grandTotal.count && openDrill('Grand Total Subset', pivot.grandTotal.recordIds)
                    }
                    className="cursor-pointer px-4 py-3 text-right font-mono tabular-nums text-teal-800 dark:text-teal-300"
                  >
                    {formatCell(pivot.grandTotal.displayValue)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
