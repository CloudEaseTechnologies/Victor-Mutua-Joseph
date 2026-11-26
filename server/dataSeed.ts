import {
  CloseTask,
  ModelCell,
  ModelSheet,
  PowerQueryStep,
  RawLedgerRow,
  SavedCustomReport,
} from '../src/types/finance';

// Deterministic pseudo-random generator for consistent 1,240-row dataset
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateRawLedgerDataset(): RawLedgerRow[] {
  const rand = mulberry32(20261125);
  const rows: RawLedgerRow[] = [];

  const regionsMessy = [
    'North America',
    '  north america ',
    'NORTH AMERICA',
    'EMEA',
    ' emea',
    'APAC',
    'apac ',
    'LATAM',
  ];
  const entities = ['Meridian US Inc.', 'Meridian Europe Ltd.', 'Meridian APAC Pte.', 'Meridian LATAM Ltda.'];
  const departmentsMessy = [
    'Sales',
    ' sales ',
    'Engineering',
    'R&D',
    'Marketing',
    'G&A',
    'Customer Success',
    'Executive',
  ];
  const segments = ['Enterprise', 'Mid-Market', 'SMB', 'Strategic'];

  const accounts: Array<{ catRaw: string; name: string; baseAmt: number; isNeg: boolean; sensitive?: boolean }> = [
    { catRaw: 'Revenue', name: 'Enterprise SaaS Subscriptions', baseAmt: 42000, isNeg: false },
    { catRaw: 'sales rev', name: 'Mid-Market Cloud Licenses', baseAmt: 21500, isNeg: false },
    { catRaw: 'Revenue', name: 'Implementation & Advisory', baseAmt: 14800, isNeg: false },
    { catRaw: 'COGS', name: 'Cloud Hosting & Compute', baseAmt: 9200, isNeg: true },
    { catRaw: 'cost of goods', name: 'Third-Party Data Feeds', baseAmt: 4100, isNeg: true },
    { catRaw: 'OpEx', name: 'Performance Marketing Spend', baseAmt: 11400, isNeg: true },
    { catRaw: 'opex ', name: 'Enterprise Software & Tooling', baseAmt: 5400, isNeg: true },
    { catRaw: 'Payroll', name: 'Engineering & Product Salaries', baseAmt: 26500, isNeg: true },
    { catRaw: 'Payroll', name: 'Executive Bonus & Equity Accrual', baseAmt: 34000, isNeg: true, sensitive: true },
    { catRaw: 'G&A OpEx', name: 'M&A Legal & Diligence Retainer', baseAmt: 22000, isNeg: true, sensitive: true },
    { catRaw: 'CapEx', name: 'Data Center Infrastructure', baseAmt: 13500, isNeg: true },
  ];

  const statuses = ['Posted', 'Posted', 'Posted', 'Accrued', 'Pending Review'];

  // Generate 1,218 unique transactions across Jan–Nov 2026 + 22 intentional duplicates = 1,240 rows
  for (let i = 1; i <= 1218; i++) {
    const monthNum = ((i - 1) % 11) + 1;
    const dayNum = Math.min(28, Math.floor(rand() * 28) + 1);
    const mStr = String(monthNum).padStart(2, '0');
    const dStr = String(dayNum).padStart(2, '0');

    // Intentional mixed date formats for Power Query to standardize
    let rawDate = `2026-${mStr}-${dStr}`;
    if (i % 7 === 0) rawDate = `${monthNum}/${dayNum}/2026`;
    else if (i % 11 === 0) rawDate = `2026/${mStr}/${dStr}`;

    const regIdx = Math.floor(rand() * regionsMessy.length);
    const region = regionsMessy[regIdx];
    const entity =
      region.toLowerCase().includes('emea')
        ? entities[1]
        : region.toLowerCase().includes('apac')
          ? entities[2]
          : region.toLowerCase().includes('latam')
            ? entities[3]
            : entities[0];

    const acct = accounts[Math.floor(rand() * accounts.length)];
    const dept = acct.sensitive
      ? 'Executive'
      : acct.catRaw.toLowerCase().includes('rev')
        ? 'Sales'
        : departmentsMessy[Math.floor(rand() * (departmentsMessy.length - 1))];

    const seasonalGrowth = 1 + (monthNum - 1) * 0.025;
    const noise = 0.78 + rand() * 0.44;
    const signedBase = acct.isNeg ? -acct.baseAmt : acct.baseAmt;
    const amountVal = Math.round(signedBase * seasonalGrowth * noise * 100) / 100;
    const budgetVal = Math.round(signedBase * seasonalGrowth * (0.94 + rand() * 0.12) * 100) / 100;

    // Format some numbers as messy currency strings / accounting parentheses
    let rawAmount = amountVal.toFixed(2);
    if (i % 5 === 0) {
      const absStr = Math.abs(amountVal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      rawAmount = amountVal < 0 ? `($${absStr})` : `$${absStr}`;
    } else if (i % 9 === 0) {
      rawAmount = `$${amountVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    const budgetRaw =
      i % 6 === 0
        ? `$${budgetVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : budgetVal.toFixed(2);

    const missingCC = i % 37 === 0;
    const costCenter = missingCC ? '' : `CC-${entity.slice(9, 11).toUpperCase()}-${100 + (i % 15)}`;

    rows.push({
      id: `raw-${i}`,
      txId: `GL-2026-${String(i).padStart(5, '0')}`,
      rawDate,
      entity,
      region,
      department: dept,
      accountCategory: acct.catRaw,
      accountName: acct.name,
      customerSegment: segments[Math.floor(rand() * segments.length)],
      rawAmount,
      budgetRaw,
      units: String(Math.max(1, Math.floor(rand() * 45))),
      costCenter,
      status: statuses[Math.floor(rand() * statuses.length)],
      isSensitive: Boolean(acct.sensitive),
      notes: acct.sensitive ? 'Board-restricted executive compensation / strategic item' : 'ERP sub-ledger batch sync',
    });

    // Inject 22 intentional duplicate TxIDs
    if (rows.length < 1240 && i % 55 === 0) {
      rows.push({
        ...rows[rows.length - 1],
        id: `raw-dup-${i}`,
      });
    }
  }

  return rows.slice(0, 1240);
}

export const DEFAULT_POWER_QUERY_STEPS: PowerQueryStep[] = [
  { id: 'pq-1', type: 'trim_clean', label: 'Trim Whitespace & Standardize Casing', enabled: true },
  { id: 'pq-2', type: 'standardize_dates', label: 'Parse Mixed Dates to ISO-8601', enabled: true },
  { id: 'pq-3', type: 'parse_currency', label: 'Convert Currency Strings & Accounting Negatives', enabled: true },
  { id: 'pq-4', type: 'remove_duplicates', label: 'Deduplicate Journal Entries (TxID)', enabled: true },
  { id: 'pq-5', type: 'impute_cost_centers', label: 'Impute Missing Cost Center Codes', enabled: true },
  { id: 'pq-6', type: 'normalize_categories', label: 'Map Raw Accounts to Reporting Categories', enabled: true },
  { id: 'pq-7', type: 'add_variance_column', label: 'Compute Budget Variance Column', enabled: true },
];

export function buildInitialModelSheets(): ModelSheet[] {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const colLetters = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];

  // Sheet 2: Revenue Drivers
  const revCells: Record<string, ModelCell> = {
    A1: { raw: 'Revenue Driver Schedule ($ USD)', bold: true, format: 'text' },
    A2: { raw: 'Enterprise SaaS ARR Recognition', bold: false, format: 'text' },
    A3: { raw: 'Mid-Market Cloud Subscriptions', bold: false, format: 'text' },
    A4: { raw: 'Implementation & Advisory Services', bold: false, format: 'text' },
    A5: { raw: 'Contraction & Churn Allowance', bold: false, format: 'text' },
    A6: { raw: 'Total Gross Revenue', bold: true, format: 'text' },
    A7: { raw: 'MoM Revenue Growth %', bold: false, format: 'text' },
  };
  months.forEach((m, idx) => {
    const col = colLetters[idx];
    const prevCol = idx > 0 ? colLetters[idx - 1] : null;
    revCells[`${col}1`] = { raw: `${m} 26`, bold: true, format: 'text' };
    revCells[`${col}2`] = { raw: String(Math.round(920000 * Math.pow(1.032, idx))), format: 'currency', isInput: true };
    revCells[`${col}3`] = { raw: String(Math.round(410000 * Math.pow(1.028, idx))), format: 'currency', isInput: true };
    revCells[`${col}4`] = { raw: String(Math.round(165000 * Math.pow(1.015, idx))), format: 'currency', isInput: true };
    revCells[`${col}5`] = { raw: String(Math.round(38000 * Math.pow(1.01, idx))), format: 'currency', isInput: true };
    revCells[`${col}6`] = { raw: `=SUM(${col}2:${col}4)-${col}5`, bold: true, format: 'currency' };
    revCells[`${col}7`] = prevCol
      ? { raw: `=(${col}6-${prevCol}6)/${prevCol}6`, format: 'percent' }
      : { raw: '0.025', format: 'percent', isInput: true };
  });
  revCells.N1 = { raw: 'FY Total', bold: true, format: 'text' };
  revCells.N2 = { raw: '=SUM(B2:M2)', format: 'currency' };
  revCells.N3 = { raw: '=SUM(B3:M3)', format: 'currency' };
  revCells.N4 = { raw: '=SUM(B4:M4)', format: 'currency' };
  revCells.N5 = { raw: '=SUM(B5:M5)', format: 'currency' };
  revCells.N6 = { raw: '=SUM(B6:M6)', bold: true, format: 'currency' };
  revCells.N7 = { raw: '=AVERAGE(B7:M7)', format: 'percent' };

  // Sheet 3: OpEx & Headcount
  const opexCells: Record<string, ModelCell> = {
    A1: { raw: 'Operating Expenses & Headcount ($ USD)', bold: true, format: 'text' },
    A2: { raw: 'Sales & Marketing', format: 'text' },
    A3: { raw: 'Research & Development (Engineering)', format: 'text' },
    A4: { raw: 'General & Administrative', format: 'text' },
    A5: { raw: 'Executive Comp & Retention Pool', format: 'text', isSensitive: true },
    A6: { raw: 'Total Operating Expenses', bold: true, format: 'text' },
    A7: { raw: 'Ending Headcount (FTE)', format: 'text' },
    A8: { raw: 'Monthly OpEx per FTE', format: 'text' },
  };
  months.forEach((m, idx) => {
    const col = colLetters[idx];
    opexCells[`${col}1`] = { raw: `${m} 26`, bold: true, format: 'text' };
    opexCells[`${col}2`] = { raw: String(Math.round(310000 * Math.pow(1.018, idx))), format: 'currency', isInput: true };
    opexCells[`${col}3`] = { raw: String(Math.round(385000 * Math.pow(1.014, idx))), format: 'currency', isInput: true };
    opexCells[`${col}4`] = { raw: String(Math.round(145000 * Math.pow(1.008, idx))), format: 'currency', isInput: true };
    opexCells[`${col}5`] = {
      raw: String(Math.round(92000 * Math.pow(1.01, idx))),
      format: 'currency',
      isInput: true,
      isSensitive: true,
    };
    opexCells[`${col}6`] = { raw: `=SUM(${col}2:${col}5)`, bold: true, format: 'currency' };
    opexCells[`${col}7`] = { raw: String(118 + idx * 2), format: 'integer', isInput: true };
    opexCells[`${col}8`] = { raw: `=${col}6/${col}7`, format: 'currency' };
  });
  opexCells.N1 = { raw: 'FY Total', bold: true, format: 'text' };
  opexCells.N2 = { raw: '=SUM(B2:M2)', format: 'currency' };
  opexCells.N3 = { raw: '=SUM(B3:M3)', format: 'currency' };
  opexCells.N4 = { raw: '=SUM(B4:M4)', format: 'currency' };
  opexCells.N5 = { raw: '=SUM(B5:M5)', format: 'currency', isSensitive: true };
  opexCells.N6 = { raw: '=SUM(B6:M6)', bold: true, format: 'currency' };
  opexCells.N7 = { raw: '=M7', format: 'integer' };
  opexCells.N8 = { raw: '=AVERAGE(B8:M8)', format: 'currency' };

  // Sheet 1: P&L Statement (Multi-step cross-sheet formulas)
  const plCells: Record<string, ModelCell> = {
    A1: { raw: 'Consolidated Income Statement (P&L)', bold: true, format: 'text' },
    A2: { raw: 'Total Revenue', bold: true, format: 'text' },
    A3: { raw: 'Cost of Goods Sold (Hosting & Support)', format: 'text' },
    A4: { raw: 'Gross Profit', bold: true, format: 'text' },
    A5: { raw: 'Gross Margin %', format: 'text' },
    A6: { raw: 'Total Operating Expenses', format: 'text' },
    A7: { raw: 'EBITDA', bold: true, format: 'text' },
    A8: { raw: 'EBITDA Margin %', format: 'text' },
    A9: { raw: 'Depreciation & Amortization', format: 'text' },
    A10: { raw: 'Operating Income (EBIT)', bold: true, format: 'text' },
    A11: { raw: 'Corporate Income Tax (21%)', format: 'text' },
    A12: { raw: 'Net Income', bold: true, format: 'text' },
    A13: { raw: 'Net Profit Margin %', format: 'text' },
  };
  months.forEach((m, idx) => {
    const col = colLetters[idx];
    plCells[`${col}1`] = { raw: `${m} 26`, bold: true, format: 'text' };
    plCells[`${col}2`] = { raw: `='Revenue Drivers'!${col}6`, bold: true, format: 'currency' };
    plCells[`${col}3`] = { raw: `=ROUND(${col}2*0.215, 0)`, format: 'currency' };
    plCells[`${col}4`] = { raw: `=${col}2-${col}3`, bold: true, format: 'currency' };
    plCells[`${col}5`] = { raw: `=${col}4/${col}2`, format: 'percent' };
    plCells[`${col}6`] = { raw: `='OpEx & Headcount'!${col}6`, format: 'currency' };
    plCells[`${col}7`] = { raw: `=${col}4-${col}6`, bold: true, format: 'currency' };
    plCells[`${col}8`] = { raw: `=${col}7/${col}2`, format: 'percent' };
    plCells[`${col}9`] = { raw: String(34000 + idx * 500), format: 'currency', isInput: true };
    plCells[`${col}10`] = { raw: `=${col}7-${col}9`, bold: true, format: 'currency' };
    plCells[`${col}11`] = { raw: `=IF(${col}10>0, ROUND(${col}10*0.21, 0), 0)`, format: 'currency' };
    plCells[`${col}12`] = { raw: `=${col}10-${col}11`, bold: true, format: 'currency' };
    plCells[`${col}13`] = { raw: `=${col}12/${col}2`, format: 'percent' };
  });
  plCells.N1 = { raw: 'FY Total', bold: true, format: 'text' };
  plCells.N2 = { raw: '=SUM(B2:M2)', bold: true, format: 'currency' };
  plCells.N3 = { raw: '=SUM(B3:M3)', format: 'currency' };
  plCells.N4 = { raw: '=N2-N3', bold: true, format: 'currency' };
  plCells.N5 = { raw: '=N4/N2', format: 'percent' };
  plCells.N6 = { raw: '=SUM(B6:M6)', format: 'currency' };
  plCells.N7 = { raw: '=N4-N6', bold: true, format: 'currency' };
  plCells.N8 = { raw: '=N7/N2', format: 'percent' };
  plCells.N9 = { raw: '=SUM(B9:M9)', format: 'currency' };
  plCells.N10 = { raw: '=N7-N9', bold: true, format: 'currency' };
  plCells.N11 = { raw: '=SUM(B11:M11)', format: 'currency' };
  plCells.N12 = { raw: '=N10-N11', bold: true, format: 'currency' };
  plCells.N13 = { raw: '=N12/N2', format: 'percent' };

  // Sheet 4: Cash Flow & Working Capital
  const cfCells: Record<string, ModelCell> = {
    A1: { raw: 'Free Cash Flow & Liquidity Bridge ($ USD)', bold: true, format: 'text' },
    A2: { raw: 'EBITDA', format: 'text' },
    A3: { raw: 'Cash Taxes Paid', format: 'text' },
    A4: { raw: 'Change in Net Working Capital', format: 'text' },
    A5: { raw: 'Capital Expenditures (CapEx)', format: 'text' },
    A6: { raw: 'Unlevered Free Cash Flow (UFCF)', bold: true, format: 'text' },
    A7: { raw: 'Ending Cash Balance', bold: true, format: 'text' },
  };
  months.forEach((m, idx) => {
    const col = colLetters[idx];
    const prevCol = idx > 0 ? colLetters[idx - 1] : null;
    cfCells[`${col}1`] = { raw: `${m} 26`, bold: true, format: 'text' };
    cfCells[`${col}2`] = { raw: `='P&L Statement'!${col}7`, format: 'currency' };
    cfCells[`${col}3`] = { raw: `='P&L Statement'!${col}11`, format: 'currency' };
    cfCells[`${col}4`] = { raw: String(18000 + (idx % 3) * 4500), format: 'currency', isInput: true };
    cfCells[`${col}5`] = { raw: String(28000 + idx * 1200), format: 'currency', isInput: true };
    cfCells[`${col}6`] = { raw: `=${col}2-${col}3-${col}4-${col}5`, bold: true, format: 'currency' };
    cfCells[`${col}7`] = prevCol
      ? { raw: `=${prevCol}7+${col}6`, bold: true, format: 'currency' }
      : { raw: `=4850000+${col}6`, bold: true, format: 'currency' };
  });
  cfCells.N1 = { raw: 'FY Total', bold: true, format: 'text' };
  cfCells.N2 = { raw: '=SUM(B2:M2)', format: 'currency' };
  cfCells.N3 = { raw: '=SUM(B3:M3)', format: 'currency' };
  cfCells.N4 = { raw: '=SUM(B4:M4)', format: 'currency' };
  cfCells.N5 = { raw: '=SUM(B5:M5)', format: 'currency' };
  cfCells.N6 = { raw: '=SUM(B6:M6)', bold: true, format: 'currency' };
  cfCells.N7 = { raw: '=M7', bold: true, format: 'currency' };

  // Sheet 5: DCF Valuation
  const dcfCells: Record<string, ModelCell> = {
    A1: { raw: '5-Year Discounted Cash Flow (DCF) Valuation', bold: true, format: 'text' },
    B1: { raw: 'Year 1 (FY26)', bold: true, format: 'text' },
    C1: { raw: 'Year 2 (FY27)', bold: true, format: 'text' },
    D1: { raw: 'Year 3 (FY28)', bold: true, format: 'text' },
    E1: { raw: 'Year 4 (FY29)', bold: true, format: 'text' },
    F1: { raw: 'Year 5 (FY30)', bold: true, format: 'text' },
    G1: { raw: 'Summary', bold: true, format: 'text' },

    A2: { raw: 'Discount Rate (WACC)', format: 'text' },
    B2: { raw: '0.105', format: 'percent', isInput: true },
    A3: { raw: 'Terminal Growth Rate', format: 'text' },
    B3: { raw: '0.03', format: 'percent', isInput: true },
    A4: { raw: 'Annual UFCF Growth Assumption', format: 'text' },
    B4: { raw: '0.22', format: 'percent', isInput: true },

    A6: { raw: 'Projected Unlevered FCF', bold: true, format: 'text' },
    B6: { raw: "='Cash Flow & WC'!N6", format: 'currency' },
    C6: { raw: '=B6*(1+$B4)', format: 'currency' },
    D6: { raw: '=C6*(1+$B4*0.9)', format: 'currency' },
    E6: { raw: '=D6*(1+$B4*0.8)', format: 'currency' },
    F6: { raw: '=E6*(1+$B4*0.7)', format: 'currency' },

    A7: { raw: 'PV of 5-Year Cash Flows (NPV)', bold: true, format: 'text' },
    B7: { raw: '=NPV(B2, B6:F6)', bold: true, format: 'currency' },

    A8: { raw: 'Terminal Value (Gordon Growth)', format: 'text' },
    B8: { raw: '=(F6*(1+B3))/(B2-B3)', format: 'currency' },

    A9: { raw: 'PV of Terminal Value', format: 'text' },
    B9: { raw: '=B8/POWER(1+B2, 5)', format: 'currency' },

    A10: { raw: 'Implied Enterprise Value (EV)', bold: true, format: 'text' },
    B10: { raw: '=B7+B9', bold: true, format: 'currency' },

    A11: { raw: 'Plus: Ending Cash Balance', format: 'text' },
    B11: { raw: "='Cash Flow & WC'!M7", format: 'currency' },

    A12: { raw: 'Less: Long-Term Debt', format: 'text' },
    B12: { raw: '2500000', format: 'currency', isInput: true },

    A13: { raw: 'Implied Equity Value', bold: true, format: 'text' },
    B13: { raw: '=B10+B11-B12', bold: true, format: 'currency' },
  };
  // Clean $B4 -> B4 in DCF since our parser uses standard refs
  dcfCells.C6 = { raw: '=B6*(1+B4)', format: 'currency' };
  dcfCells.D6 = { raw: '=C6*(1+B4*0.9)', format: 'currency' };
  dcfCells.E6 = { raw: '=D6*(1+B4*0.8)', format: 'currency' };
  dcfCells.F6 = { raw: '=E6*(1+B4*0.7)', format: 'currency' };

  return [
    {
      id: 'pl-statement',
      name: 'P&L Statement',
      description: 'Monthly consolidated income statement linked dynamically to Revenue Drivers and OpEx schedules.',
      colHeaders: ['Line Item', ...months, 'FY Total'],
      rowCount: 13,
      colCount: 14,
      cells: plCells,
    },
    {
      id: 'revenue-drivers',
      name: 'Revenue Drivers',
      description: 'Subscription ARR cohorts, advisory services, and monthly churn assumptions.',
      colHeaders: ['Driver Line', ...months, 'FY Total'],
      rowCount: 7,
      colCount: 14,
      cells: revCells,
    },
    {
      id: 'opex-headcount',
      name: 'OpEx & Headcount',
      description: 'Departmental operating expenses, FTE scaling, and restricted executive compensation pool.',
      colHeaders: ['Expense Line', ...months, 'FY Total'],
      rowCount: 8,
      colCount: 14,
      cells: opexCells,
    },
    {
      id: 'cash-flow',
      name: 'Cash Flow & WC',
      description: 'Monthly EBITDA-to-UFCF bridge, working capital movements, and liquidity runway.',
      colHeaders: ['Cash Flow Line', ...months, 'FY Total'],
      rowCount: 7,
      colCount: 14,
      cells: cfCells,
    },
    {
      id: 'dcf-valuation',
      name: 'DCF Valuation',
      description: '5-year unlevered cash flow projection, WACC sensitivity, and Gordon Growth terminal value.',
      colHeaders: ['Valuation Component', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Notes'],
      rowCount: 13,
      colCount: 7,
      cells: dcfCells,
    },
  ];
}

export const INITIAL_CLOSE_TASKS: CloseTask[] = [
  {
    id: 'cl-1',
    phase: 'Pre-Close & Cutoffs',
    title: 'Ingest & Clean ERP Sub-Ledger Batch via Power Query',
    owner: 'Elena Vance (FP&A)',
    dueDay: 'WD +1',
    linkedModule: 'power-query',
    varianceAmount: 0,
    status: 'Signed Off',
    signedOffBy: 'M. Sterling (Controller)',
    signedOffAt: '2026-11-24T10:15:00Z',
    notes: '1,240 raw rows standardized; 22 duplicate TxIDs purged.',
  },
  {
    id: 'cl-2',
    phase: 'Pre-Close & Cutoffs',
    title: 'Verify North America & EMEA Billing Cutoff',
    owner: 'David K. (Revenue Ops)',
    dueDay: 'WD +1',
    linkedModule: 'pivot',
    varianceAmount: 14200,
    status: 'Reconciled',
    notes: 'Two enterprise renewals posted in December cutoff; timing difference reconciled.',
  },
  {
    id: 'cl-3',
    phase: 'Sub-Ledger Reconciliation',
    title: 'Reconcile Cloud Hosting COGS vs AWS/GCP Invoices',
    owner: 'Priya Nair (Accounting)',
    dueDay: 'WD +2',
    linkedModule: 'pivot',
    varianceAmount: -8450,
    status: 'Reconciled',
    notes: 'Compute reserve discount credited; variance within 1.5% threshold.',
  },
  {
    id: 'cl-4',
    phase: 'Sub-Ledger Reconciliation',
    title: 'Audit Missing Cost Center Allocations',
    owner: 'Elena Vance (FP&A)',
    dueDay: 'WD +2',
    linkedModule: 'power-query',
    varianceAmount: 0,
    status: 'Signed Off',
    signedOffBy: 'M. Sterling (Controller)',
    signedOffAt: '2026-11-24T16:40:00Z',
    notes: 'All 32 unmapped GL entries imputed via Power Query cost center rule.',
  },
  {
    id: 'cl-5',
    phase: 'Accruals & Deferrals',
    title: 'Post Executive Bonus & Retention Pool Accrual',
    owner: 'M. Sterling (Controller)',
    dueDay: 'WD +3',
    linkedModule: 'model',
    varianceAmount: -12500,
    status: 'In Progress',
    notes: 'Restricted schedule awaiting Q4 attainment confirmation.',
  },
  {
    id: 'cl-6',
    phase: 'Accruals & Deferrals',
    title: 'M&A Legal Retainer & Deferred Revenue Waterfall',
    owner: 'M. Sterling (Controller)',
    dueDay: 'WD +3',
    linkedModule: 'model',
    varianceAmount: 22000,
    status: 'In Progress',
    notes: 'Verify advisory milestone recognition schedule.',
  },
  {
    id: 'cl-7',
    phase: 'Executive Review & Sign-Off',
    title: 'Management Variance Bridge & Forecast Calibration',
    owner: 'Elena Vance (FP&A)',
    dueDay: 'WD +4',
    linkedModule: 'dashboard',
    varianceAmount: 48900,
    status: 'Not Started',
    notes: 'Final review of consolidated EBITDA margin and UFCF forecast before period lock.',
  },
  {
    id: 'cl-8',
    phase: 'Executive Review & Sign-Off',
    title: 'Lock Fiscal Period (FY 2026 · November)',
    owner: 'CFO / Controller',
    dueDay: 'WD +5',
    linkedModule: 'dashboard',
    varianceAmount: 0,
    status: 'Not Started',
    notes: 'Requires Controller or Admin authorization to freeze November actuals.',
  },
];

export const INITIAL_CUSTOM_REPORTS: SavedCustomReport[] = [
  {
    id: 'rep-exec-board',
    name: 'Board Monthly Financial Package',
    description: 'Consolidated Revenue, EBITDA Margin trajectory, and Regional Contribution for executive review.',
    ownerRole: 'Admin',
    createdAt: '2026-11-20T09:00:00Z',
    updatedAt: '2026-11-25T14:20:00Z',
    widgets: [
      {
        id: 'w-1',
        title: 'Monthly Revenue vs Budget Trajectory',
        subtitle: 'Consolidated recognized revenue across all entities (Jan–Nov 2026)',
        chartType: 'area',
        dimension: 'month',
        metric: 'revenue',
        showBudgetOverlay: true,
        scenario: 'Base',
      },
      {
        id: 'w-2',
        title: 'Regional Budget Variance Analysis',
        subtitle: 'Favorable vs unfavorable net variance by operating region',
        chartType: 'bar',
        dimension: 'region',
        metric: 'variance',
        showBudgetOverlay: false,
        scenario: 'Base',
      },
    ],
  },
  {
    id: 'rep-dept-opex',
    name: 'Departmental OpEx & Cost Discipline',
    description: 'Department-level actual spend vs plan to support monthly close sign-off.',
    ownerRole: 'Controller',
    createdAt: '2026-11-22T11:30:00Z',
    updatedAt: '2026-11-25T12:10:00Z',
    widgets: [
      {
        id: 'w-3',
        title: 'Operating Spend by Department',
        subtitle: 'Actual vs budget across Sales, R&D, G&A, and Customer Success',
        chartType: 'bar',
        dimension: 'department',
        metric: 'opex',
        showBudgetOverlay: true,
        scenario: 'Base',
      },
      {
        id: 'w-4',
        title: 'Quarterly EBITDA Margin Bridge',
        subtitle: 'Sequential operating leverage progression by fiscal quarter',
        chartType: 'waterfall',
        dimension: 'quarter',
        metric: 'ebitda',
        showBudgetOverlay: false,
        scenario: 'Base',
      },
    ],
  },
];
