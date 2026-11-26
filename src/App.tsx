import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CheckSquare,
  Database,
  Download,
  FileSpreadsheet,
  LayoutDashboard,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  Table2,
  X,
} from 'lucide-react';
import { CustomReportBuilder } from './components/CustomReportBuilder';
import { DrillDownDrawer } from './components/DrillDownDrawer';
import { ExecutiveDashboard } from './components/ExecutiveDashboard';
import { FinancialModelWorkbook } from './components/FinancialModelWorkbook';
import { MonthlyCloseAndSecurity } from './components/MonthlyCloseAndSecurity';
import { PivotTableBuilder } from './components/PivotTableBuilder';
import { PowerQueryStudio } from './components/PowerQueryStudio';
import { evaluateWorkbook } from './engine/formulaEngine';
import {
  AuditLogEntry,
  AuthSession,
  CleanedLedgerRow,
  CloseTask,
  FiscalPeriodState,
  ModelSheet,
  PermissionAction,
  PowerQueryStep,
  PowerQueryStepMetrics,
  RawLedgerRow,
  RolePermissionMatrix,
  SavedCustomReport,
  ScenarioName,
  UserRole,
} from './types/finance';

type NavTab = 'dashboard' | 'model' | 'power-query' | 'pivot' | 'reports' | 'close';

interface WorkspacePayload {
  modelSheets: ModelSheet[];
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
  closeTasks: CloseTask[];
  fiscalPeriod: FiscalPeriodState;
  customReports: SavedCustomReport[];
  rbacMatrix: RolePermissionMatrix;
  auditLog: AuditLogEntry[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [scenario, setScenario] = useState<ScenarioName>('Base');
  const [darkMode, setDarkMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [session, setSession] = useState<AuthSession | null>(null);
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'info' | 'error'; message: string } | null>(null);

  const [drillState, setDrillState] = useState<{
    isOpen: boolean;
    title: string;
    subtitle: string;
    rows: CleanedLedgerRow[];
  }>({
    isOpen: false,
    title: '',
    subtitle: '',
    rows: [],
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const showToast = useCallback((type: 'info' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  }, []);

  const fetchWorkspace = useCallback(async (token: string) => {
    const res = await fetch('/api/workspace', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to load workspace' }));
      throw new Error(err.error || 'Failed to load workspace');
    }
    const data = (await res.json()) as WorkspacePayload;
    setWorkspace(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/session', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to initialize workspace session');
        const auth = (await res.json()) as AuthSession;
        if (cancelled) return;
        setSession(auth);
        await fetchWorkspace(auth.token);
      } catch (err) {
        if (!cancelled) {
          showToast('error', err instanceof Error ? err.message : 'Initialization failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWorkspace, showToast]);

  const evaluatedModel = useMemo(() => {
    if (!workspace) return {};
    return evaluateWorkbook(workspace.modelSheets, scenario);
  }, [workspace, scenario]);

  const authedFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      if (!session) throw new Error('No active session');
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
          ...(options.headers || {}),
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Request failed');
      }
      return res;
    },
    [session],
  );

  const handleUpdateCell = async (sheetId: string, cellKey: string, raw: string) => {
    try {
      await authedFetch('/api/model/cell', {
        method: 'PUT',
        body: JSON.stringify({ sheetId, cellKey, raw }),
      });
      if (session) await fetchWorkspace(session.token);
      showToast('info', `Updated ${cellKey} and recalculated model dependencies.`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to update cell');
    }
  };

  const handleRunPowerQuery = async (steps: PowerQueryStep[], uploadedRawRows?: RawLedgerRow[]) => {
    try {
      await authedFetch('/api/power-query/run', {
        method: 'POST',
        body: JSON.stringify({ steps, uploadedRawRows }),
      });
      if (session) await fetchWorkspace(session.token);
      showToast('info', 'Power Query pipeline executed and synced to Pivot & Reports.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Power Query execution failed');
    }
  };

  const handleResetDataset = async () => {
    try {
      await authedFetch('/api/power-query/reset', { method: 'POST' });
      if (session) await fetchWorkspace(session.token);
      showToast('info', 'Restored 1,240-row ERP dataset.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Reset failed');
    }
  };

  const handleSaveReport = async (report: SavedCustomReport) => {
    try {
      await authedFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify(report),
      });
      if (session) await fetchWorkspace(session.token);
      showToast('info', `Saved report "${report.name}".`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleDeleteReport = async (id: string) => {
    try {
      await authedFetch(`/api/reports/${id}`, { method: 'DELETE' });
      if (session) await fetchWorkspace(session.token);
      showToast('info', 'Custom report removed.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleUpdateCloseTask = async (id: string, status: CloseTask['status'], notes?: string) => {
    try {
      await authedFetch(`/api/close/tasks/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status, notes }),
      });
      if (session) await fetchWorkspace(session.token);
      showToast('info', `Close task updated to "${status}".`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to update task');
    }
  };

  const handleTogglePeriodLock = async (locked: boolean) => {
    try {
      await authedFetch('/api/close/period-lock', {
        method: 'POST',
        body: JSON.stringify({ locked }),
      });
      if (session) await fetchWorkspace(session.token);
      showToast('info', locked ? 'Fiscal period locked.' : 'Fiscal period reopened.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to change period lock');
    }
  };

  const handleClaimAdmin = async (passcode: string) => {
    try {
      const res = await authedFetch('/api/auth/claim-admin', {
        method: 'POST',
        body: JSON.stringify({ passcode }),
      });
      const nextSession = (await res.json()) as AuthSession;
      setSession(nextSession);
      await fetchWorkspace(nextSession.token);
      showToast('info', 'Admin privileges claimed and verified.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Claim failed');
    }
  };

  const handleElevateRole = async (role: 'Admin' | 'Controller', passcode: string) => {
    try {
      const res = await authedFetch('/api/auth/elevate', {
        method: 'POST',
        body: JSON.stringify({ role, passcode }),
      });
      const nextSession = (await res.json()) as AuthSession;
      setSession(nextSession);
      await fetchWorkspace(nextSession.token);
      showToast('info', `Session elevated to ${role}.`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Elevation failed');
    }
  };

  const handleSwitchRole = async (role: UserRole) => {
    try {
      const res = await authedFetch('/api/auth/switch-role', {
        method: 'POST',
        body: JSON.stringify({ role }),
      });
      const nextSession = (await res.json()) as AuthSession;
      setSession(nextSession);
      await fetchWorkspace(nextSession.token);
      showToast('info', `Active workspace role switched to ${role}.`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Role switch denied');
    }
  };

  const handleUpdateRbacPolicy = async (role: UserRole, action: PermissionAction, enabled: boolean) => {
    try {
      await authedFetch('/api/rbac/policies', {
        method: 'PUT',
        body: JSON.stringify({ role, action, enabled }),
      });
      if (session) await fetchWorkspace(session.token);
      showToast('info', `Updated ${role} permission: ${action}.`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Policy update failed');
    }
  };

  const handleExportWorkbook = async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/export/workbook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ scenario }),
      });
      if (!res.ok) throw new Error('Excel export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Meridian_Ledger_${scenario}_FY2026.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      await fetchWorkspace(session.token);
      showToast('info', `Exported Meridian_Ledger_${scenario}_FY2026.xlsx with live formulas.`);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Export failed');
    }
  };

  const navItems: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'dashboard', label: 'Executive Dashboard', icon: LayoutDashboard },
    { id: 'model', label: 'Financial Model', icon: FileSpreadsheet },
    { id: 'power-query', label: 'Power Query Studio', icon: Database },
    { id: 'pivot', label: 'Pivot & Drill-Down', icon: Table2 },
    { id: 'reports', label: 'Custom Reports', icon: BarChart3 },
    { id: 'close', label: 'Monthly Close & RBAC', icon: CheckSquare },
  ];

  const activeLabel = navItems.find((n) => n.id === activeTab)?.label ?? 'Dashboard';

  if (loading || !workspace || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="w-full max-w-md space-y-3 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden w-[252px] shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <div className="flex h-14 items-center border-b border-slate-200 px-5 dark:border-slate-800">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            Meridian Ledger
          </span>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-teal-600 dark:text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer: Active Role & Theme Switch */}
        <div className="space-y-3 border-t border-slate-200 p-4 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('close')}
            className="flex w-full items-start gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-left hover:border-teal-600/50 dark:border-slate-800 dark:bg-slate-950/60"
          >
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400" />
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                {session.role} Access
              </div>
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {session.actorName}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <span>{darkMode ? 'Dark Workspace' : 'Light Workspace'}</span>
            {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/40" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative z-10 flex w-64 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
              <span className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Meridian Ledger
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation"
                className="p-1 text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-xs font-medium ${
                      active
                        ? 'bg-slate-900 text-white dark:bg-teal-600'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary action on right */}
        <header className="flex h-14 items-center justify-between gap-8 border-b border-slate-200 bg-white px-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="truncate text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-900 dark:text-slate-100">Meridian Ledger</span>
              <span className="mx-2" aria-hidden="true">/</span>
              <span>{activeLabel}</span>
              <span className="mx-2 hidden sm:inline" aria-hidden="true">·</span>
              <span className="hidden sm:inline">{workspace.fiscalPeriod.periodLabel}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleExportWorkbook}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-teal-600 dark:hover:bg-teal-500 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Export Workbook
          </button>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6">
          <div className="mx-auto max-w-[1380px]">
            {activeTab === 'dashboard' && (
              <ExecutiveDashboard
                evaluatedModel={evaluatedModel}
                cleanedLedger={workspace.cleanedLedger}
                closeTasks={workspace.closeTasks}
                fiscalPeriod={workspace.fiscalPeriod}
                scenario={scenario}
                onScenarioChange={setScenario}
                onDrillDown={(title, subtitle, rows) =>
                  setDrillState({ isOpen: true, title, subtitle, rows })
                }
                onNavigateTab={setActiveTab}
              />
            )}

            {activeTab === 'model' && (
              <FinancialModelWorkbook
                sheets={workspace.modelSheets}
                evaluatedModel={evaluatedModel}
                scenario={scenario}
                canEdit={session.permissions.edit_formulas}
                fiscalPeriod={workspace.fiscalPeriod}
                onScenarioChange={setScenario}
                onUpdateCell={handleUpdateCell}
                onExportWorkbook={handleExportWorkbook}
              />
            )}

            {activeTab === 'power-query' && (
              <PowerQueryStudio
                pqSteps={workspace.pqSteps}
                pqMetrics={workspace.pqMetrics}
                pqMCode={workspace.pqMCode}
                pqStats={workspace.pqStats}
                rawSample={workspace.rawSample}
                cleanedLedger={workspace.cleanedLedger}
                canRun={session.permissions.run_power_query}
                onRunPipeline={handleRunPowerQuery}
                onResetDataset={handleResetDataset}
              />
            )}

            {activeTab === 'pivot' && (
              <PivotTableBuilder
                cleanedLedger={workspace.cleanedLedger}
                onDrillDown={(title, subtitle, rows) =>
                  setDrillState({ isOpen: true, title, subtitle, rows })
                }
              />
            )}

            {activeTab === 'reports' && (
              <CustomReportBuilder
                reports={workspace.customReports}
                cleanedLedger={workspace.cleanedLedger}
                canManageReports={session.permissions.manage_reports}
                onSaveReport={handleSaveReport}
                onDeleteReport={handleDeleteReport}
                onExportWorkbook={handleExportWorkbook}
                onDrillDown={(title, subtitle, rows) =>
                  setDrillState({ isOpen: true, title, subtitle, rows })
                }
              />
            )}

            {activeTab === 'close' && (
              <MonthlyCloseAndSecurity
                session={session}
                closeTasks={workspace.closeTasks}
                fiscalPeriod={workspace.fiscalPeriod}
                rbacMatrix={workspace.rbacMatrix}
                auditLog={workspace.auditLog}
                onUpdateCloseTask={handleUpdateCloseTask}
                onTogglePeriodLock={handleTogglePeriodLock}
                onClaimAdmin={handleClaimAdmin}
                onElevateRole={handleElevateRole}
                onSwitchRole={handleSwitchRole}
                onUpdateRbacPolicy={handleUpdateRbacPolicy}
                onNavigateTab={setActiveTab}
              />
            )}
          </div>
        </main>
      </div>

      {/* Global Transaction Drill-Down Drawer */}
      <DrillDownDrawer
        isOpen={drillState.isOpen}
        title={drillState.title}
        subtitle={drillState.subtitle}
        rows={drillState.rows}
        onClose={() => setDrillState((s) => ({ ...s, isOpen: false }))}
      />

      {/* Non-blocking Feedback Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-lg border px-4 py-3 text-xs font-medium shadow-md ${
            toast.type === 'error'
              ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200'
              : 'border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
