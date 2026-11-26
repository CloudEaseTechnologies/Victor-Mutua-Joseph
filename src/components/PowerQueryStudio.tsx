import React, { useMemo, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import {
  Check,
  Code2,
  Copy,
  Database,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { parseCsvToRawRows } from '../engine/powerQueryEngine';
import {
  CleanedLedgerRow,
  PowerQueryStep,
  PowerQueryStepMetrics,
  RawLedgerRow,
} from '../types/finance';

interface PowerQueryStudioProps {
  pqSteps: PowerQueryStep[];
  pqMetrics: PowerQueryStepMetrics[];
  pqMCode: string;
  pqStats: {
    rawCount: number;
    cleanedCount: number;
    totalAnomaliesFixed: number;
    duplicatesRemoved: number;
  };
  rawSample: RawLedgerRow[];
  cleanedLedger: CleanedLedgerRow[];
  canRun: boolean;
  onRunPipeline: (steps: PowerQueryStep[], uploadedRawRows?: RawLedgerRow[]) => Promise<void>;
  onResetDataset: () => Promise<void>;
}

export const PowerQueryStudio: React.FC<PowerQueryStudioProps> = ({
  pqSteps,
  pqMetrics,
  pqMCode,
  pqStats,
  rawSample,
  cleanedLedger,
  canRun,
  onRunPipeline,
  onResetDataset,
}) => {
  const [localSteps, setLocalSteps] = useState<PowerQueryStep[]>(pqSteps);
  const [viewMode, setViewMode] = useState<'cleaned' | 'diff' | 'mcode'>('cleaned');
  const [isRunning, setIsRunning] = useState(false);
  const [copiedM, setCopiedM] = useState(false);
  const [newStepType, setNewStepType] = useState<'replace_value' | 'filter_status'>('replace_value');
  const [findVal, setFindVal] = useState('LATAM');
  const [replaceVal, setReplaceVal] = useState('Latin America');
  const [filterStatus, setFilterStatus] = useState('Posted');
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setLocalSteps(pqSteps);
  }, [pqSteps]);

  const metricsMap = useMemo(() => {
    const m = new Map<string, PowerQueryStepMetrics>();
    for (const item of pqMetrics) m.set(item.stepId, item);
    return m;
  }, [pqMetrics]);

  const rawById = useMemo(() => {
    const m = new Map<string, RawLedgerRow>();
    for (const r of rawSample) m.set(r.id, r);
    return m;
  }, [rawSample]);

  const applySteps = async (nextSteps: PowerQueryStep[], uploaded?: RawLedgerRow[]) => {
    if (!canRun) return;
    setIsRunning(true);
    try {
      await onRunPipeline(nextSteps, uploaded);
    } finally {
      setIsRunning(false);
    }
  };

  const toggleStep = (id: string) => {
    const next = localSteps.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
    setLocalSteps(next);
    applySteps(next);
  };

  const removeCustomStep = (id: string) => {
    const next = localSteps.filter((s) => s.id !== id);
    setLocalSteps(next);
    applySteps(next);
  };

  const addCustomStep = () => {
    const id = `pq-custom-${Date.now()}`;
    const step: PowerQueryStep =
      newStepType === 'replace_value'
        ? {
            id,
            type: 'replace_value',
            label: `Replace Region "${findVal}" → "${replaceVal}"`,
            enabled: true,
            config: { field: 'region', findValue: findVal, replaceWith: replaceVal },
          }
        : {
            id,
            type: 'filter_status',
            label: `Filter Status = "${filterStatus}"`,
            enabled: true,
            config: { filterValue: filterStatus },
          };
    const next = [...localSteps, step];
    setLocalSteps(next);
    applySteps(next);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsRunning(true);
    try {
      if (file.name.toLowerCase().endsWith('.xlsx')) {
        const buf = await file.arrayBuffer();
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const ws = wb.worksheets[0];
        if (ws) {
          const csvLines: string[] = [];
          ws.eachRow((row) => {
            const vals = (row.values as unknown[]).slice(1).map((v) => {
              const s = String(v ?? '').replace(/"/g, '""');
              return `"${s}"`;
            });
            csvLines.push(vals.join(','));
          });
          const parsed = parseCsvToRawRows(csvLines.join('\n'));
          if (parsed.length > 0) {
            await onRunPipeline(localSteps, parsed);
          }
        }
      } else {
        const text = await file.text();
        const parsed = parseCsvToRawRows(text);
        if (parsed.length > 0) {
          await onRunPipeline(localSteps, parsed);
        }
      }
    } finally {
      setIsRunning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const copyMCode = async () => {
    await navigator.clipboard.writeText(pqMCode);
    setCopiedM(true);
    setTimeout(() => setCopiedM(false), 1800);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Power Query ETL Studio
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Ingest, normalize, deduplicate, and audit large ERP datasets before syncing to models &amp; pivot tables
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={handleFileUpload}
            className="hidden"
          />
          {canRun && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRunning}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Upload className="h-3.5 w-3.5" />
                Import CSV / XLSX
              </button>
              <button
                type="button"
                onClick={onResetDataset}
                disabled={isRunning}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset ERP Sample
              </button>
              <button
                type="button"
                onClick={() => applySteps(localSteps)}
                disabled={isRunning}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50 dark:bg-teal-600 whitespace-nowrap shrink-0"
              >
                <Play className="h-3.5 w-3.5" />
                {isRunning ? 'Executing...' : 'Refresh & Sync'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Dataset Quality Strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Raw Source Rows</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {pqStats.rawCount.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Cleaned Output Rows</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {pqStats.cleanedCount.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Anomalies Fixed</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {pqStats.totalAnomaliesFixed.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Duplicates Purged</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            {pqStats.duplicatesRemoved.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Main Split: Preview Table (8 cols) + Applied Steps (4 cols) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Left: Data Preview / Diff / M-Code */}
        <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 xl:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setViewMode('cleaned')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === 'cleaned'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                Cleaned Table
              </button>
              <button
                type="button"
                onClick={() => setViewMode('diff')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === 'diff'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                Raw vs Cleaned Diff
              </button>
              <button
                type="button"
                onClick={() => setViewMode('mcode')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === 'mcode'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                M-Code Script
              </button>
            </div>

            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Showing top 100 of {cleanedLedger.length.toLocaleString()} rows
            </span>
          </div>

          {viewMode === 'mcode' ? (
            <div className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Generated Excel Power Query M Language
                </span>
                <button
                  type="button"
                  onClick={copyMCode}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {copiedM ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedM ? 'Copied' : 'Copy M Script'}
                </button>
              </div>
              <pre className="max-h-[460px] overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-emerald-300 dark:border-slate-800">
                {pqMCode}
              </pre>
            </div>
          ) : viewMode === 'diff' ? (
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">TxID</th>
                    <th className="px-3 py-2.5">Raw Date → ISO Date</th>
                    <th className="px-3 py-2.5">Raw Region → Normalized</th>
                    <th className="px-3 py-2.5">Raw Amount → Numeric</th>
                    <th className="px-4 py-2.5">Applied Fixes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {cleanedLedger.slice(0, 100).map((row) => {
                    const raw = rawById.get(row.id);
                    return (
                      <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2 font-mono tabular-nums text-slate-700 dark:text-slate-300">{row.txId}</td>
                        <td className="px-3 py-2 font-mono text-[11px] tabular-nums">
                          {raw && raw.rawDate !== row.date ? (
                            <span>
                              <span className="line-through text-rose-600 dark:text-rose-400">{raw.rawDate}</span>{' '}
                              → <span className="text-emerald-700 dark:text-emerald-400">{row.date}</span>
                            </span>
                          ) : (
                            <span className="text-slate-600 dark:text-slate-400">{row.date}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[11px]">
                          {raw && raw.region !== row.region ? (
                            <span>
                              <span className="line-through text-rose-600 dark:text-rose-400">&quot;{raw.region}&quot;</span>{' '}
                              → <span className="text-emerald-700 dark:text-emerald-400">{row.region}</span>
                            </span>
                          ) : (
                            <span className="text-slate-600 dark:text-slate-400">{row.region}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] tabular-nums">
                          {row.redacted ? (
                            <span className="text-amber-700 dark:text-amber-400">[REDACTED]</span>
                          ) : raw ? (
                            <span>
                              <span className="text-slate-400">{raw.rawAmount}</span> →{' '}
                              <span className="font-medium text-slate-900 dark:text-slate-100">
                                {row.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </span>
                            </span>
                          ) : (
                            row.amount.toFixed(2)
                          )}
                        </td>
                        <td className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                          {row.anomaliesFixed.length > 0 ? row.anomaliesFixed.join(' · ') : 'Clean'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">TxID</th>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Region</th>
                    <th className="px-3 py-2.5">Department</th>
                    <th className="px-3 py-2.5">Category</th>
                    <th className="px-3 py-2.5">Cost Center</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="px-4 py-2.5 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {cleanedLedger.slice(0, 100).map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-2 font-mono tabular-nums text-slate-700 dark:text-slate-300">{row.txId}</td>
                      <td className="px-3 py-2 font-mono tabular-nums text-slate-500 dark:text-slate-400">{row.date}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.region}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{row.department}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{row.accountCategory}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {row.costCenter}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {row.redacted
                          ? '[REDACTED]'
                          : `$${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono tabular-nums ${
                          row.redacted
                            ? 'text-amber-700 dark:text-amber-400'
                            : row.variance >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {row.redacted
                          ? '[REDACTED]'
                          : `$${row.variance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Applied Steps Pipeline */}
        <div className="flex flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 xl:col-span-4">
          <div className="border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <Database className="h-4 w-4 text-teal-700 dark:text-teal-400" />
              Applied Query Steps ({localSteps.filter((s) => s.enabled).length} active)
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Toggle steps to preview transformations and live metrics
            </p>
          </div>

          <div className="flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {localSteps.map((step, idx) => {
              const m = metricsMap.get(step.id);
              const isCustom = step.id.startsWith('pq-custom');
              return (
                <div key={step.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <label className="flex flex-1 cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={step.enabled}
                      disabled={!canRun || isRunning}
                      onChange={() => toggleStep(step.id)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <div className="min-w-0">
                      <div
                        className={`text-xs font-medium ${
                          step.enabled
                            ? 'text-slate-900 dark:text-slate-100'
                            : 'text-slate-400 line-through dark:text-slate-500'
                        }`}
                      >
                        {idx + 1}. {step.label}
                      </div>
                      {m && step.enabled && (
                        <div className="mt-0.5 font-mono text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                          {m.rowsIn.toLocaleString()} → {m.rowsOut.toLocaleString()} rows · {m.changesApplied.toLocaleString()} edits · {m.durationMs}ms
                        </div>
                      )}
                    </div>
                  </label>
                  {isCustom && canRun && (
                    <button
                      type="button"
                      onClick={() => removeCustomStep(step.id)}
                      aria-label="Remove step"
                      className="p-1 text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add Custom Transformation Step */}
          {canRun && (
            <div className="border-t border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/50">
              <div className="mb-2 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Add Transformation Step
              </div>
              <div className="space-y-2">
                <select
                  value={newStepType}
                  onChange={(e) => setNewStepType(e.target.value as 'replace_value' | 'filter_status')}
                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="replace_value">Replace Region Value</option>
                  <option value="filter_status">Filter by Journal Status</option>
                </select>

                {newStepType === 'replace_value' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={findVal}
                      onChange={(e) => setFindVal(e.target.value)}
                      placeholder="Find..."
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <input
                      type="text"
                      value={replaceVal}
                      onChange={(e) => setReplaceVal(e.target.value)}
                      placeholder="Replace with..."
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                ) : (
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="Posted">Posted Only</option>
                    <option value="Accrued">Accrued Only</option>
                    <option value="Pending Review">Pending Review Only</option>
                  </select>
                )}

                <button
                  type="button"
                  onClick={addCustomStep}
                  disabled={isRunning}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Append Step &amp; Execute
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
