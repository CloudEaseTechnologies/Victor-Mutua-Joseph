import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { createServer as createViteServer } from 'vite';
import {
  buildInitialModelSheets,
  DEFAULT_POWER_QUERY_STEPS,
  generateRawLedgerDataset,
  INITIAL_CLOSE_TASKS,
  INITIAL_CUSTOM_REPORTS,
} from './server/dataSeed.ts';
import {
  createAuditEntry,
  DEFAULT_RBAC_MATRIX,
  hashPasscode,
  redactLedgerForRole,
  redactModelForRole,
  signSessionToken,
  verifyPasscodeHash,
  verifyPlainPasscodeConstantTime,
  verifySessionToken,
} from './server/security.ts';
import { evaluateWorkbook } from './src/engine/formulaEngine.ts';
import { executePowerQuery } from './src/engine/powerQueryEngine.ts';
import {
  AuditLogEntry,
  CloseTask,
  FiscalPeriodState,
  ModelSheet,
  PermissionAction,
  PowerQueryStep,
  RawLedgerRow,
  RolePermissionMatrix,
  SavedCustomReport,
  ScenarioName,
  UserRole,
} from './src/types/finance.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '.data');
const STATE_FILE = path.join(DATA_DIR, 'workspace-state.json');

interface PersistedState {
  adminPasscodeHash: string | null;
  rbacMatrix: RolePermissionMatrix;
  modelSheets: ModelSheet[];
  pqSteps: PowerQueryStep[];
  rawRows: RawLedgerRow[];
  closeTasks: CloseTask[];
  fiscalPeriod: FiscalPeriodState;
  customReports: SavedCustomReport[];
  auditLog: AuditLogEntry[];
}

function loadOrInitializeState(): PersistedState {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return {
        adminPasscodeHash: parsed.adminPasscodeHash ?? null,
        rbacMatrix: parsed.rbacMatrix ?? DEFAULT_RBAC_MATRIX,
        modelSheets: parsed.modelSheets ?? buildInitialModelSheets(),
        pqSteps: parsed.pqSteps ?? DEFAULT_POWER_QUERY_STEPS,
        rawRows: parsed.rawRows ?? generateRawLedgerDataset(),
        closeTasks: parsed.closeTasks ?? INITIAL_CLOSE_TASKS,
        fiscalPeriod: parsed.fiscalPeriod ?? {
          periodLabel: 'FY 2026 · November',
          isLocked: false,
        },
        customReports: parsed.customReports ?? INITIAL_CUSTOM_REPORTS,
        auditLog: parsed.auditLog ?? [],
      };
    } catch {
      // Fall back to fresh seed if state file is corrupted
    }
  }
  const initial: PersistedState = {
    adminPasscodeHash: null,
    rbacMatrix: DEFAULT_RBAC_MATRIX,
    modelSheets: buildInitialModelSheets(),
    pqSteps: DEFAULT_POWER_QUERY_STEPS,
    rawRows: generateRawLedgerDataset(),
    closeTasks: INITIAL_CLOSE_TASKS,
    fiscalPeriod: {
      periodLabel: 'FY 2026 · November',
      isLocked: false,
    },
    customReports: INITIAL_CUSTOM_REPORTS,
    auditLog: [
      createAuditEntry(
        'Controller',
        'M. Sterling',
        'INITIALIZE_WORKSPACE',
        'FY 2026 · November',
        'Allowed',
        'Loaded 1,240 ERP journal rows and 5-sheet financial model',
      ),
    ],
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(initial), 'utf8');
  return initial;
}

let state = loadOrInitializeState();
let pqCache = executePowerQuery(state.rawRows, state.pqSteps);

function saveState() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8');
}

function logAudit(
  actorRole: UserRole,
  actorName: string,
  action: string,
  target: string,
  outcome: 'Allowed' | 'Denied',
  details: string,
) {
  state.auditLog.unshift(createAuditEntry(actorRole, actorName, action, target, outcome, details));
  if (state.auditLog.length > 250) {
    state.auditLog = state.auditLog.slice(0, 250);
  }
  saveState();
}

interface AuthedRequest extends Request {
  userRole: UserRole;
  actorName: string;
  actorEmail: string;
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication token required' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session token' });
    return;
  }
  (req as AuthedRequest).userRole = payload.role;
  (req as AuthedRequest).actorName = payload.actorName;
  (req as AuthedRequest).actorEmail = payload.actorEmail;
  next();
}

function requirePermission(action: PermissionAction) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authed = req as AuthedRequest;
    const allowed = state.rbacMatrix[authed.userRole]?.[action] ?? false;
    if (!allowed) {
      logAudit(
        authed.userRole,
        authed.actorName,
        `DENIED_${action.toUpperCase()}`,
        req.path,
        'Denied',
        `Role ${authed.userRole} lacks permission "${action}"`,
      );
      res.status(403).json({
        error: `Access denied: role "${authed.userRole}" does not have "${action}" permission.`,
      });
      return;
    }
    next();
  };
}

function getEnvPasscode(): string {
  return (process.env.ADMIN_PASSCODE || '').trim();
}

function isAdminClaimed(): boolean {
  return Boolean(getEnvPasscode()) || Boolean(state.adminPasscodeHash);
}

function verifyAdminSecret(passcode: string): boolean {
  const envPass = getEnvPasscode();
  if (envPass) {
    return verifyPlainPasscodeConstantTime(passcode, envPass);
  }
  if (state.adminPasscodeHash) {
    return verifyPasscodeHash(passcode, state.adminPasscodeHash);
  }
  return false;
}

function defaultActorForRole(role: UserRole): { name: string; email: string } {
  switch (role) {
    case 'Admin':
      return { name: 'Victor Mutua Joseph (Admin)', email: 'v.mutua@meridianledger.io' };
    case 'Controller':
      return { name: 'Marcus Sterling (Controller)', email: 'm.sterling@meridianledger.io' };
    case 'Analyst':
      return { name: 'Elena Vance (FP&A)', email: 'e.vance@meridianledger.io' };
    case 'Viewer':
    default:
      return { name: 'Board Stakeholder', email: 'stakeholder@meridianledger.io' };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  // Bootstrap anonymous-safe Analyst preview session (sensitive fields stay server-redacted until Controller/Admin elevation)
  app.post('/api/auth/session', (_req: Request, res: Response) => {
    const role: UserRole = 'Analyst';
    const actor = defaultActorForRole(role);
    const token = signSessionToken({
      role,
      actorName: actor.name,
      actorEmail: actor.email,
    });
    res.json({
      token,
      role,
      actorName: actor.name,
      actorEmail: actor.email,
      adminClaimed: isAdminClaimed(),
      envPasscodeConfigured: Boolean(getEnvPasscode()),
      permissions: state.rbacMatrix[role],
    });
  });

  // First-run inline admin claim (locks permanently once claimed or if ADMIN_PASSCODE env is set)
  app.post('/api/auth/claim-admin', authMiddleware, (req: Request, res: Response) => {
    const authed = req as AuthedRequest;
    if (isAdminClaimed()) {
      res.status(409).json({ error: 'Admin access is already configured. Please verify with passcode.' });
      return;
    }
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    if (passcode.length < 6) {
      res.status(400).json({ error: 'Passcode must be at least 6 characters.' });
      return;
    }
    state.adminPasscodeHash = hashPasscode(passcode);
    saveState();

    const actor = defaultActorForRole('Admin');
    const token = signSessionToken({
      role: 'Admin',
      actorName: actor.name,
      actorEmail: actor.email,
    });
    logAudit('Admin', authed.actorName, 'CLAIM_ADMIN_ACCESS', 'RBAC Root', 'Allowed', 'Admin passcode claimed and hashed');
    res.json({
      token,
      role: 'Admin',
      actorName: actor.name,
      actorEmail: actor.email,
      adminClaimed: true,
      envPasscodeConfigured: false,
      permissions: state.rbacMatrix.Admin,
    });
  });

  // Elevate to Admin or Controller via server-verified passcode
  app.post('/api/auth/elevate', authMiddleware, (req: Request, res: Response) => {
    const authed = req as AuthedRequest;
    const targetRole = req.body?.role as UserRole;
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    if (targetRole !== 'Admin' && targetRole !== 'Controller') {
      res.status(400).json({ error: 'Target role must be Admin or Controller.' });
      return;
    }
    if (!isAdminClaimed()) {
      res.status(400).json({ error: 'Admin passcode has not been claimed yet.' });
      return;
    }
    if (!verifyAdminSecret(passcode)) {
      logAudit(authed.userRole, authed.actorName, 'ELEVATE_ROLE', targetRole, 'Denied', 'Invalid passcode supplied');
      res.status(403).json({ error: 'Invalid authorization passcode.' });
      return;
    }
    const actor = defaultActorForRole(targetRole);
    const token = signSessionToken({
      role: targetRole,
      actorName: actor.name,
      actorEmail: actor.email,
    });
    logAudit(targetRole, actor.name, 'ELEVATE_ROLE', targetRole, 'Allowed', `Elevated session to ${targetRole}`);
    res.json({
      token,
      role: targetRole,
      actorName: actor.name,
      actorEmail: actor.email,
      adminClaimed: true,
      envPasscodeConfigured: Boolean(getEnvPasscode()),
      permissions: state.rbacMatrix[targetRole],
    });
  });

  // Switch between roles: Admin/Controller can switch anywhere; Analyst/Viewer can switch to Analyst or Viewer without escalation
  app.post('/api/auth/switch-role', authMiddleware, (req: Request, res: Response) => {
    const authed = req as AuthedRequest;
    const targetRole = req.body?.role as UserRole;
    const validRoles: UserRole[] = ['Admin', 'Controller', 'Analyst', 'Viewer'];
    if (!validRoles.includes(targetRole)) {
      res.status(400).json({ error: 'Invalid role requested.' });
      return;
    }
    const isPrivilegedTarget = targetRole === 'Admin' || targetRole === 'Controller';
    const isCurrentlyPrivileged = authed.userRole === 'Admin' || authed.userRole === 'Controller';
    if (isPrivilegedTarget && !isCurrentlyPrivileged) {
      res.status(403).json({ error: 'Passcode verification required to elevate to Controller or Admin.' });
      return;
    }

    const actor = defaultActorForRole(targetRole);
    const token = signSessionToken({
      role: targetRole,
      actorName: actor.name,
      actorEmail: actor.email,
    });
    logAudit(authed.userRole, authed.actorName, 'SWITCH_ROLE', targetRole, 'Allowed', `Active role changed to ${targetRole}`);
    res.json({
      token,
      role: targetRole,
      actorName: actor.name,
      actorEmail: actor.email,
      adminClaimed: isAdminClaimed(),
      envPasscodeConfigured: Boolean(getEnvPasscode()),
      permissions: state.rbacMatrix[targetRole],
    });
  });

  // Main workspace state endpoint (applies server-side field redaction based on active role)
  app.get('/api/workspace', authMiddleware, (req: Request, res: Response) => {
    const authed = req as AuthedRequest;
    const redactedLedger = redactLedgerForRole(pqCache.cleanedRows, authed.userRole, state.rbacMatrix);
    const redactedModel = redactModelForRole(state.modelSheets, authed.userRole, state.rbacMatrix);

    res.json({
      modelSheets: redactedModel,
      pqSteps: state.pqSteps,
      pqMetrics: pqCache.metrics,
      pqMCode: pqCache.mCode,
      pqStats: {
        rawCount: state.rawRows.length,
        cleanedCount: redactedLedger.length,
        totalAnomaliesFixed: pqCache.totalAnomaliesFixed,
        duplicatesRemoved: pqCache.duplicatesRemoved,
      },
      rawSample: state.rawRows.slice(0, 120),
      cleanedLedger: redactedLedger,
      closeTasks: state.closeTasks,
      fiscalPeriod: state.fiscalPeriod,
      customReports: state.customReports,
      rbacMatrix: state.rbacMatrix,
      auditLog: state.auditLog.slice(0, 60),
    });
  });

  // Update a cell or formula in the financial model
  app.put(
    '/api/model/cell',
    authMiddleware,
    requirePermission('edit_formulas'),
    (req: Request, res: Response) => {
      const authed = req as AuthedRequest;
      if (state.fiscalPeriod.isLocked && authed.userRole !== 'Admin') {
        res.status(423).json({ error: 'Fiscal period is locked. Only Admin can unlock or override cells.' });
        return;
      }
      const { sheetId, cellKey, raw } = req.body as { sheetId?: string; cellKey?: string; raw?: string };
      if (!sheetId || !cellKey || typeof raw !== 'string') {
        res.status(400).json({ error: 'sheetId, cellKey, and raw string are required.' });
        return;
      }
      const sheet = state.modelSheets.find((s) => s.id === sheetId);
      if (!sheet) {
        res.status(404).json({ error: 'Sheet not found.' });
        return;
      }
      const keyUpper = cellKey.toUpperCase();
      if (!/^[A-Z]{1,2}\d{1,3}$/.test(keyUpper)) {
        res.status(400).json({ error: 'Invalid cell reference.' });
        return;
      }
      const existing = sheet.cells[keyUpper];
      if (existing?.isSensitive && !state.rbacMatrix[authed.userRole].view_sensitive_payroll) {
        res.status(403).json({ error: 'Cannot modify restricted compensation cell.' });
        return;
      }
      sheet.cells[keyUpper] = {
        ...existing,
        raw: raw.slice(0, 250),
      };
      saveState();
      logAudit(authed.userRole, authed.actorName, 'EDIT_MODEL_CELL', `${sheet.name}!${keyUpper}`, 'Allowed', `Updated to "${raw.slice(0, 60)}"`);
      res.json({ modelSheets: redactModelForRole(state.modelSheets, authed.userRole, state.rbacMatrix) });
    },
  );

  // Run & persist Power Query pipeline steps (or uploaded raw dataset)
  app.post(
    '/api/power-query/run',
    authMiddleware,
    requirePermission('run_power_query'),
    (req: Request, res: Response) => {
      const authed = req as AuthedRequest;
      const { steps, uploadedRawRows } = req.body as {
        steps?: PowerQueryStep[];
        uploadedRawRows?: RawLedgerRow[];
      };

      if (Array.isArray(steps) && steps.length > 0) {
        state.pqSteps = steps;
      }
      if (Array.isArray(uploadedRawRows) && uploadedRawRows.length > 0) {
        state.rawRows = uploadedRawRows.slice(0, 5000);
      }

      pqCache = executePowerQuery(state.rawRows, state.pqSteps);
      saveState();
      logAudit(
        authed.userRole,
        authed.actorName,
        'RUN_POWER_QUERY',
        'ERP Ledger Pipeline',
        'Allowed',
        `Executed ${state.pqSteps.filter((s) => s.enabled).length} steps across ${state.rawRows.length} rows`,
      );

      const redactedLedger = redactLedgerForRole(pqCache.cleanedRows, authed.userRole, state.rbacMatrix);
      res.json({
        pqSteps: state.pqSteps,
        pqMetrics: pqCache.metrics,
        pqMCode: pqCache.mCode,
        pqStats: {
          rawCount: state.rawRows.length,
          cleanedCount: redactedLedger.length,
          totalAnomaliesFixed: pqCache.totalAnomaliesFixed,
          duplicatesRemoved: pqCache.duplicatesRemoved,
        },
        rawSample: state.rawRows.slice(0, 120),
        cleanedLedger: redactedLedger,
      });
    },
  );

  // Reset raw dataset back to seeded 1,240-row ERP dataset
  app.post(
    '/api/power-query/reset',
    authMiddleware,
    requirePermission('run_power_query'),
    (req: Request, res: Response) => {
      const authed = req as AuthedRequest;
      state.rawRows = generateRawLedgerDataset();
      state.pqSteps = DEFAULT_POWER_QUERY_STEPS;
      pqCache = executePowerQuery(state.rawRows, state.pqSteps);
      saveState();
      logAudit(authed.userRole, authed.actorName, 'RESET_DATASET', 'ERP Ledger', 'Allowed', 'Restored 1,240-row ERP dataset');
      const redactedLedger = redactLedgerForRole(pqCache.cleanedRows, authed.userRole, state.rbacMatrix);
      res.json({
        pqSteps: state.pqSteps,
        pqMetrics: pqCache.metrics,
        pqMCode: pqCache.mCode,
        pqStats: {
          rawCount: state.rawRows.length,
          cleanedCount: redactedLedger.length,
          totalAnomaliesFixed: pqCache.totalAnomaliesFixed,
          duplicatesRemoved: pqCache.duplicatesRemoved,
        },
        rawSample: state.rawRows.slice(0, 120),
        cleanedLedger: redactedLedger,
      });
    },
  );

  // Save custom report
  app.post(
    '/api/reports',
    authMiddleware,
    requirePermission('manage_reports'),
    (req: Request, res: Response) => {
      const authed = req as AuthedRequest;
      const report = req.body as SavedCustomReport;
      if (!report || !report.name || !Array.isArray(report.widgets)) {
        res.status(400).json({ error: 'Report name and widgets are required.' });
        return;
      }
      const now = new Date().toISOString();
      const idx = state.customReports.findIndex((r) => r.id === report.id);
      const saved: SavedCustomReport = {
        ...report,
        id: report.id || `rep-${Date.now()}`,
        ownerRole: authed.userRole,
        createdAt: idx >= 0 ? state.customReports[idx].createdAt : now,
        updatedAt: now,
      };
      if (idx >= 0) {
        state.customReports[idx] = saved;
      } else {
        state.customReports.unshift(saved);
      }
      saveState();
      logAudit(authed.userRole, authed.actorName, 'SAVE_CUSTOM_REPORT', saved.name, 'Allowed', `${saved.widgets.length} widgets`);
      res.json({ customReports: state.customReports, saved });
    },
  );

  // Delete custom report
  app.delete(
    '/api/reports/:id',
    authMiddleware,
    requirePermission('manage_reports'),
    (req: Request, res: Response) => {
      const authed = req as AuthedRequest;
      const { id } = req.params;
      const existing = state.customReports.find((r) => r.id === id);
      if (!existing) {
        res.status(404).json({ error: 'Report not found.' });
        return;
      }
      state.customReports = state.customReports.filter((r) => r.id !== id);
      saveState();
      logAudit(authed.userRole, authed.actorName, 'DELETE_CUSTOM_REPORT', existing.name, 'Allowed', 'Deleted report');
      res.json({ customReports: state.customReports });
    },
  );

  // Update monthly close task
  app.put(
    '/api/close/tasks/:id',
    authMiddleware,
    requirePermission('edit_close_tasks'),
    (req: Request, res: Response) => {
      const authed = req as AuthedRequest;
      if (state.fiscalPeriod.isLocked) {
        res.status(423).json({ error: 'Fiscal period is locked. Unlock period before modifying close tasks.' });
        return;
      }
      const { id } = req.params;
      const task = state.closeTasks.find((t) => t.id === id);
      if (!task) {
        res.status(404).json({ error: 'Close task not found.' });
        return;
      }
      const { status, notes } = req.body as { status?: CloseTask['status']; notes?: string };
      if (status) {
        task.status = status;
        if (status === 'Signed Off') {
          task.signedOffBy = authed.actorName;
          task.signedOffAt = new Date().toISOString();
        }
      }
      if (typeof notes === 'string') {
        task.notes = notes.slice(0, 400);
      }
      saveState();
      logAudit(authed.userRole, authed.actorName, 'UPDATE_CLOSE_TASK', task.title, 'Allowed', `Status set to ${task.status}`);
      res.json({ closeTasks: state.closeTasks });
    },
  );

  // Lock or unlock fiscal period
  app.post(
    '/api/close/period-lock',
    authMiddleware,
    requirePermission('lock_period'),
    (req: Request, res: Response) => {
      const authed = req as AuthedRequest;
      const locked = Boolean(req.body?.locked);
      state.fiscalPeriod = {
        ...state.fiscalPeriod,
        isLocked: locked,
        lockedBy: locked ? authed.actorName : undefined,
        lockedAt: locked ? new Date().toISOString() : undefined,
      };
      saveState();
      logAudit(
        authed.userRole,
        authed.actorName,
        locked ? 'LOCK_FISCAL_PERIOD' : 'UNLOCK_FISCAL_PERIOD',
        state.fiscalPeriod.periodLabel,
        'Allowed',
        locked ? 'Fiscal period frozen for audit' : 'Fiscal period reopened',
      );
      res.json({ fiscalPeriod: state.fiscalPeriod });
    },
  );

  // Update RBAC Matrix (Admin only)
  app.put(
    '/api/rbac/policies',
    authMiddleware,
    requirePermission('manage_rbac'),
    (req: Request, res: Response) => {
      const authed = req as AuthedRequest;
      const { role, action, enabled } = req.body as {
        role?: UserRole;
        action?: PermissionAction;
        enabled?: boolean;
      };
      if (!role || !action || typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'role, action, and enabled boolean required.' });
        return;
      }
      if (role === 'Admin' && action === 'manage_rbac' && !enabled) {
        res.status(400).json({ error: 'Cannot revoke manage_rbac from Admin.' });
        return;
      }
      state.rbacMatrix[role][action] = enabled;
      saveState();
      logAudit(authed.userRole, authed.actorName, 'UPDATE_RBAC_POLICY', `${role}.${action}`, 'Allowed', `Set to ${enabled}`);
      res.json({ rbacMatrix: state.rbacMatrix });
    },
  );

  // Real Multi-Sheet Excel (.xlsx) Workbook Export with Live Formulas
  app.post('/api/export/workbook', authMiddleware, async (req: Request, res: Response) => {
    const authed = req as AuthedRequest;
    const scenario = ((req.body?.scenario as ScenarioName) || 'Base') as ScenarioName;
    const canExportUnredacted = state.rbacMatrix[authed.userRole]?.export_unredacted ?? false;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Meridian Ledger';
    workbook.created = new Date();

    const modelToExport = redactModelForRole(state.modelSheets, authed.userRole, state.rbacMatrix);
    const evaluated = evaluateWorkbook(modelToExport, scenario);

    // Sheet 1: Executive Summary Dashboard Sheet
    const execSheet = workbook.addWorksheet('Executive Summary', {
      views: [{ state: 'frozen', ySplit: 3 }],
    });
    execSheet.getCell('A1').value = `Meridian Ledger — Executive Financial Package (${scenario} Case)`;
    execSheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
    execSheet.getCell('A2').value = `Period: ${state.fiscalPeriod.periodLabel} · Exported by: ${authed.actorName} (${authed.userRole})`;
    execSheet.getCell('A2').font = { size: 10, color: { argb: 'FF64748B' } };

    execSheet.addRow([]);
    const summaryHeader = execSheet.addRow(['Key Performance Metric', 'FY Total / Ending', 'Formula Source', 'Notes']);
    summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summaryHeader.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    });

    const plEval = evaluated['pl-statement'] || {};
    const cfEval = evaluated['cash-flow'] || {};
    const dcfEval = evaluated['dcf-valuation'] || {};
    const summaryRows: Array<[string, number | string, string, string]> = [
      ['Total Consolidated Revenue', Number(plEval.N2?.value ?? 0), "='P&L Statement'!N2", 'Recognized SaaS + Services'],
      ['Gross Profit', Number(plEval.N4?.value ?? 0), "='P&L Statement'!N4", 'After hosting & compute COGS'],
      ['Consolidated EBITDA', Number(plEval.N7?.value ?? 0), "='P&L Statement'!N7", 'Operating cash earnings'],
      ['Net Income', Number(plEval.N12?.value ?? 0), "='P&L Statement'!N12", 'After 21% corporate tax provision'],
      ['Unlevered Free Cash Flow', Number(cfEval.N6?.value ?? 0), "='Cash Flow & WC'!N6", 'After NWC & CapEx'],
      ['Ending Cash Balance', Number(cfEval.N7?.value ?? 0), "='Cash Flow & WC'!N7", 'Period-end liquidity'],
      ['Implied Enterprise Value (DCF)', Number(dcfEval.B10?.value ?? 0), "='DCF Valuation'!B10", '5Y NPV + Terminal Value'],
    ];

    summaryRows.forEach(([label, val, formula, note]) => {
      const row = execSheet.addRow([label, { formula: formula.slice(1), result: Number(val) || 0 }, formula, note]);
      row.getCell(2).numFmt = '$#,##0;($#,##0);"-"';
      row.getCell(1).font = { bold: true };
    });
    execSheet.columns = [{ width: 34 }, { width: 22 }, { width: 26 }, { width: 38 }];

    // Add all Financial Model Sheets with Live Excel Formulas
    for (const sheet of modelToExport) {
      const ws = workbook.addWorksheet(sheet.name, {
        views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
      });

      for (let r = 1; r <= sheet.rowCount; r++) {
        const excelRow = ws.getRow(r);
        for (let c = 0; c < sheet.colCount; c++) {
          const colLetter = String.fromCharCode(65 + c);
          const key = `${colLetter}${r}`;
          const cellDef = sheet.cells[key];
          const evalCell = evaluated[sheet.id]?.[key];
          if (!cellDef) continue;

          const target = excelRow.getCell(c + 1);
          const raw = cellDef.raw;
          if (raw.startsWith('=')) {
            target.value = {
              formula: raw.slice(1),
              result: typeof evalCell?.value === 'number' ? evalCell.value : undefined,
            };
          } else if (raw === '[REDACTED]') {
            target.value = '[REDACTED]';
          } else {
            const num = Number(raw);
            target.value = raw !== '' && !Number.isNaN(num) && cellDef.format !== 'text' ? num : raw;
          }

          if (cellDef.bold || r === 1) {
            target.font = { bold: true, color: r === 1 ? { argb: 'FFFFFFFF' } : { argb: 'FF0F172A' } };
          }
          if (r === 1) {
            target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
          }
          if (cellDef.format === 'currency') {
            target.numFmt = '$#,##0;($#,##0);"-"';
          } else if (cellDef.format === 'percent') {
            target.numFmt = '0.0%';
          } else if (cellDef.format === 'integer') {
            target.numFmt = '#,##0';
          }
        }
      }
      ws.getColumn(1).width = 38;
      for (let c = 2; c <= sheet.colCount; c++) {
        ws.getColumn(c).width = 15;
      }
    }

    // Cleaned Ledger Sheet (Server-redacted unless export_unredacted is true)
    const ledgerRows = canExportUnredacted
      ? pqCache.cleanedRows
      : redactLedgerForRole(pqCache.cleanedRows, authed.userRole, state.rbacMatrix);
    const ledgerSheet = workbook.addWorksheet('Cleaned Ledger', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const lHeader = ledgerSheet.addRow([
      'TxID',
      'Date',
      'Quarter',
      'Entity',
      'Region',
      'Department',
      'Category',
      'Account Name',
      'Segment',
      'Amount',
      'Budget',
      'Variance',
      'Cost Center',
      'Status',
    ]);
    lHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    lHeader.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    });

    for (const r of ledgerRows) {
      const row = ledgerSheet.addRow([
        r.txId,
        r.date,
        r.quarter,
        r.entity,
        r.region,
        r.department,
        r.accountCategory,
        r.accountName,
        r.customerSegment,
        r.redacted ? '[REDACTED]' : r.amount,
        r.redacted ? '[REDACTED]' : r.budget,
        r.redacted ? '[REDACTED]' : r.variance,
        r.costCenter,
        r.status,
      ]);
      if (!r.redacted) {
        row.getCell(10).numFmt = '$#,##0.00;($#,##0.00);"-"';
        row.getCell(11).numFmt = '$#,##0.00;($#,##0.00);"-"';
        row.getCell(12).numFmt = '$#,##0.00;($#,##0.00);"-"';
      }
    }
    ledgerSheet.columns.forEach((col, i) => {
      col.width = i === 7 ? 32 : i === 3 ? 22 : 15;
    });

    logAudit(
      authed.userRole,
      authed.actorName,
      'EXPORT_EXCEL_WORKBOOK',
      `Meridian_Ledger_${scenario}.xlsx`,
      'Allowed',
      `Exported ${workbook.worksheets.length} sheets (${canExportUnredacted ? 'unredacted' : 'RBAC-redacted'})`,
    );

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Meridian_Ledger_${scenario}_FY2026.xlsx"`);
    res.send(Buffer.from(buffer));
  });

  // Vite dev middleware or production static build
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Meridian Ledger server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
