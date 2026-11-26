import {
  CleanedLedgerRow,
  PowerQueryExecutionResult,
  PowerQueryStep,
  PowerQueryStepMetrics,
  RawLedgerRow,
} from '../types/finance';

function parseRawDate(raw: string): { date: string; month: string; quarter: string; fixed: boolean } {
  const trimmed = raw.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m] = trimmed.split('-');
    const q = Math.ceil(Number(m) / 3);
    return { date: trimmed, month: `${y}-${m}`, quarter: `${y} Q${q}`, fixed: false };
  }
  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, '0');
    const d = slashMatch[2].padStart(2, '0');
    const y = slashMatch[3];
    const q = Math.ceil(Number(m) / 3);
    return { date: `${y}-${m}-${d}`, month: `${y}-${m}`, quarter: `${y} Q${q}`, fixed: true };
  }
  // YYYY/MM/DD
  const ymdSlash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(trimmed);
  if (ymdSlash) {
    const y = ymdSlash[1];
    const m = ymdSlash[2].padStart(2, '0');
    const d = ymdSlash[3].padStart(2, '0');
    const q = Math.ceil(Number(m) / 3);
    return { date: `${y}-${m}-${d}`, month: `${y}-${m}`, quarter: `${y} Q${q}`, fixed: true };
  }
  // Fallback parse
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    const q = Math.ceil(Number(m) / 3);
    return { date: `${y}-${m}-${d}`, month: `${y}-${m}`, quarter: `${y} Q${q}`, fixed: true };
  }
  return { date: '2026-01-01', month: '2026-01', quarter: '2026 Q1', fixed: true };
}

function parseCurrencyString(raw: string): { value: number; fixed: boolean } {
  const s = String(raw ?? '').trim();
  if (!s) return { value: 0, fixed: true };
  const isParenNeg = /^\(.*\)$/.test(s);
  const hadFormatting = /[$€£,\s()]/.test(s);
  const cleaned = s.replace(/[$€£,\s()]/g, '');
  let num = Number(cleaned);
  if (Number.isNaN(num)) num = 0;
  if (isParenNeg && num > 0) num = -num;
  return { value: Math.round(num * 100) / 100, fixed: hadFormatting };
}

function toTitleCase(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => {
      if (['IT', 'R&D', 'G&A', 'US', 'UK', 'EMEA', 'APAC', 'LATAM', 'NA', 'SaaS', 'COGS', 'OpEx', 'CapEx'].includes(w.toUpperCase())) {
        const up = w.toUpperCase();
        if (up === 'SAAS') return 'SaaS';
        if (up === 'OPEX') return 'OpEx';
        if (up === 'CAPEX') return 'CapEx';
        return up;
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function normalizeCategory(raw: string): CleanedLedgerRow['accountCategory'] {
  const s = raw.trim().toLowerCase();
  if (s.includes('rev') || s.includes('sales') || s.includes('sub')) return 'Revenue';
  if (s.includes('cogs') || s.includes('cost of')) return 'COGS';
  if (s.includes('pay') || s.includes('sal') || s.includes('comp')) return 'Payroll';
  if (s.includes('capex') || s.includes('asset')) return 'CapEx';
  if (s.includes('opex') || s.includes('mkt') || s.includes('g&a') || s.includes('r&d')) return 'OpEx';
  return 'OpEx';
}

function normalizeStatus(raw: string): CleanedLedgerRow['status'] {
  const s = raw.trim().toLowerCase();
  if (s.includes('accru')) return 'Accrued';
  if (s.includes('pend') || s.includes('rev')) return 'Pending Review';
  return 'Posted';
}

export function executePowerQuery(
  rawRows: RawLedgerRow[],
  steps: PowerQueryStep[],
): PowerQueryExecutionResult {
  const metrics: PowerQueryStepMetrics[] = [];
  let duplicatesRemoved = 0;
  let totalAnomaliesFixed = 0;

  // Working mutable structure
  type WorkingRow = {
    id: string;
    txId: string;
    date: string;
    month: string;
    quarter: string;
    entity: string;
    region: string;
    department: string;
    accountCategoryRaw: string;
    accountCategory: CleanedLedgerRow['accountCategory'];
    accountName: string;
    customerSegment: string;
    amountRaw: string;
    amount: number;
    budgetRaw: string;
    budget: number;
    variance: number;
    units: number;
    costCenter: string;
    status: CleanedLedgerRow['status'];
    isSensitive: boolean;
    notes: string;
    anomaliesFixed: string[];
  };

  let current: WorkingRow[] = rawRows.map((r) => ({
    id: r.id,
    txId: r.txId,
    date: r.rawDate,
    month: r.rawDate.slice(0, 7),
    quarter: '2026 Q1',
    entity: r.entity,
    region: r.region,
    department: r.department,
    accountCategoryRaw: r.accountCategory,
    accountCategory: normalizeCategory(r.accountCategory),
    accountName: r.accountName,
    customerSegment: r.customerSegment,
    amountRaw: r.rawAmount,
    amount: Number(String(r.rawAmount).replace(/[^0-9.-]/g, '')) || 0,
    budgetRaw: r.budgetRaw,
    budget: Number(String(r.budgetRaw).replace(/[^0-9.-]/g, '')) || 0,
    variance: 0,
    units: Number(String(r.units).replace(/[^0-9.-]/g, '')) || 0,
    costCenter: r.costCenter,
    status: normalizeStatus(r.status),
    isSensitive: Boolean(r.isSensitive),
    notes: r.notes ?? '',
    anomaliesFixed: [],
  }));

  for (const step of steps) {
    if (!step.enabled) continue;
    const t0 = performance.now();
    const rowsIn = current.length;
    let changesApplied = 0;

    switch (step.type) {
      case 'trim_clean': {
        for (const row of current) {
          const origRegion = row.region;
          const origDept = row.department;
          const origSeg = row.customerSegment;
          const origAcct = row.accountName;
          row.entity = toTitleCase(row.entity);
          row.region = toTitleCase(row.region);
          row.department = toTitleCase(row.department);
          row.customerSegment = toTitleCase(row.customerSegment);
          row.accountName = toTitleCase(row.accountName);
          if (
            origRegion !== row.region ||
            origDept !== row.department ||
            origSeg !== row.customerSegment ||
            origAcct !== row.accountName
          ) {
            changesApplied++;
            row.anomaliesFixed.push('Trimmed whitespace & casing');
          }
        }
        break;
      }
      case 'standardize_dates': {
        for (const row of current) {
          const res = parseRawDate(row.date);
          if (res.fixed || row.date !== res.date) {
            changesApplied++;
            row.anomaliesFixed.push(`Standardized date (${row.date} → ${res.date})`);
          }
          row.date = res.date;
          row.month = res.month;
          row.quarter = res.quarter;
        }
        break;
      }
      case 'parse_currency': {
        for (const row of current) {
          const a = parseCurrencyString(row.amountRaw);
          const b = parseCurrencyString(row.budgetRaw);
          row.amount = a.value;
          row.budget = b.value;
          if (a.fixed || b.fixed) {
            changesApplied++;
            row.anomaliesFixed.push('Parsed formatted currency string');
          }
        }
        break;
      }
      case 'remove_duplicates': {
        const seen = new Set<string>();
        const deduped: WorkingRow[] = [];
        for (const row of current) {
          const key = row.txId.trim().toUpperCase();
          if (seen.has(key)) {
            changesApplied++;
            duplicatesRemoved++;
          } else {
            seen.add(key);
            deduped.push(row);
          }
        }
        current = deduped;
        break;
      }
      case 'impute_cost_centers': {
        for (const row of current) {
          if (!row.costCenter || row.costCenter.trim() === '' || row.costCenter.toLowerCase() === 'null') {
            const deptPrefix = row.department.slice(0, 3).toUpperCase() || 'GEN';
            const regionPrefix = row.region.slice(0, 2).toUpperCase() || 'GL';
            row.costCenter = `CC-${regionPrefix}-${deptPrefix}`;
            changesApplied++;
            row.anomaliesFixed.push(`Imputed missing cost center → ${row.costCenter}`);
          }
        }
        break;
      }
      case 'normalize_categories': {
        for (const row of current) {
          const norm = normalizeCategory(row.accountCategoryRaw);
          if (row.accountCategoryRaw.trim() !== norm) {
            changesApplied++;
            row.anomaliesFixed.push(`Mapped category "${row.accountCategoryRaw}" → ${norm}`);
          }
          row.accountCategory = norm;
        }
        break;
      }
      case 'add_variance_column': {
        for (const row of current) {
          row.variance = Math.round((row.amount - row.budget) * 100) / 100;
          changesApplied++;
        }
        break;
      }
      case 'filter_status': {
        const target = (step.config?.filterValue ?? '').trim().toLowerCase();
        if (target && target !== 'all') {
          const filtered = current.filter((r) => r.status.toLowerCase() === target);
          changesApplied = current.length - filtered.length;
          current = filtered;
        }
        break;
      }
      case 'replace_value': {
        const field = step.config?.field ?? 'region';
        const find = (step.config?.findValue ?? '').trim();
        const rep = (step.config?.replaceWith ?? '').trim();
        if (find) {
          for (const row of current) {
            const val = String((row as Record<string, unknown>)[field] ?? '');
            if (val.toLowerCase() === find.toLowerCase()) {
              (row as Record<string, unknown>)[field] = rep;
              changesApplied++;
              row.anomaliesFixed.push(`Replaced ${field}: "${find}" → "${rep}"`);
            }
          }
        }
        break;
      }
    }

    totalAnomaliesFixed += changesApplied;
    const t1 = performance.now();
    metrics.push({
      stepId: step.id,
      rowsIn,
      rowsOut: current.length,
      changesApplied,
      durationMs: Math.max(1, Math.round((t1 - t0) * 10) / 10),
    });
  }

  const cleanedRows: CleanedLedgerRow[] = current.map((r) => ({
    id: r.id,
    txId: r.txId,
    date: r.date,
    month: r.month,
    quarter: r.quarter,
    entity: r.entity,
    region: r.region,
    department: r.department,
    accountCategory: r.accountCategory,
    accountName: r.accountName,
    customerSegment: r.customerSegment,
    amount: r.amount,
    budget: r.budget,
    variance: r.variance,
    units: r.units,
    costCenter: r.costCenter,
    status: r.status,
    isSensitive: r.isSensitive,
    notes: r.notes,
    anomaliesFixed: r.anomaliesFixed,
  }));

  const mCode = generatePowerQueryMCode(steps);
  return {
    cleanedRows,
    metrics,
    mCode,
    totalAnomaliesFixed,
    duplicatesRemoved,
  };
}

export function generatePowerQueryMCode(steps: PowerQueryStep[]): string {
  const lines: string[] = [
    'let',
    '  Source = Csv.Document(File.Contents("ERP_GL_Export_FY2026.csv"), [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),',
    '  #"Promoted Headers" = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),',
  ];

  let prev = '#"Promoted Headers"';
  steps.forEach((step, idx) => {
    if (!step.enabled) return;
    const stepVar = `#"${step.label.replace(/"/g, '')}"`;
    switch (step.type) {
      case 'trim_clean':
        lines.push(
          `  ${stepVar} = Table.TransformColumns(${prev}, {{"Region", each Text.Proper(Text.Trim(_)), type text}, {"Department", each Text.Proper(Text.Trim(_)), type text}}),`,
        );
        break;
      case 'standardize_dates':
        lines.push(
          `  ${stepVar} = Table.TransformColumnTypes(${prev}, {{"Date", type date}}, "en-US"),`,
        );
        break;
      case 'parse_currency':
        lines.push(
          `  ${stepVar} = Table.TransformColumnTypes(${prev}, {{"Amount", Currency.Type}, {"Budget", Currency.Type}}, "en-US"),`,
        );
        break;
      case 'remove_duplicates':
        lines.push(`  ${stepVar} = Table.Distinct(${prev}, {"TxID"}),`);
        break;
      case 'impute_cost_centers':
        lines.push(
          `  ${stepVar} = Table.ReplaceValue(${prev}, null, each "CC-" & Text.Upper(Text.Start([Region], 2)) & "-" & Text.Upper(Text.Start([Department], 3)), Replacer.ReplaceValue, {"CostCenter"}),`,
        );
        break;
      case 'normalize_categories':
        lines.push(
          `  ${stepVar} = Table.TransformColumns(${prev}, {{"AccountCategory", each if Text.Contains(_, "Rev", Comparer.OrdinalIgnoreCase) then "Revenue" else _, type text}}),`,
        );
        break;
      case 'add_variance_column':
        lines.push(
          `  ${stepVar} = Table.AddColumn(${prev}, "Variance", each [Amount] - [Budget], Currency.Type),`,
        );
        break;
      case 'filter_status':
        lines.push(
          `  ${stepVar} = Table.SelectRows(${prev}, each ([Status] = "${step.config?.filterValue ?? 'Posted'}")),`,
        );
        break;
      case 'replace_value':
        lines.push(
          `  ${stepVar} = Table.ReplaceValue(${prev}, "${step.config?.findValue ?? ''}", "${step.config?.replaceWith ?? ''}", Replacer.ReplaceText, {"${step.config?.field ?? 'Region'}"}),`,
        );
        break;
    }
    prev = stepVar;
    if (idx === steps.length - 1) {
      // keep trailing comma cleanup below
    }
  });

  // Remove trailing comma from final step line
  const lastIdx = lines.length - 1;
  lines[lastIdx] = lines[lastIdx].replace(/,$/, '');
  lines.push(`in`, `  ${prev}`);
  return lines.join('\n');
}

export function parseCsvToRawRows(csvText: string): RawLedgerRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const splitCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (candidates: string[]) => headers.findIndex((h) => candidates.some((c) => h.includes(c)));

  const txIdx = idx(['tx', 'id']);
  const dateIdx = idx(['date']);
  const entityIdx = idx(['entity']);
  const regionIdx = idx(['region']);
  const deptIdx = idx(['dept', 'department']);
  const catIdx = idx(['category']);
  const acctIdx = idx(['account']);
  const segIdx = idx(['segment']);
  const amtIdx = idx(['amount', 'actual']);
  const budIdx = idx(['budget']);
  const unitIdx = idx(['unit']);
  const ccIdx = idx(['cost']);
  const statIdx = idx(['status']);

  return lines.slice(1).map((line, i) => {
    const cols = splitCsvLine(line);
    return {
      id: `upload-${i + 1}`,
      txId: cols[txIdx >= 0 ? txIdx : 0] || `UP-${1000 + i}`,
      rawDate: cols[dateIdx >= 0 ? dateIdx : 1] || '2026-11-01',
      entity: cols[entityIdx >= 0 ? entityIdx : 2] || 'Meridian US',
      region: cols[regionIdx >= 0 ? regionIdx : 3] || 'North America',
      department: cols[deptIdx >= 0 ? deptIdx : 4] || 'Finance',
      accountCategory: cols[catIdx >= 0 ? catIdx : 5] || 'Revenue',
      accountName: cols[acctIdx >= 0 ? acctIdx : 6] || 'Enterprise Subscription',
      customerSegment: cols[segIdx >= 0 ? segIdx : 7] || 'Enterprise',
      rawAmount: cols[amtIdx >= 0 ? amtIdx : 8] || '0',
      budgetRaw: cols[budIdx >= 0 ? budIdx : 9] || '0',
      units: cols[unitIdx >= 0 ? unitIdx : 10] || '1',
      costCenter: cols[ccIdx >= 0 ? ccIdx : 11] || '',
      status: cols[statIdx >= 0 ? statIdx : 12] || 'Posted',
    };
  });
}
