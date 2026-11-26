export type UserRole = 'Admin' | 'Controller' | 'Analyst' | 'Viewer';

export type PermissionAction =
  | 'view_dashboard'
  | 'view_sensitive_payroll'
  | 'edit_formulas'
  | 'run_power_query'
  | 'edit_close_tasks'
  | 'lock_period'
  | 'manage_reports'
  | 'export_unredacted'
  | 'manage_rbac';

export type RolePermissionMatrix = Record<UserRole, Record<PermissionAction, boolean>>;

export interface AuthSession {
  token: string;
  role: UserRole;
  actorName: string;
  actorEmail: string;
  adminClaimed: boolean;
  envPasscodeConfigured: boolean;
  permissions: Record<PermissionAction, boolean>;
}

export interface RawLedgerRow {
  id: string;
  txId: string;
  rawDate: string;
  entity: string;
  region: string;
  department: string;
  accountCategory: string;
  accountName: string;
  customerSegment: string;
  rawAmount: string;
  budgetRaw: string;
  units: string;
  costCenter: string;
  status: string;
  isSensitive?: boolean;
  notes?: string;
}

export interface CleanedLedgerRow {
  id: string;
  txId: string;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  quarter: string; // 2026 Q1
  entity: string;
  region: string;
  department: string;
  accountCategory: 'Revenue' | 'COGS' | 'OpEx' | 'Payroll' | 'CapEx' | 'Other';
  accountName: string;
  customerSegment: string;
  amount: number;
  budget: number;
  variance: number;
  units: number;
  costCenter: string;
  status: 'Posted' | 'Accrued' | 'Pending Review';
  isSensitive: boolean;
  redacted?: boolean;
  notes: string;
  anomaliesFixed: string[];
}

export type PowerQueryStepType =
  | 'trim_clean'
  | 'standardize_dates'
  | 'parse_currency'
  | 'remove_duplicates'
  | 'impute_cost_centers'
  | 'normalize_categories'
  | 'add_variance_column'
  | 'filter_status'
  | 'replace_value';

export interface PowerQueryStep {
  id: string;
  type: PowerQueryStepType;
  label: string;
  enabled: boolean;
  config?: {
    field?: string;
    findValue?: string;
    replaceWith?: string;
    filterValue?: string;
  };
}

export interface PowerQueryStepMetrics {
  stepId: string;
  rowsIn: number;
  rowsOut: number;
  changesApplied: number;
  durationMs: number;
}

export interface PowerQueryExecutionResult {
  cleanedRows: CleanedLedgerRow[];
  metrics: PowerQueryStepMetrics[];
  mCode: string;
  totalAnomaliesFixed: number;
  duplicatesRemoved: number;
}

export type CellFormat = 'currency' | 'percent' | 'number' | 'text' | 'integer';

export interface ModelCell {
  raw: string; // Either literal value or formula starting with '='
  format?: CellFormat;
  bold?: boolean;
  isInput?: boolean;
  isSensitive?: boolean;
  note?: string;
}

export interface ModelSheet {
  id: string;
  name: string;
  description: string;
  colHeaders: string[]; // e.g., ['Line Item', 'Jan', 'Feb', ...]
  rowCount: number;
  colCount: number;
  cells: Record<string, ModelCell>; // key: "A1", "B4", etc.
}

export type ScenarioName = 'Base' | 'Upside' | 'Downside';

export interface FormulaStepTrace {
  step: number;
  expression: string;
  evaluated: string;
  detail: string;
}

export interface EvaluatedCell {
  value: number | string | null;
  error?: string;
  formatted: string;
  isFormula: boolean;
  steps: FormulaStepTrace[];
  precedents: string[];
}

export type PivotAggregation = 'SUM' | 'AVERAGE' | 'COUNT' | 'MIN' | 'MAX' | 'PCT_TOTAL' | 'PCT_ROW';

export interface PivotConfig {
  rowField: keyof CleanedLedgerRow;
  colField: keyof CleanedLedgerRow | 'NONE';
  valueField: 'amount' | 'budget' | 'variance' | 'units';
  aggregation: PivotAggregation;
  filters: {
    region?: string;
    accountCategory?: string;
    status?: string;
  };
  sortBy: 'label' | 'total_desc' | 'total_asc';
}

export interface PivotCell {
  rawValue: number;
  displayValue: number;
  recordIds: string[];
  count: number;
}

export interface PivotResult {
  rowKeys: string[];
  colKeys: string[];
  matrix: Record<string, Record<string, PivotCell>>;
  rowTotals: Record<string, PivotCell>;
  colTotals: Record<string, PivotCell>;
  grandTotal: PivotCell;
}

export type ChartVisualType = 'area' | 'bar' | 'line' | 'waterfall';

export interface CustomReportWidget {
  id: string;
  title: string;
  subtitle: string;
  chartType: ChartVisualType;
  dimension: 'month' | 'quarter' | 'region' | 'department' | 'customerSegment' | 'accountCategory';
  metric: 'revenue' | 'ebitda' | 'opex' | 'netIncome' | 'variance' | 'budgetVsActual';
  showBudgetOverlay: boolean;
  scenario: ScenarioName;
}

export interface SavedCustomReport {
  id: string;
  name: string;
  description: string;
  ownerRole: UserRole;
  createdAt: string;
  updatedAt: string;
  widgets: CustomReportWidget[];
}

export interface CloseTask {
  id: string;
  phase: 'Pre-Close & Cutoffs' | 'Sub-Ledger Reconciliation' | 'Accruals & Deferrals' | 'Executive Review & Sign-Off';
  title: string;
  owner: string;
  dueDay: string;
  linkedModule: 'model' | 'power-query' | 'pivot' | 'dashboard';
  varianceAmount: number;
  status: 'Not Started' | 'In Progress' | 'Reconciled' | 'Signed Off';
  signedOffBy?: string;
  signedOffAt?: string;
  notes: string;
}

export interface FiscalPeriodState {
  periodLabel: string; // e.g. "FY 2026 · November"
  isLocked: boolean;
  lockedBy?: string;
  lockedAt?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorRole: UserRole;
  actorName: string;
  action: string;
  target: string;
  outcome: 'Allowed' | 'Denied';
  details: string;
}
