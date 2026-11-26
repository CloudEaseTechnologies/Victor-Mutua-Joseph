import crypto from 'crypto';
import {
  AuditLogEntry,
  CleanedLedgerRow,
  ModelSheet,
  PermissionAction,
  RolePermissionMatrix,
  UserRole,
} from '../src/types/finance';

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export const DEFAULT_RBAC_MATRIX: RolePermissionMatrix = {
  Admin: {
    view_dashboard: true,
    view_sensitive_payroll: true,
    edit_formulas: true,
    run_power_query: true,
    edit_close_tasks: true,
    lock_period: true,
    manage_reports: true,
    export_unredacted: true,
    manage_rbac: true,
  },
  Controller: {
    view_dashboard: true,
    view_sensitive_payroll: true,
    edit_formulas: true,
    run_power_query: true,
    edit_close_tasks: true,
    lock_period: true,
    manage_reports: true,
    export_unredacted: true,
    manage_rbac: false,
  },
  Analyst: {
    view_dashboard: true,
    view_sensitive_payroll: false,
    edit_formulas: true,
    run_power_query: true,
    edit_close_tasks: false,
    lock_period: false,
    manage_reports: true,
    export_unredacted: false,
    manage_rbac: false,
  },
  Viewer: {
    view_dashboard: true,
    view_sensitive_payroll: false,
    edit_formulas: false,
    run_power_query: false,
    edit_close_tasks: false,
    lock_period: false,
    manage_reports: false,
    export_unredacted: false,
    manage_rbac: false,
  },
};

export interface TokenPayload {
  role: UserRole;
  actorName: string;
  actorEmail: string;
  iat: number;
  exp: number;
}

export function signSessionToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000);
  const full: TokenPayload = {
    ...payload,
    iat: now,
    exp: now + 60 * 60 * 12, // 12 hours
  };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | undefined): TokenPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPasscodeHash(passcode: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(passcode, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function verifyPlainPasscodeConstantTime(input: string, target: string): boolean {
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(target).digest();
  return crypto.timingSafeEqual(a, b);
}

export function redactLedgerForRole(
  rows: CleanedLedgerRow[],
  role: UserRole,
  matrix: RolePermissionMatrix,
): CleanedLedgerRow[] {
  const canViewSensitive = matrix[role]?.view_sensitive_payroll ?? false;
  if (canViewSensitive) return rows;

  return rows.map((row) => {
    if (!row.isSensitive) return row;
    return {
      ...row,
      accountName: '[RESTRICTED — EXECUTIVE COMP / M&A]',
      amount: 0,
      budget: 0,
      variance: 0,
      redacted: true,
      notes: 'Redacted by server-side RBAC policy',
    };
  });
}

export function redactModelForRole(
  sheets: ModelSheet[],
  role: UserRole,
  matrix: RolePermissionMatrix,
): ModelSheet[] {
  const canViewSensitive = matrix[role]?.view_sensitive_payroll ?? false;
  if (canViewSensitive) return sheets;

  return sheets.map((sheet) => {
    const nextCells = { ...sheet.cells };
    for (const [key, cell] of Object.entries(nextCells)) {
      if (cell.isSensitive) {
        nextCells[key] = {
          ...cell,
          raw: '[REDACTED]',
          note: 'Restricted to Controller & Admin roles',
        };
      }
    }
    return {
      ...sheet,
      cells: nextCells,
    };
  });
}

export function createAuditEntry(
  actorRole: UserRole,
  actorName: string,
  action: string,
  target: string,
  outcome: 'Allowed' | 'Denied',
  details: string,
): AuditLogEntry {
  return {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    actorRole,
    actorName,
    action,
    target,
    outcome,
    details,
  };
}
