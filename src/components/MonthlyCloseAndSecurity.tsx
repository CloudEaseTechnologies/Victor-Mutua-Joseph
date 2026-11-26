import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  Shield,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import {
  AuditLogEntry,
  AuthSession,
  CloseTask,
  FiscalPeriodState,
  PermissionAction,
  RolePermissionMatrix,
  UserRole,
} from '../types/finance';

interface MonthlyCloseAndSecurityProps {
  session: AuthSession;
  closeTasks: CloseTask[];
  fiscalPeriod: FiscalPeriodState;
  rbacMatrix: RolePermissionMatrix;
  auditLog: AuditLogEntry[];
  onUpdateCloseTask: (id: string, status: CloseTask['status'], notes?: string) => Promise<void>;
  onTogglePeriodLock: (locked: boolean) => Promise<void>;
  onClaimAdmin: (passcode: string) => Promise<void>;
  onElevateRole: (role: 'Admin' | 'Controller', passcode: string) => Promise<void>;
  onSwitchRole: (role: UserRole) => Promise<void>;
  onUpdateRbacPolicy: (role: UserRole, action: PermissionAction, enabled: boolean) => Promise<void>;
  onNavigateTab: (tab: 'dashboard' | 'model' | 'power-query' | 'pivot' | 'reports' | 'close') => void;
}

const PERMISSION_LABELS: Array<{ action: PermissionAction; label: string; desc: string }> = [
  { action: 'view_dashboard', label: 'View Dashboards', desc: 'Access executive KPIs & non-restricted reports' },
  { action: 'view_sensitive_payroll', label: 'View Sensitive Comp & M&A', desc: 'Unmask executive bonus & M&A ledger rows' },
  { action: 'edit_formulas', label: 'Edit Model Formulas', desc: 'Modify drivers and multi-step Excel formulas' },
  { action: 'run_power_query', label: 'Execute Power Query ETL', desc: 'Upload raw datasets & edit cleaning steps' },
  { action: 'edit_close_tasks', label: 'Reconcile & Sign Off Close', desc: 'Update monthly close checklist status' },
  { action: 'lock_period', label: 'Lock / Unlock Fiscal Period', desc: 'Freeze closed period actuals for audit' },
  { action: 'manage_reports', label: 'Save & Delete Custom Reports', desc: 'Persist stakeholder trend report views' },
  { action: 'export_unredacted', label: 'Export Unredacted .XLSX', desc: 'Include sensitive compensation in Excel exports' },
  { action: 'manage_rbac', label: 'Configure RBAC Matrix', desc: 'Modify role permissions across the workspace' },
];

export const MonthlyCloseAndSecurity: React.FC<MonthlyCloseAndSecurityProps> = ({
  session,
  closeTasks,
  fiscalPeriod,
  rbacMatrix,
  auditLog,
  onUpdateCloseTask,
  onTogglePeriodLock,
  onClaimAdmin,
  onElevateRole,
  onSwitchRole,
  onUpdateRbacPolicy,
  onNavigateTab,
}) => {
  const [subTab, setSubTab] = useState<'close' | 'rbac'>('close');
  const [claimPasscode, setClaimPasscode] = useState('');
  const [showClaimPasscode, setShowClaimPasscode] = useState(false);
  const [copiedPasscode, setCopiedPasscode] = useState(false);
  const [elevatePasscode, setElevatePasscode] = useState('');
  const [targetElevateRole, setTargetElevateRole] = useState<'Admin' | 'Controller'>('Admin');
  const [authBusy, setAuthBusy] = useState(false);

  const generateClientPasscode = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    const generated = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    setClaimPasscode(generated);
    setShowClaimPasscode(true);
    setCopiedPasscode(false);
  };

  const copyGeneratedPasscode = async () => {
    if (!claimPasscode) return;
    await navigator.clipboard.writeText(claimPasscode);
    setCopiedPasscode(true);
    setTimeout(() => setCopiedPasscode(false), 1800);
  };

  const phases: CloseTask['phase'][] = [
    'Pre-Close & Cutoffs',
    'Sub-Ledger Reconciliation',
    'Accruals & Deferrals',
    'Executive Review & Sign-Off',
  ];

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (claimPasscode.trim().length < 6) return;
    setAuthBusy(true);
    try {
      await onClaimAdmin(claimPasscode.trim());
      setClaimPasscode('');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleElevate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!elevatePasscode.trim()) return;
    setAuthBusy(true);
    try {
      await onElevateRole(targetElevateRole, elevatePasscode.trim());
      setElevatePasscode('');
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Monthly Close &amp; Access Governance
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {fiscalPeriod.periodLabel} · Active Role: {session.role} ({session.actorName}) ·{' '}
            {session.permissions.view_sensitive_payroll ? 'Unmasked Sensitive Data' : 'Sensitive Rows Server-Redacted'}
          </p>
        </div>

        <div className="flex items-center rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setSubTab('close')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'close'
                ? 'bg-slate-900 text-white dark:bg-teal-600'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            Monthly Close Checklist
          </button>
          <button
            type="button"
            onClick={() => setSubTab('rbac')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'rbac'
                ? 'bg-slate-900 text-white dark:bg-teal-600'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            User Access Controls &amp; Audit
          </button>
        </div>
      </div>

      {subTab === 'close' ? (
        <div className="space-y-4">
          {/* Period Lock Banner */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              {fiscalPeriod.isLocked ? (
                <Lock className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
              ) : (
                <Unlock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              )}
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {fiscalPeriod.periodLabel} — {fiscalPeriod.isLocked ? 'Period Locked & Frozen' : 'Close Period Open'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {fiscalPeriod.isLocked
                    ? `Locked by ${fiscalPeriod.lockedBy} · Formula overrides and close edits are frozen`
                    : 'Reconcile variances and sign off tasks before freezing actuals'}
                </div>
              </div>
            </div>

            {session.permissions.lock_period ? (
              <button
                type="button"
                onClick={() => onTogglePeriodLock(!fiscalPeriod.isLocked)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 ${
                  fiscalPeriod.isLocked
                    ? 'bg-amber-700 hover:bg-amber-800'
                    : 'bg-emerald-700 hover:bg-emerald-800'
                }`}
              >
                {fiscalPeriod.isLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                {fiscalPeriod.isLocked ? 'Reopen Fiscal Period' : 'Lock Fiscal Period'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSubTab('rbac')}
                className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400 whitespace-nowrap shrink-0"
              >
                Elevate to Controller / Admin to Lock
              </button>
            )}
          </div>

          {/* 4-Phase Close Table */}
          {phases.map((phase) => {
            const tasks = closeTasks.filter((t) => t.phase === phase);
            return (
              <div
                key={phase}
                className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-semibold text-slate-800 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200">
                  {phase}
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {tasks.map((task) => (
                    <div key={task.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
                      <div className="min-w-[260px] flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{task.title}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {task.owner} · Due {task.dueDay} · {task.notes}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-4">
                        <div className="text-right">
                          <div className="text-[10px] text-slate-400">Variance</div>
                          <div
                            className={`font-mono text-xs tabular-nums font-medium ${
                              task.varianceAmount === 0
                                ? 'text-slate-500'
                                : task.varianceAmount > 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-rose-700 dark:text-rose-400'
                            }`}
                          >
                            {task.varianceAmount === 0
                              ? '$0'
                              : `$${task.varianceAmount.toLocaleString('en-US')}`}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onNavigateTab(task.linkedModule)}
                          className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400 whitespace-nowrap shrink-0"
                        >
                          Open Linked View
                        </button>

                        <select
                          value={task.status}
                          disabled={!session.permissions.edit_close_tasks || fiscalPeriod.isLocked}
                          onChange={(e) =>
                            onUpdateCloseTask(task.id, e.target.value as CloseTask['status'])
                          }
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        >
                          <option value="Not Started">Not Started</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Reconciled">Reconciled</option>
                          <option value="Signed Off">Signed Off</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Role Session & Elevation Panel */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Shield className="h-4 w-4 text-teal-700 dark:text-teal-400" />
                Session Identity &amp; Role Verification
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {session.actorName} ({session.role})
                </div>
                <div className="mt-0.5 text-slate-500 dark:text-slate-400">{session.actorEmail}</div>
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <CheckCircle2 className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400" />
                  Server-verified HMAC Bearer token active in memory
                </div>
              </div>

              {/* Safe Role Switcher */}
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Test / Switch Workspace Role
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['Viewer', 'Analyst', 'Controller', 'Admin'] as UserRole[]).map((role) => {
                    const isCurrent = session.role === role;
                    const needsPasscode =
                      (role === 'Admin' || role === 'Controller') &&
                      session.role !== 'Admin' &&
                      session.role !== 'Controller';
                    return (
                      <button
                        key={role}
                        type="button"
                        disabled={isCurrent || needsPasscode}
                        onClick={() => onSwitchRole(role)}
                        className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                          isCurrent
                            ? 'border-teal-700 bg-teal-50/50 font-semibold text-teal-800 dark:border-teal-500 dark:bg-teal-950/40 dark:text-teal-300'
                            : needsPasscode
                              ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-600'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                        }`}
                      >
                        <div>{role}</div>
                        <div className="text-[10px] opacity-75">
                          {isCurrent ? 'Active' : needsPasscode ? 'Requires Passcode' : 'Switch Role'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Inline First-Run Admin Claim OR Passcode Elevation */}
              {!session.adminClaimed ? (
                <form
                  onSubmit={handleClaim}
                  className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                      <KeyRound className="h-3.5 w-3.5 text-teal-700" />
                      First-Run Admin Setup
                    </div>
                    <button
                      type="button"
                      onClick={generateClientPasscode}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-400"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Generate Passcode
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Choose or generate an Admin passcode (salted &amp; hashed via scrypt on the server), or configure{' '}
                    <code className="font-mono">ADMIN_PASSCODE</code> in Settings → Secrets.
                  </p>
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <input
                        type={showClaimPasscode ? 'text' : 'password'}
                        value={claimPasscode}
                        onChange={(e) => setClaimPasscode(e.target.value)}
                        placeholder="New passcode (min 6 chars)"
                        className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-2.5 pr-14 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
                        {claimPasscode && (
                          <button
                            type="button"
                            onClick={copyGeneratedPasscode}
                            title="Copy passcode"
                            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          >
                            {copiedPasscode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowClaimPasscode((v) => !v)}
                          title={showClaimPasscode ? 'Hide passcode' : 'Show passcode'}
                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        >
                          {showClaimPasscode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={authBusy || claimPasscode.trim().length < 6}
                      className="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      Claim Admin
                    </button>
                  </div>
                </form>
              ) : (
                session.role !== 'Admin' && (
                  <form
                    onSubmit={handleElevate}
                    className="space-y-2.5 rounded-md border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950/60"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                      <ShieldCheck className="h-3.5 w-3.5 text-teal-700" />
                      Elevate to Privileged Role
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={targetElevateRole}
                        onChange={(e) => setTargetElevateRole(e.target.value as 'Admin' | 'Controller')}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="Admin">Admin</option>
                        <option value="Controller">Controller</option>
                      </select>
                      <input
                        type="password"
                        value={elevatePasscode}
                        onChange={(e) => setElevatePasscode(e.target.value)}
                        placeholder="Enter passcode"
                        className="flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="submit"
                        disabled={authBusy || !elevatePasscode}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-teal-600 whitespace-nowrap shrink-0"
                      >
                        Unlock
                      </button>
                    </div>
                  </form>
                )
              )}
            </div>

            {/* RBAC Permissions Matrix */}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:col-span-7">
              <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Role-Based Access Control Matrix
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Enforced server-side on API routes and Excel exports ·{' '}
                  {session.permissions.manage_rbac ? 'Admin editing enabled' : 'Read-only unless Admin'}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5">Capability</th>
                      {(['Admin', 'Controller', 'Analyst', 'Viewer'] as UserRole[]).map((r) => (
                        <th key={r} className="px-3 py-2.5 text-center">
                          {r}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {PERMISSION_LABELS.map((perm) => (
                      <tr key={perm.action} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900 dark:text-slate-100">{perm.label}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">{perm.desc}</div>
                        </td>
                        {(['Admin', 'Controller', 'Analyst', 'Viewer'] as UserRole[]).map((r) => {
                          const enabled = rbacMatrix[r]?.[perm.action] ?? false;
                          const disabled = !session.permissions.manage_rbac || (r === 'Admin' && perm.action === 'manage_rbac');
                          return (
                            <td key={r} className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={enabled}
                                disabled={disabled}
                                onChange={(e) => onUpdateRbacPolicy(r, perm.action, e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 disabled:opacity-60"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Security Audit Log */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Security &amp; Compliance Audit Trail
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Immutable log of role changes, formula mutations, ETL executions, and restricted access checks
              </p>
            </div>
            <div className="max-h-[320px] overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5">Timestamp (UTC)</th>
                    <th className="px-3 py-2.5">Actor &amp; Role</th>
                    <th className="px-3 py-2.5">Action</th>
                    <th className="px-3 py-2.5">Target</th>
                    <th className="px-3 py-2.5">Outcome</th>
                    <th className="px-4 py-2.5">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {auditLog.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-2 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {entry.timestamp.replace('T', ' ').slice(0, 19)}
                      </td>
                      <td className="px-3 py-2 text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {entry.actorName} · {entry.actorRole}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                        {entry.action}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{entry.target}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`text-[11px] font-semibold ${
                            entry.outcome === 'Allowed'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {entry.outcome}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">{entry.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
