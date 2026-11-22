import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarClock,
  GraduationCap,
  Home,
  IndianRupee,
  LogOut,
  Menu,
  Moon,
  Play,
  Plus,
  Search,
  Settings,
  Smartphone,
  Sun,
  UserCheck,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  AttendanceStatus,
  BoardType,
  PaymentMethod,
  ScheduleBlock,
  StudentStatus,
  TuitionSettings,
  WorkspaceSnapshot,
} from './types';
import {
  apiRequest,
  cacheWorkspaceSnapshot,
  flushOfflineQueue,
  getOfflineQueue,
  loadCachedWorkspaceSnapshot,
  setAuthToken,
} from './lib/api';
import { generateDailyTuitionPlan } from './engines/schedulerEngine';
import { useTheme } from './hooks/useTheme';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import { AuthOnboarding } from './components/AuthOnboarding';
import { CommandPalette, type NavSection } from './components/CommandPalette';
import { CommandCenter } from './components/CommandCenter';
import { AttendanceView } from './components/AttendanceView';
import { StudentsView } from './components/StudentsView';
import { PlannerView } from './components/PlannerView';
import { ExamsView, HomeworkView } from './components/HomeworkExamsView';
import { FeesView } from './components/FeesView';
import { NotificationsView, ReportsView, SettingsView } from './components/NotificationsReportsSettings';

interface AuthState {
  loading: boolean;
  initialized: boolean;
  authenticated: boolean;
  teacher: { id: string; email: string; name: string } | null;
}

const NAV_ITEMS: { id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'students', label: 'Students', icon: Users },
  { id: 'attendance', label: 'Attendance', icon: UserCheck },
  { id: 'planner', label: 'Daily Planner', icon: CalendarClock },
  { id: 'homework', label: 'Homework', icon: BookOpen },
  { id: 'exams', label: 'Exams', icon: GraduationCap },
  { id: 'fees', label: 'Fees', icon: IndianRupee },
  { id: 'notifications', label: 'Alerts', icon: Bell },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [auth, setAuth] = useState<AuthState>({
    loading: true,
    initialized: false,
    authenticated: false,
    teacher: null,
  });
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [section, setSection] = useState<NavSection>('dashboard');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [feePaymentStudentId, setFeePaymentStudentId] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [blockOverrides, setBlockOverrides] = useState<Partial<Record<ScheduleBlock['mode'], number>>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(() => getOfflineQueue().length);

  const { preference: theme, setPreference: setTheme, resolvedTheme } = useTheme('light');
  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, install } = usePWAInstall();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 3200);
  }, []);

  const loadWorkspace = useCallback(async () => {
    try {
      const snap = await apiRequest<WorkspaceSnapshot>('/api/workspace');
      setWorkspace(snap);
      cacheWorkspaceSnapshot(snap);
    } catch {
      const cached = loadCachedWorkspaceSnapshot();
      if (cached) {
        setWorkspace(cached);
        showToast('Showing cached offline workspace data.');
      }
    }
  }, [showToast]);

  // Initial auth check + ?autostart=1 support for uninitialized first launch
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const status = await apiRequest<{
          initialized: boolean;
          authenticated: boolean;
          teacher: { id: string; email: string; name: string } | null;
        }>('/api/auth/status');

        if (!active) return;

        const params = new URLSearchParams(window.location.search);
        const autoStart = params.get('autostart') === '1';

        if (!status.authenticated && autoStart) {
          try {
            const demo = await apiRequest<{
              token: string;
              teacher: { id: string; email: string; name: string };
            }>('/api/auth/demo-bootstrap', { method: 'POST', body: {} });
            setAuthToken(demo.token);
            if (!active) return;
            setAuth({ loading: false, initialized: true, authenticated: true, teacher: demo.teacher });
            await loadWorkspace();
            return;
          } catch {
            // If workspace is already claimed by a real teacher, stay on Login screen!
          }
        }

        setAuth({
          loading: false,
          initialized: status.initialized,
          authenticated: status.authenticated,
          teacher: status.teacher,
        });

        if (status.authenticated) {
          await loadWorkspace();
        }
      } catch {
        if (!active) return;
        setAuth({ loading: false, initialized: false, authenticated: false, teacher: null });
      }
    })();
    return () => {
      active = false;
    };
  }, [loadWorkspace]);

  // Flush queued offline attendance/homework updates when reconnecting
  useEffect(() => {
    if (isOnline && auth.authenticated) {
      flushOfflineQueue().then((res) => {
        setPendingOfflineCount(res.remaining);
        if (res.synced > 0) {
          showToast(`Synced ${res.synced} offline update${res.synced === 1 ? '' : 's'}.`);
          void loadWorkspace();
        }
      });
    }
  }, [isOnline, auth.authenticated, loadWorkspace, showToast]);

  // Cmd/Ctrl + K Command Palette shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dailyPlan = useMemo(() => {
    if (!workspace) return null;
    return generateDailyTuitionPlan({
      date: workspace.todayIst,
      settings: workspace.settings,
      students: workspace.students,
      attendance: workspace.attendance,
      homework: workspace.homework,
      exams: workspace.exams,
      invoices: workspace.invoices,
      customBlockOverrides: blockOverrides,
    });
  }, [workspace, blockOverrides]);

  const unreadAlerts = useMemo(
    () => workspace?.notifications.filter((n) => !n.read).length ?? 0,
    [workspace],
  );

  const toggleLightDark = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  const handleNavigate = (next: NavSection) => {
    setLiveMode(false);
    setMobileMoreOpen(false);
    setSection(next);
    if (next !== 'students') setSelectedStudentId(null);
  };

  const handleOpenStudent = (studentId: string) => {
    setLiveMode(false);
    setSelectedStudentId(studentId);
    setSection('students');
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    setWorkspace(null);
    setAuth((prev) => ({ ...prev, authenticated: false, teacher: null }));
  };

  // --- MUTATION HANDLERS ---
  const markAttendance = async (params: {
    studentId: string;
    date: string;
    status: AttendanceStatus;
    actualArrivalTime?: string | null;
    note?: string;
  }) => {
    try {
      const snap = await apiRequest<WorkspaceSnapshot>('/api/attendance', {
        method: 'POST',
        body: params,
        queueableOffline: true,
        offlineLabel: `Attendance ${params.status}`,
      });
      setWorkspace(snap);
      cacheWorkspaceSnapshot(snap);
    } catch (err) {
      setPendingOfflineCount(getOfflineQueue().length);
      showToast(err instanceof Error ? err.message : 'Unable to update attendance.');
    }
  };

  const bulkMarkAbsent = async (date: string, studentIds: string[]) => {
    const snap = await apiRequest<WorkspaceSnapshot>('/api/attendance/bulk', {
      method: 'POST',
      body: {
        date,
        entries: studentIds.map((studentId) => ({ studentId, status: 'absent' })),
      },
    });
    setWorkspace(snap);
    showToast(`Marked ${studentIds.length} remaining student${studentIds.length === 1 ? '' : 's'} absent.`);
  };

  const updateHomework = async (id: string, patch: Record<string, unknown>) => {
    try {
      const snap = await apiRequest<WorkspaceSnapshot>(`/api/homework/${id}`, {
        method: 'PUT',
        body: patch,
        queueableOffline: true,
        offlineLabel: 'Homework status update',
      });
      setWorkspace(snap);
      cacheWorkspaceSnapshot(snap);
    } catch (err) {
      setPendingOfflineCount(getOfflineQueue().length);
      showToast(err instanceof Error ? err.message : 'Unable to update homework.');
    }
  };

  // --- LOADING / AUTH GATES ---
  if (auth.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="liquid-glass rounded-3xl px-8 py-6 text-center space-y-2">
          <div className="w-10 h-10 mx-auto rounded-xl bg-sky-600 dark:bg-white text-white dark:text-black font-display font-extrabold flex items-center justify-center text-lg">
            T
          </div>
          <p className="text-sm font-medium text-slate-700 dark:text-neutral-300">Loading Tuitio workspace...</p>
        </div>
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <AuthOnboarding
        initialized={auth.initialized}
        theme={theme}
        onToggleTheme={toggleLightDark}
        onAuthenticated={(teacher) => {
          setAuth({ loading: false, initialized: true, authenticated: true, teacher });
          void loadWorkspace();
        }}
      />
    );
  }

  if (!workspace || !dailyPlan) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="liquid-glass rounded-3xl p-8 max-w-md w-full space-y-3">
          <div className="h-5 w-40 rounded-lg bg-sky-100 dark:bg-neutral-800 animate-pulse" />
          <div className="h-24 rounded-2xl bg-sky-50 dark:bg-neutral-900 animate-pulse" />
          <div className="h-24 rounded-2xl bg-sky-50 dark:bg-neutral-900 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* DESKTOP SIDEBAR (252px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen p-4 border-r border-sky-200/70 dark:border-white/12 bg-white/55 dark:bg-black/95 backdrop-blur-xl no-print">
        <div className="flex items-center gap-2.5 px-2.5 py-2">
          <div className="w-9 h-9 rounded-xl bg-sky-600 dark:bg-white text-white dark:text-black flex items-center justify-center font-display font-extrabold text-lg shrink-0">
            T
          </div>
          <div className="min-w-0">
            <p className="font-display font-bold text-sm text-slate-950 dark:text-white truncate">
              {workspace.settings.tuitionName.split('—')[0].trim()}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-neutral-400 truncate">
              {workspace.settings.teacherName}
            </p>
          </div>
        </div>

        <nav className="mt-5 flex-1 space-y-1 overflow-y-auto" aria-label="Main workspace navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id && !liveMode;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-sky-600 text-white dark:bg-white dark:text-black font-semibold'
                    : 'text-slate-700 dark:text-neutral-300 hover:bg-sky-50/90 dark:hover:bg-white/10'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'notifications' && unreadAlerts > 0 && (
                  <span className={`font-mono text-[11px] ${active ? 'text-white/90 dark:text-black' : 'text-sky-700 dark:text-white'}`}>
                    {unreadAlerts}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="pt-3 border-t border-sky-200/70 dark:border-white/12 space-y-1.5">
          {isInstallable && !isInstalled && (
            <button
              type="button"
              onClick={install}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-sky-50 dark:bg-neutral-900 text-sky-800 dark:text-white hover:bg-sky-100 dark:hover:bg-neutral-800"
            >
              <Smartphone className="w-4 h-4 shrink-0" />
              <span className="truncate">Install Tuitio PWA</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-neutral-400 hover:bg-sky-50 dark:hover:bg-white/10"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT SHELL */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* TOP HEADER BAR (Compact on mobile <= 56px so mobile sticky stays well below 15%) */}
        <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 flex items-center justify-between gap-4 border-b border-sky-200/70 dark:border-white/12 bg-white/75 dark:bg-black/90 backdrop-blur-xl no-print">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => handleNavigate('dashboard')}
              className="lg:hidden font-display font-bold text-base text-slate-950 dark:text-white whitespace-nowrap shrink-0"
            >
              Tuitio
            </button>
            <span className="hidden lg:inline text-sm font-semibold text-slate-800 dark:text-neutral-200 capitalize whitespace-nowrap">
              {liveMode ? 'Live Tuition Session' : NAV_ITEMS.find((n) => n.id === section)?.label}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              aria-label="Global search"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-sky-200/80 dark:border-white/15 bg-white/80 dark:bg-neutral-950 text-xs text-slate-600 dark:text-neutral-300 hover:bg-white dark:hover:bg-neutral-900 whitespace-nowrap shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Search...</span>
              <span className="hidden md:inline font-mono text-[10px] text-slate-400">⌘K</span>
            </button>

            <button
              type="button"
              onClick={toggleLightDark}
              aria-label="Toggle Light and Dark theme"
              className="p-2 rounded-xl border border-sky-200/80 dark:border-white/15 bg-white/80 dark:bg-neutral-950 text-slate-700 dark:text-white hover:bg-white dark:hover:bg-neutral-900 shrink-0"
            >
              {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => {
                setSection('dashboard');
                setLiveMode((v) => !v);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{liveMode ? 'Dashboard' : 'Live Mode'}</span>
            </button>
          </div>
        </header>

        {/* MAIN WORKSPACE */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 lg:pb-10">
          {section === 'dashboard' && (
            <CommandCenter
              workspace={workspace}
              dailyPlan={dailyPlan}
              liveMode={liveMode}
              onSetLiveMode={setLiveMode}
              onNavigate={handleNavigate}
              onOpenStudent={handleOpenStudent}
              onQuickHomeworkUpdate={async (hwId, patch) => {
                await updateHomework(hwId, patch);
                showToast('Homework updated.');
              }}
              onQuickAttendance={async (studentId, status) => {
                await markAttendance({ studentId, date: workspace.todayIst, status });
                showToast(`Marked ${status}.`);
              }}
            />
          )}

          {section === 'students' && (
            <StudentsView
              workspace={workspace}
              selectedStudentId={selectedStudentId}
              onSelectStudent={setSelectedStudentId}
              onCreateStudent={async (payload) => {
                const res = await apiRequest<{ snapshot: WorkspaceSnapshot }>('/api/students', {
                  method: 'POST',
                  body: payload,
                });
                setWorkspace(res.snapshot);
                showToast('Student enrolled with automatic fee calculation.');
              }}
              onUpdateStudent={async (id, payload) => {
                const snap = await apiRequest<WorkspaceSnapshot>(`/api/students/${id}`, {
                  method: 'PUT',
                  body: payload,
                });
                setWorkspace(snap);
                showToast('Student profile saved.');
              }}
              onChangeStatus={async (id, status: StudentStatus) => {
                const snap = await apiRequest<WorkspaceSnapshot>(`/api/students/${id}/status`, {
                  method: 'POST',
                  body: { status },
                });
                setWorkspace(snap);
                showToast(`Student status updated to ${status} (history preserved).`);
              }}
              onPermanentDelete={async (id) => {
                const snap = await apiRequest<WorkspaceSnapshot>(`/api/students/${id}`, {
                  method: 'DELETE',
                  body: { confirmDelete: true },
                });
                setWorkspace(snap);
                showToast('Student record permanently removed.');
              }}
              onPromoteStudents={async (params: {
                studentIds: string[];
                overridePolicy: 'keep_override' | 'adopt_class_rate';
                targetBoard?: BoardType;
              }) => {
                const res = await apiRequest<{ promoted: number; graduated: number; snapshot: WorkspaceSnapshot }>(
                  '/api/students/promote',
                  { method: 'POST', body: params },
                );
                setWorkspace(res.snapshot);
                showToast(`Promoted ${res.promoted}, graduated ${res.graduated}. Historical invoices preserved.`);
              }}
              onRecordPaymentShortcut={(studentId) => {
                setFeePaymentStudentId(studentId);
                setSection('fees');
              }}
            />
          )}

          {section === 'attendance' && (
            <AttendanceView
              workspace={workspace}
              onMarkAttendance={markAttendance}
              onBulkMarkAbsent={bulkMarkAbsent}
              onOpenStudent={handleOpenStudent}
            />
          )}

          {section === 'planner' && (
            <PlannerView
              workspace={workspace}
              dailyPlan={dailyPlan}
              blockOverrides={blockOverrides}
              onUpdateBlockDuration={(mode, minutes) =>
                setBlockOverrides((prev) => ({ ...prev, [mode]: minutes }))
              }
              onResetOverrides={() => setBlockOverrides({})}
              onStartLiveMode={() => {
                setSection('dashboard');
                setLiveMode(true);
              }}
              onSaveProgress={async (payload) => {
                const snap = await apiRequest<WorkspaceSnapshot>('/api/progress', {
                  method: 'POST',
                  body: payload,
                });
                setWorkspace(snap);
                showToast('Daily student progress saved.');
              }}
              onOpenStudent={handleOpenStudent}
            />
          )}

          {section === 'homework' && (
            <HomeworkView
              workspace={workspace}
              onCreateHomework={async (payload) => {
                const snap = await apiRequest<WorkspaceSnapshot>('/api/homework', {
                  method: 'POST',
                  body: payload,
                });
                setWorkspace(snap);
                showToast('Homework assigned.');
              }}
              onUpdateHomework={async (id, patch) => {
                await updateHomework(id, patch);
                showToast('Homework updated.');
              }}
              onDeleteHomework={async (id) => {
                const snap = await apiRequest<WorkspaceSnapshot>(`/api/homework/${id}`, { method: 'DELETE' });
                setWorkspace(snap);
                showToast('Homework removed.');
              }}
              onCarryForward={async () => {
                const res = await apiRequest<{ carriedCount: number; snapshot: WorkspaceSnapshot }>(
                  '/api/homework/carry-forward',
                  { method: 'POST', body: {} },
                );
                setWorkspace(res.snapshot);
                return res.carriedCount;
              }}
            />
          )}

          {section === 'exams' && (
            <ExamsView
              workspace={workspace}
              onCreateExam={async (payload) => {
                const snap = await apiRequest<WorkspaceSnapshot>('/api/exams', {
                  method: 'POST',
                  body: payload,
                });
                setWorkspace(snap);
                showToast('Examination scheduled.');
              }}
              onUpdateExam={async (id, patch) => {
                const snap = await apiRequest<WorkspaceSnapshot>(`/api/exams/${id}`, {
                  method: 'PUT',
                  body: patch,
                });
                setWorkspace(snap);
                showToast('Examination updated.');
              }}
              onDeleteExam={async (id) => {
                const snap = await apiRequest<WorkspaceSnapshot>(`/api/exams/${id}`, { method: 'DELETE' });
                setWorkspace(snap);
                showToast('Examination removed.');
              }}
            />
          )}

          {section === 'fees' && (
            <FeesView
              workspace={workspace}
              initialPaymentStudentId={feePaymentStudentId}
              onClearInitialPaymentStudent={() => setFeePaymentStudentId(null)}
              onGenerateMonth={async (monthKey) => {
                const res = await apiRequest<{ created: number; snapshot: WorkspaceSnapshot }>(
                  '/api/fees/generate-month',
                  { method: 'POST', body: { monthKey } },
                );
                setWorkspace(res.snapshot);
                return res.created;
              }}
              onRecordPayment={async (payload: {
                studentId: string;
                invoiceId?: string | null;
                amountPaise: number;
                method: PaymentMethod;
                transactionRef: string;
                notes: string;
                idempotencyKey: string;
              }) => {
                const res = await apiRequest<{ receiptNumber?: string; snapshot: WorkspaceSnapshot }>(
                  '/api/fees/payments',
                  { method: 'POST', body: payload },
                );
                setWorkspace(res.snapshot);
                showToast('Payment recorded.');
                return { receiptNumber: res.receiptNumber };
              }}
              onWaiveInvoice={async (invoiceId, waived) => {
                const snap = await apiRequest<WorkspaceSnapshot>(`/api/fees/invoices/${invoiceId}/waive`, {
                  method: 'PUT',
                  body: { waived },
                });
                setWorkspace(snap);
                showToast(waived ? 'Invoice waived.' : 'Invoice restored.');
              }}
              onCreateDiscount={async (payload) => {
                const snap = await apiRequest<WorkspaceSnapshot>('/api/discounts', {
                  method: 'POST',
                  body: payload,
                });
                setWorkspace(snap);
                showToast('Discount rule added.');
              }}
              onDeleteDiscount={async (id) => {
                const snap = await apiRequest<WorkspaceSnapshot>(`/api/discounts/${id}`, { method: 'DELETE' });
                setWorkspace(snap);
                showToast('Discount removed.');
              }}
            />
          )}

          {section === 'notifications' && (
            <NotificationsView
              workspace={workspace}
              onMarkRead={async (id) => {
                const snap = await apiRequest<WorkspaceSnapshot>(`/api/notifications/${id}/read`, { method: 'POST' });
                setWorkspace(snap);
              }}
              onMarkAllRead={async () => {
                const snap = await apiRequest<WorkspaceSnapshot>('/api/notifications/read-all', { method: 'POST' });
                setWorkspace(snap);
                showToast('All alerts marked read.');
              }}
            />
          )}

          {section === 'reports' && <ReportsView workspace={workspace} />}

          {section === 'settings' && (
            <SettingsView
              workspace={workspace}
              theme={theme}
              onChangeTheme={setTheme}
              onSaveSettings={async (next: TuitionSettings) => {
                const snap = await apiRequest<WorkspaceSnapshot>('/api/settings', {
                  method: 'PUT',
                  body: next,
                });
                setWorkspace(snap);
                showToast('Settings saved.');
              }}
              onSeedDemo={async () => {
                const snap = await apiRequest<WorkspaceSnapshot>('/api/demo/seed', { method: 'POST' });
                setWorkspace(snap);
                showToast('Isolated sample batch loaded.');
              }}
              onClearDemo={async () => {
                const snap = await apiRequest<WorkspaceSnapshot>('/api/demo/clear', { method: 'POST' });
                setWorkspace(snap);
                showToast('Sample demo data removed.');
              }}
              onRestoreBackup={async (json) => {
                const snap = await apiRequest<WorkspaceSnapshot>('/api/backup/restore', {
                  method: 'POST',
                  body: json,
                });
                setWorkspace(snap);
                showToast('Workspace restored from backup.');
              }}
            />
          )}
        </main>
      </div>

      {/* MOBILE FLOATING QUICK-ADD CONTEXT BUTTON */}
      <button
        type="button"
        onClick={() => handleNavigate(section === 'homework' ? 'homework' : section === 'fees' ? 'fees' : section === 'students' ? 'students' : 'attendance')}
        aria-label="Quick contextual action"
        className="lg:hidden fixed right-3.5 bottom-[74px] z-30 w-11 h-11 rounded-2xl bg-sky-600 dark:bg-white text-white dark:text-black shadow-lg flex items-center justify-center active:scale-95 transition-transform no-print"
      >
        <Plus className="w-5 h-5" />
      </button>

      {/* MOBILE BOTTOM NAVIGATION BAR: Home | Students | Attendance | Planner | More */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 pb-safe border-t border-sky-200/80 dark:border-white/15 bg-white/90 dark:bg-black/95 backdrop-blur-xl grid grid-cols-5 items-center no-print"
      >
        {(
          [
            { id: 'dashboard', label: 'Home', icon: Home },
            { id: 'students', label: 'Students', icon: Users },
            { id: 'attendance', label: 'Attendance', icon: UserCheck },
            { id: 'planner', label: 'Planner', icon: CalendarClock },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = section === item.id && !mobileMoreOpen;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavigate(item.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
                active
                  ? 'text-sky-600 dark:text-white'
                  : 'text-slate-500 dark:text-neutral-500'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setMobileMoreOpen((v) => !v)}
          className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
            mobileMoreOpen || ['homework', 'exams', 'fees', 'notifications', 'reports', 'settings'].includes(section)
              ? 'text-sky-600 dark:text-white'
              : 'text-slate-500 dark:text-neutral-500'
          }`}
        >
          <Menu className="w-5 h-5" />
          <span>More</span>
        </button>
      </nav>

      {/* MOBILE "MORE" BOTTOM SHEET */}
      {mobileMoreOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-slate-950/50 dark:bg-black/80 backdrop-blur-sm flex items-end"
          onClick={() => setMobileMoreOpen(false)}
        >
          <div
            className="w-full rounded-t-3xl liquid-glass-strong p-5 pb-8 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-neutral-700 mx-auto" />
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-950 dark:text-white">More Workspaces</p>
              <button type="button" onClick={() => setMobileMoreOpen(false)} aria-label="Close drawer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {NAV_ITEMS.filter((i) => !['dashboard', 'students', 'attendance', 'planner'].includes(i.id)).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className="min-h-[68px] p-3 rounded-2xl border border-sky-200/80 dark:border-white/15 bg-white/80 dark:bg-neutral-950 flex flex-col items-center justify-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-white"
                  >
                    <Icon className="w-5 h-5 text-sky-600 dark:text-white" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-sky-100 dark:border-white/15">
              {isInstallable && !isInstalled ? (
                <button
                  type="button"
                  onClick={install}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-white"
                >
                  <Smartphone className="w-4 h-4" /> Install App
                </button>
              ) : (
                <span className="text-xs text-slate-500 dark:text-neutral-400">{auth.teacher?.name}</span>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-neutral-300"
              >
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFLINE BANNER */}
      {!isOnline && (
        <div className="fixed bottom-20 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 dark:bg-white text-white dark:text-black px-3.5 py-2 text-xs font-semibold shadow-lg">
          <WifiOff className="w-4 h-4" />
          <span>Offline Mode · {pendingOfflineCount} queued</span>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-20 lg:bottom-5 right-4 z-50 liquid-glass-strong rounded-2xl px-4 py-2.5 text-xs font-semibold text-slate-900 dark:text-white shadow-xl"
        >
          {toast}
        </div>
      )}

      {/* COMMAND PALETTE */}
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        workspace={workspace}
        onNavigate={handleNavigate}
        onOpenStudent={handleOpenStudent}
        onStartLiveMode={() => {
          setSection('dashboard');
          setLiveMode(true);
        }}
      />
    </div>
  );
}
