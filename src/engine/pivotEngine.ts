import { CleanedLedgerRow, PivotAggregation, PivotCell, PivotConfig, PivotResult } from '../types/finance';

function aggregateValues(nums: number[], agg: PivotAggregation): number {
  if (nums.length === 0) return 0;
  switch (agg) {
    case 'SUM':
    case 'PCT_TOTAL':
    case 'PCT_ROW':
      return nums.reduce((a, b) => a + b, 0);
    case 'AVERAGE':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'COUNT':
      return nums.length;
    case 'MIN':
      return Math.min(...nums);
    case 'MAX':
      return Math.max(...nums);
    default:
      return nums.reduce((a, b) => a + b, 0);
  }
}

export function computePivotTable(
  rows: CleanedLedgerRow[],
  config: PivotConfig,
): PivotResult {
  // Apply filters first
  const filtered = rows.filter((r) => {
    if (config.filters.region && config.filters.region !== 'ALL' && r.region !== config.filters.region) {
      return false;
    }
    if (
      config.filters.accountCategory &&
      config.filters.accountCategory !== 'ALL' &&
      r.accountCategory !== config.filters.accountCategory
    ) {
      return false;
    }
    if (config.filters.status && config.filters.status !== 'ALL' && r.status !== config.filters.status) {
      return false;
    }
    return true;
  });

  const rowMap = new Map<string, Map<string, { values: number[]; ids: string[] }>>();
  const colSet = new Set<string>();
  const rowTotalsAcc = new Map<string, { values: number[]; ids: string[] }>();
  const colTotalsAcc = new Map<string, { values: number[]; ids: string[] }>();
  const grandAcc = { values: [] as number[], ids: [] as string[] };

  for (const r of filtered) {
    if (r.redacted) continue;
    const rowKey = String(r[config.rowField] ?? 'Unspecified');
    const colKey = config.colField === 'NONE' ? 'Total' : String(r[config.colField] ?? 'Unspecified');
    const numVal = Number(r[config.valueField] ?? 0);

    colSet.add(colKey);

    if (!rowMap.has(rowKey)) rowMap.set(rowKey, new Map());
    const colsForRow = rowMap.get(rowKey)!;
    if (!colsForRow.has(colKey)) colsForRow.set(colKey, { values: [], ids: [] });
    colsForRow.get(colKey)!.values.push(numVal);
    colsForRow.get(colKey)!.ids.push(r.id);

    if (!rowTotalsAcc.has(rowKey)) rowTotalsAcc.set(rowKey, { values: [], ids: [] });
    rowTotalsAcc.get(rowKey)!.values.push(numVal);
    rowTotalsAcc.get(rowKey)!.ids.push(r.id);

    if (!colTotalsAcc.has(colKey)) colTotalsAcc.set(colKey, { values: [], ids: [] });
    colTotalsAcc.get(colKey)!.values.push(numVal);
    colTotalsAcc.get(colKey)!.ids.push(r.id);

    grandAcc.values.push(numVal);
    grandAcc.ids.push(r.id);
  }

  const colKeys = Array.from(colSet).sort();
  const grandRaw = aggregateValues(grandAcc.values, config.aggregation);
  const grandTotal: PivotCell = {
    rawValue: grandRaw,
    displayValue: config.aggregation === 'PCT_TOTAL' || config.aggregation === 'PCT_ROW' ? 100 : grandRaw,
    recordIds: grandAcc.ids,
    count: grandAcc.ids.length,
  };

  const rowTotals: Record<string, PivotCell> = {};
  for (const [rk, acc] of rowTotalsAcc.entries()) {
    const raw = aggregateValues(acc.values, config.aggregation);
    rowTotals[rk] = {
      rawValue: raw,
      displayValue:
        config.aggregation === 'PCT_TOTAL'
          ? grandRaw !== 0
            ? (raw / grandRaw) * 100
            : 0
          : config.aggregation === 'PCT_ROW'
            ? 100
            : raw,
      recordIds: acc.ids,
      count: acc.ids.length,
    };
  }

  const colTotals: Record<string, PivotCell> = {};
  for (const ck of colKeys) {
    const acc = colTotalsAcc.get(ck) ?? { values: [], ids: [] };
    const raw = aggregateValues(acc.values, config.aggregation);
    colTotals[ck] = {
      rawValue: raw,
      displayValue:
        config.aggregation === 'PCT_TOTAL'
          ? grandRaw !== 0
            ? (raw / grandRaw) * 100
            : 0
          : config.aggregation === 'PCT_ROW'
            ? grandRaw !== 0
              ? (raw / grandRaw) * 100
              : 0
            : raw,
      recordIds: acc.ids,
      count: acc.ids.length,
    };
  }

  const matrix: Record<string, Record<string, PivotCell>> = {};
  for (const [rk, colsForRow] of rowMap.entries()) {
    matrix[rk] = {};
    const rowRaw = rowTotals[rk]?.rawValue ?? 0;
    for (const ck of colKeys) {
      const acc = colsForRow.get(ck) ?? { values: [], ids: [] };
      const raw = aggregateValues(acc.values, config.aggregation);
      let display = raw;
      if (config.aggregation === 'PCT_TOTAL') {
        display = grandRaw !== 0 ? (raw / grandRaw) * 100 : 0;
      } else if (config.aggregation === 'PCT_ROW') {
        display = rowRaw !== 0 ? (raw / rowRaw) * 100 : 0;
      }
      matrix[rk][ck] = {
        rawValue: raw,
        displayValue: display,
        recordIds: acc.ids,
        count: acc.ids.length,
      };
    }
  }

  const rowKeys = Array.from(rowMap.keys()).sort((a, b) => {
    if (config.sortBy === 'label') return a.localeCompare(b);
    const diff = (rowTotals[b]?.rawValue ?? 0) - (rowTotals[a]?.rawValue ?? 0);
    return config.sortBy === 'total_desc' ? diff : -diff;
  });

  return {
    rowKeys,
    colKeys,
    matrix,
    rowTotals,
    colTotals,
    grandTotal,
  };
}
