import React, { useMemo, useState } from 'react';
import { Download, Search, X, ShieldAlert } from 'lucide-react';
import { CleanedLedgerRow } from '../types/finance';

interface DrillDownDrawerProps {
  isOpen: boolean;
  title: string;
  subtitle: string;
  rows: CleanedLedgerRow[];
  onClose: () => void;
}

function formatMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `($${abs})` : `$${abs}`;
}

export const DrillDownDrawer: React.FC<DrillDownDrawerProps> = ({
  isOpen,
  title,
  subtitle,
  rows,
  onClose,
}) => {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.txId.toLowerCase().includes(q) ||
        r.accountName.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q) ||
        r.costCenter.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        if (!r.redacted) {
          acc.amount += r.amount;
          acc.budget += r.budget;
          acc.variance += r.variance;
        } else {
          acc.redactedCount += 1;
        }
        return acc;
      },
      { amount: 0, budget: 0, variance: 0, redactedCount: 0 },
    );
  }, [filtered]);

  if (!isOpen) return null;

  const exportCsv = () => {
    const headers = [
      'TxID',
      'Date',
      'Entity',
      'Region',
      'Department',
      'Category',
      'Account',
      'Segment',
      'Amount',
      'Budget',
      'Variance',
      'Cost Center',
      'Status',
    ];
    const csvLines = [
      headers.join(','),
      ...filtered.map((r) =>
        [
          r.txId,
          r.date,
          `"${r.entity}"`,
          `"${r.region}"`,
          `"${r.department}"`,
          r.accountCategory,
          `"${r.accountName}"`,
          r.customerSegment,
          r.redacted ? '[REDACTED]' : r.amount.toFixed(2),
          r.redacted ? '[REDACTED]' : r.budget.toFixed(2),
          r.redacted ? '[REDACTED]' : r.variance.toFixed(2),
          r.costCenter,
          r.status,
        ].join(','),
      ),
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drilldown_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[1px]">
      <div
        role="dialog"
        aria-label={title}
        className="flex h-full w-full max-w-4xl flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {subtitle} · {filtered.length.toLocaleString()} transactions · Net Actual{' '}
              <span className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200">
                {formatMoney(totals.amount)}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drill-down"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by TxID, account, department, cost center..."
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="flex items-center gap-5 text-xs text-slate-600 dark:text-slate-400">
            <span>
              Actual:{' '}
              <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {formatMoney(totals.amount)}
              </strong>
            </span>
            <span>
              Budget:{' '}
              <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {formatMoney(totals.budget)}
              </strong>
            </span>
            <span>
              Variance:{' '}
              <strong
                className={`font-mono tabular-nums ${
                  totals.variance >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-700 dark:text-rose-400'
                }`}
              >
                {formatMoney(totals.variance)}
              </strong>
            </span>
            {totals.redactedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <ShieldAlert className="h-3.5 w-3.5" />
                {totals.redactedCount} restricted rows masked
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5">TxID</th>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Region / Dept</th>
                <th className="px-3 py-2.5">Account</th>
                <th className="px-3 py-2.5">Cost Center</th>
                <th className="px-3 py-2.5 text-right">Actual</th>
                <th className="px-3 py-2.5 text-right">Budget</th>
                <th className="px-4 py-2.5 text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filtered.slice(0, 250).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/90 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-2 font-mono tabular-nums text-slate-700 dark:text-slate-300">{row.txId}</td>
                  <td className="px-3 py-2 font-mono tabular-nums text-slate-500 dark:text-slate-400">{row.date}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                    {row.region} · {row.department}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{row.accountName}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {row.accountCategory} · {row.status}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {row.costCenter}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {row.redacted ? '[REDACTED]' : formatMoney(row.amount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {row.redacted ? '[REDACTED]' : formatMoney(row.budget)}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono tabular-nums font-medium ${
                      row.redacted
                        ? 'text-slate-400'
                        : row.variance >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {row.redacted ? '[REDACTED]' : formatMoney(row.variance)}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    No matching transactions in this slice.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {filtered.length > 250 && (
            <div className="border-t border-slate-200 px-6 py-3 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Showing first 250 of {filtered.length.toLocaleString()} transactions. Export CSV for the full subset.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
