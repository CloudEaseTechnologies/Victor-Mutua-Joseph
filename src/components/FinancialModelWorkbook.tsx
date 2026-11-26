import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Download, GitBranch, Lock, ShieldAlert } from 'lucide-react';
import { colIndexToLetter } from '../engine/formulaEngine';
import { EvaluatedCell, FiscalPeriodState, ModelSheet, ScenarioName } from '../types/finance';

interface FinancialModelWorkbookProps {
  sheets: ModelSheet[];
  evaluatedModel: Record<string, Record<string, EvaluatedCell>>;
  scenario: ScenarioName;
  canEdit: boolean;
  fiscalPeriod: FiscalPeriodState;
  onScenarioChange: (s: ScenarioName) => void;
  onUpdateCell: (sheetId: string, cellKey: string, raw: string) => Promise<void>;
  onExportWorkbook: () => Promise<void>;
}

export const FinancialModelWorkbook: React.FC<FinancialModelWorkbookProps> = ({
  sheets,
  evaluatedModel,
  scenario,
  canEdit,
  fiscalPeriod,
  onScenarioChange,
  onUpdateCell,
  onExportWorkbook,
}) => {
  const [activeSheetId, setActiveSheetId] = useState<string>(sheets[0]?.id ?? 'pl-statement');
  const [selectedCell, setSelectedCell] = useState<string>('N7');
  const [formulaInput, setFormulaInput] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const activeSheet = useMemo(
    () => sheets.find((s) => s.id === activeSheetId) ?? sheets[0],
    [sheets, activeSheetId],
  );

  const activeEvaluated = evaluatedModel[activeSheet?.id ?? ''] ?? {};
  const currentCellDef = activeSheet?.cells[selectedCell];
  const currentEval = activeEvaluated[selectedCell];

  useEffect(() => {
    setFormulaInput(currentCellDef?.raw ?? '');
  }, [activeSheetId, selectedCell, currentCellDef?.raw]);

  if (!activeSheet) return null;

  const commitFormula = async () => {
    if (!canEdit || (fiscalPeriod.isLocked)) return;
    if (formulaInput === (currentCellDef?.raw ?? '')) return;
    setIsSaving(true);
    try {
      await onUpdateCell(activeSheet.id, selectedCell, formulaInput);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGridKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    if (e.key === 'ArrowRight' && c + 1 < activeSheet.colCount) {
      e.preventDefault();
      setSelectedCell(`${colIndexToLetter(c + 1)}${r}`);
    } else if (e.key === 'ArrowLeft' && c > 0) {
      e.preventDefault();
      setSelectedCell(`${colIndexToLetter(c - 1)}${r}`);
    } else if (e.key === 'ArrowDown' && r < activeSheet.rowCount) {
      e.preventDefault();
      setSelectedCell(`${colIndexToLetter(c)}${r + 1}`);
    } else if (e.key === 'ArrowUp' && r > 1) {
      e.preventDefault();
      setSelectedCell(`${colIndexToLetter(c)}${r - 1}`);
    }
  };

  const canModifySelected =
    canEdit &&
    !fiscalPeriod.isLocked &&
    !(currentCellDef?.isSensitive && currentCellDef?.raw === '[REDACTED]');

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Multi-Sheet Financial Model
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {activeSheet.description} · Live cross-sheet dependency graph &amp; multi-step formula evaluator
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
                    ? 'bg-slate-900 text-white dark:bg-teal-600'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onExportWorkbook}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Export .XLSX with Formulas
          </button>
        </div>
      </div>

      {/* Formula Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 border-r border-slate-200 pr-3 dark:border-slate-800">
          <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 w-12 text-center">
            {selectedCell}
          </span>
          <span className="font-mono text-xs italic text-teal-700 dark:text-teal-400">fx</span>
        </div>

        <input
          type="text"
          value={formulaInput}
          disabled={!canModifySelected || isSaving}
          onChange={(e) => setFormulaInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitFormula();
            } else if (e.key === 'Escape') {
              setFormulaInput(currentCellDef?.raw ?? '');
            }
          }}
          placeholder={
            fiscalPeriod.isLocked
              ? 'Period locked — formula editing disabled'
              : !canEdit
                ? 'Read-only role — formula editing disabled'
                : 'Enter value or Excel formula (e.g. =SUM(B2:M2), =IF(B10>0, B10*0.21, 0))'
          }
          className="min-w-[260px] flex-1 bg-transparent font-mono text-xs text-slate-900 focus:outline-none disabled:text-slate-400 dark:text-slate-100"
        />

        {canModifySelected && (
          <button
            type="button"
            onClick={commitFormula}
            disabled={isSaving || formulaInput === (currentCellDef?.raw ?? '')}
            className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 whitespace-nowrap shrink-0"
          >
            {isSaving ? 'Saving...' : 'Apply Formula'}
          </button>
        )}

        {fiscalPeriod.isLocked && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <Lock className="h-3.5 w-3.5" />
            Locked
          </span>
        )}
      </div>

      {/* Main Split: Spreadsheet Grid + Step-by-Step Formula Inspector */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 xl:col-span-9">
          {/* Sheet Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 pt-2 dark:border-slate-800 dark:bg-slate-950/60">
            {sheets.map((sheet) => {
              const active = sheet.id === activeSheet.id;
              return (
                <button
                  key={sheet.id}
                  type="button"
                  onClick={() => {
                    setActiveSheetId(sheet.id);
                    setSelectedCell('B2');
                  }}
                  className={`border-b-2 px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-teal-700 bg-white text-teal-800 dark:border-teal-400 dark:bg-slate-900 dark:text-teal-300'
                      : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {sheet.name}
                </button>
              );
            })}
          </div>

          {/* Grid */}
          <div className="overflow-auto max-h-[540px]">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-950">
                <tr>
                  <th className="w-10 border-b border-r border-slate-200 px-2 py-1.5 text-center font-mono text-[10px] font-medium text-slate-400 dark:border-slate-800">
                    #
                  </th>
                  {Array.from({ length: activeSheet.colCount }, (_, c) => (
                    <th
                      key={c}
                      className={`border-b border-r border-slate-200 px-2.5 py-1.5 text-center font-mono text-[10px] font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400 ${
                        c === 0 ? 'min-w-[240px] text-left' : 'min-w-[104px]'
                      }`}
                    >
                      {colIndexToLetter(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: activeSheet.rowCount }, (_, rowIdx) => {
                  const r = rowIdx + 1;
                  return (
                    <tr key={r} className={r === 1 ? 'bg-slate-50/90 dark:bg-slate-800/40' : ''}>
                      <td className="border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-mono text-[10px] text-slate-400 dark:border-slate-800 dark:bg-slate-950">
                        {r}
                      </td>
                      {Array.from({ length: activeSheet.colCount }, (_, c) => {
                        const key = `${colIndexToLetter(c)}${r}`;
                        const cellDef = activeSheet.cells[key];
                        const evalRes = activeEvaluated[key];
                        const isSelected = selectedCell === key;
                        const isRedacted = cellDef?.raw === '[REDACTED]';
                        const isNumeric = c > 0 && r > 1;

                        return (
                          <td
                            key={key}
                            tabIndex={0}
                            onClick={() => setSelectedCell(key)}
                            onKeyDown={(e) => handleGridKeyDown(e, r, c)}
                            className={`cursor-cell border-b border-r border-slate-200 px-2.5 py-1.5 outline-none transition-colors dark:border-slate-800 ${
                              isSelected
                                ? 'ring-2 ring-inset ring-teal-700 bg-teal-50/60 dark:ring-teal-400 dark:bg-teal-950/40'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                            } ${c === 0 ? 'sticky left-0 z-[5] bg-white dark:bg-slate-900' : ''} ${
                              cellDef?.bold || r === 1 ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'
                            } ${isNumeric ? 'text-right font-mono tabular-nums' : 'text-left'} ${
                              cellDef?.isInput ? 'text-blue-700 dark:text-blue-300' : ''
                            } ${evalRes?.error ? 'text-rose-700 dark:text-rose-400' : ''}`}
                          >
                            {isRedacted ? (
                              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-amber-700 dark:text-amber-400">
                                <ShieldAlert className="h-3 w-3" />
                                REDACTED
                              </span>
                            ) : (
                              evalRes?.formatted ?? cellDef?.raw ?? ''
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Multi-Step Formula Breakdown Inspector */}
        <div className="flex flex-col rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 xl:col-span-3">
          <div className="border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <Calculator className="h-4 w-4 text-teal-700 dark:text-teal-400" />
              Multi-Step Formula Inspector
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {activeSheet.name}!{selectedCell} · {currentEval?.isFormula ? 'Calculated Formula' : currentCellDef?.isInput ? 'Model Input Driver' : 'Label / Constant'}
            </p>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Evaluated Result</div>
              <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {currentEval?.formatted || '—'}
              </div>
            </div>

            {currentCellDef?.raw && (
              <div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Expression / Raw</div>
                <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] break-all text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                  {currentCellDef.raw}
                </div>
              </div>
            )}

            {currentEval && currentEval.steps.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <GitBranch className="h-3.5 w-3.5" />
                  Step-by-Step Evaluation ({currentEval.steps.length} steps)
                </div>
                <div className="space-y-2">
                  {currentEval.steps.map((st) => (
                    <div
                      key={st.step}
                      className="rounded-md border border-slate-200 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-950/50"
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                        <span>Step {st.step} · {st.detail}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[11px]">
                        <span className="truncate text-slate-600 dark:text-slate-300">{st.expression}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-teal-700 dark:text-teal-400">
                          = {st.evaluated}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {currentEval && currentEval.precedents.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Referenced Precedents ({currentEval.precedents.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {currentEval.precedents.slice(0, 14).map((p) => {
                    const [sId, cKey] = p.split('!');
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setActiveSheetId(sId);
                          setSelectedCell(cKey);
                        }}
                        className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] text-slate-700 hover:border-teal-600 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        {cKey}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="border-t border-slate-200 pt-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <div className="font-medium text-slate-700 dark:text-slate-300">Supported Functions</div>
              <p className="mt-1 font-mono text-[10px] leading-relaxed">
                SUM, AVERAGE, MIN, MAX, COUNT, IF, AND, OR, ROUND, ABS, SQRT, POWER, NPV, IRR, and cross-sheet refs (&apos;Sheet&apos;!B2).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
