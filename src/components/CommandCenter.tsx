import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clock,
  GraduationCap,
  IndianRupee,
  Play,
  Plus,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { DailyPlanResult, WorkspaceSnapshot } from '../types';
import type { NavSection } from './CommandPalette';
import {
  diffDaysBetweenDateStrs,
  formatHHMMTo12Hour,
  formatIstTimeHHMM,
  formatMinutesTo12Hour,
  formatRupeesFromPaise,
  parseTimeToMinutes,
} from '../engines/istDate';
import { evaluateFeeReminders } from '../engines/feeEngine';

interface CommandCenterProps {
  workspace: WorkspaceSnapshot;
  dailyPlan: DailyPlanResult;
  liveMode: boolean;
  onSetLiveMode: (open: boolean) => void;
  onNavigate: (section: NavSection) => void;
  onOpenStudent: (studentId: string) => void;
  onQuickHomeworkUpdate: (hwId: string, patch: { status: 'completed' | 'partial' | 'not_started'; completionPct: number; needsHelp?: boolean }) => Promise<void>;
  onQuickAttendance: (studentId: string, status: 'present' | 'absent' | 'late') => Promise<void>;
}

export const CommandCenter: React.FC<CommandCenterProps> = ({
  workspace,
  dailyPlan,
  liveMode,
  onSetLiveMode,
  onNavigate,
  onOpenStudent,
  onQuickHomeworkUpdate,
  onQuickAttendance,
}) => {
  const [nowTick, setNowTick] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const istClock = formatIstTimeHHMM(nowTick);
  const istMinutes = parseTimeToMinutes(istClock);
  const sessionStartMin = parseTimeToMinutes(workspace.settings.sessionStart);
  const sessionEndMin = parseTimeToMinutes(workspace.settings.sessionEnd);
  const remainingMinutes = Math.max(0, sessionEndMin - Math.max(istMinutes, sessionStartMin));
  const sessionStatusLabel =
    istMinutes < sessionStartMin
      ? `Starts at ${formatHHMMTo12Hour(workspace.settings.sessionStart)}`
      : istMinutes >= sessionEndMin
        ? `Session complete · Next ${formatHHMMTo12Hour(workspace.settings.sessionStart)}`
        : `${remainingMinutes} min remaining`;

  const activeStudents = useMemo(
    () => workspace.students.filter((s) => s.status === 'active'),
    [workspace.students],
  );

  const todayAttMap = useMemo(() => {
    const m = new Map<string, WorkspaceSnapshot['attendance'][number]>();
    for (const a of workspace.attendance) {
      if (a.date === workspace.todayIst) m.set(a.studentId, a);
    }
    return m;
  }, [workspace.attendance, workspace.todayIst]);

  const counts = useMemo(() => {
    let present = 0;
    let absent = 0;
    let late = 0;
    let unmarked = 0;
    for (const s of activeStudents) {
      const rec = todayAttMap.get(s.id);
      if (!rec || rec.status === 'unmarked') unmarked += 1;
      else if (rec.status === 'present') present += 1;
      else if (rec.status === 'late') {
        present += 1;
        late += 1;
      } else absent += 1;
    }
    return { expected: activeStudents.length, present, absent, late, unmarked };
  }, [activeStudents, todayAttMap]);

  const pendingHomework = useMemo(
    () => workspace.homework.filter((h) => h.status !== 'completed' && h.status !== 'verified'),
    [workspace.homework],
  );

  const dueTodayHw = useMemo(
    () => pendingHomework.filter((h) => h.dueDate <= workspace.todayIst),
    [pendingHomework, workspace.todayIst],
  );

  const upcomingExams = useMemo(() => {
    return workspace.exams
      .filter((e) => e.obtainedMarks == null && e.examDate >= workspace.todayIst)
      .map((e) => ({
        ...e,
        daysUntil: diffDaysBetweenDateStrs(workspace.todayIst, e.examDate),
        studentName: workspace.students.find((s) => s.id === e.studentId)?.fullName ?? 'Student',
      }))
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }, [workspace.exams, workspace.students, workspace.todayIst]);

  const feeReminders = useMemo(
    () =>
      evaluateFeeReminders({
        students: workspace.students,
        invoices: workspace.invoices,
        todayDate: workspace.todayIst,
        reminderSettings: workspace.settings.reminders,
        tuitionName: workspace.settings.tuitionName,
      }),
    [workspace],
  );

  const studentMap = useMemo(
    () => new Map(workspace.students.map((s) => [s.id, s])),
    [workspace.students],
  );

  // --- DISTRACTION-FREE LIVE TUITION MODE (6:00 PM – 8:00 PM) ---
  if (liveMode) {
    const presentPlans = dailyPlan.studentPlans;
    return (
      <div className="space-y-6 pb-8">
        <div className="liquid-glass-strong rounded-3xl p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-sky-700 dark:text-neutral-400">
              Live Tuition Session · {formatHHMMTo12Hour(workspace.settings.sessionStart)} – {formatHHMMTo12Hour(workspace.settings.sessionEnd)} IST
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-950 dark:text-white mt-1">
              {formatHHMMTo12Hour(istClock)} IST · {sessionStatusLabel}
            </h1>
            <p className="text-xs text-slate-600 dark:text-neutral-400 mt-1">
              {counts.present} present · {counts.unmarked} awaiting check-in · {pendingHomework.length} active tasks
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold border border-sky-200 dark:border-white/20 text-slate-800 dark:text-white hover:bg-sky-50 dark:hover:bg-white/10 whitespace-nowrap"
            >
              Swipe Check-In
            </button>
            <button
              type="button"
              onClick={() => onSetLiveMode(false)}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <X className="w-4 h-4" />
              <span>Exit Live Mode</span>
            </button>
          </div>
        </div>

        {/* Next Teacher Action Highlight */}
        {dailyPlan.nextBestActions[0] && (
          <div className="liquid-glass rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-sky-700 dark:text-neutral-400">Next Best Teacher Action</p>
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">{dailyPlan.nextBestActions[0].title}</h2>
              <p className="text-xs text-slate-600 dark:text-neutral-400">
                {dailyPlan.nextBestActions[0].detail} · {dailyPlan.nextBestActions[0].reason}
              </p>
            </div>
            {dailyPlan.nextBestActions[0].studentId && (
              <button
                type="button"
                onClick={() => {
                  onSetLiveMode(false);
                  onOpenStudent(dailyPlan.nextBestActions[0].studentId!);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black whitespace-nowrap"
              >
                Open Student
              </button>
            )}
          </div>
        )}

        {/* Active Students Live Desk */}
        <div className="grid md:grid-cols-2 gap-4">
          {presentPlans.map((sp) => {
            const stuHw = pendingHomework.filter((h) => h.studentId === sp.studentId);
            const rec = todayAttMap.get(sp.studentId);
            return (
              <div key={sp.studentId} className="liquid-glass rounded-2xl p-5 flex flex-col justify-between gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        onSetLiveMode(false);
                        onOpenStudent(sp.studentId);
                      }}
                      className="text-base font-bold text-slate-950 dark:text-white hover:underline text-left"
                    >
                      {sp.studentName}
                    </button>
                    <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
                      Class {sp.classLevel} · {sp.board} · {sp.recommendedTeacherMinutes}m teacher / {sp.independentMinutes}m solo
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(!rec || rec.status === 'unmarked') ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onQuickAttendance(sp.studentId, 'present')}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
                        >
                          Mark Present
                        </button>
                        <button
                          type="button"
                          onClick={() => onQuickAttendance(sp.studentId, 'absent')}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-300"
                        >
                          Absent
                        </button>
                      </>
                    ) : (
                      <span className="text-xs font-mono font-medium text-emerald-700 dark:text-neutral-300">
                        {rec.status === 'late' ? `Late (${rec.actualArrivalTime ?? ''})` : `Present (${rec.actualArrivalTime ?? sp.arrivalTime})`}
                      </span>
                    )}
                  </div>
                </div>

                {sp.upcomingExam && sp.upcomingExam.daysUntil <= 3 && (
                  <p className="text-xs font-medium text-amber-800 dark:text-white bg-amber-50/80 dark:bg-white/10 rounded-xl px-3 py-2">
                    Exam Priority: {sp.upcomingExam.subject} ({sp.upcomingExam.examName}) — {sp.upcomingExam.daysUntil === 0 ? 'Today' : sp.upcomingExam.daysUntil === 1 ? 'Tomorrow' : `in ${sp.upcomingExam.daysUntil} days`}
                  </p>
                )}

                <div className="space-y-2.5">
                  {stuHw.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-neutral-400">
                      All assigned tasks complete — ready for textbook revision.
                    </p>
                  ) : (
                    stuHw.slice(0, 3).map((hw) => (
                      <div
                        key={hw.id}
                        className="flex items-center justify-between gap-2 pt-2 border-t border-sky-100/80 dark:border-white/10"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{hw.title}</p>
                          <p className="text-xs text-slate-500 dark:text-neutral-400">
                            {hw.subject} · {hw.estimatedMinutes}m{hw.needsHelp ? ' · Needs Help' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => onQuickHomeworkUpdate(hw.id, { status: 'completed', completionPct: 100, needsHelp: false })}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
                          >
                            Done
                          </button>
                          <button
                            type="button"
                            onClick={() => onQuickHomeworkUpdate(hw.id, { status: 'partial', completionPct: 50 })}
                            className="px-2 py-1.5 rounded-lg text-xs font-medium border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-300"
                          >
                            Partial
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // --- STANDARD TEACHER COMMAND CENTER ---
  return (
    <div className="space-y-6">
      {/* Top Hero Strip: Immediate Answer to "What do I need to do today?" */}
      <section className="liquid-glass-strong rounded-3xl p-5 sm:p-7 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-sky-700 dark:text-neutral-400">
            Today’s Tuition Command Center · {workspace.todayIst} · {formatHHMMTo12Hour(workspace.settings.sessionStart)}–{formatHHMMTo12Hour(workspace.settings.sessionEnd)} IST
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
            Good evening, {workspace.settings.teacherName.split(' ')[0]}
          </h1>
          <p className="text-sm text-slate-600 dark:text-neutral-400 max-w-2xl">
            {counts.expected} students scheduled today ({counts.present} present, {counts.unmarked} unmarked) · {dueTodayHw.length} homework due · {upcomingExams.filter((e) => e.daysUntil <= 3).length} urgent exam{upcomingExams.filter((e) => e.daysUntil <= 3).length === 1 ? '' : 's'} · {feeReminders.length} fee reminder{feeReminders.length === 1 ? '' : 's'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onSetLiveMode(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4" />
            <span>Start Live Session</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('attendance')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-sky-200/90 dark:border-white/20 bg-white/70 dark:bg-neutral-950 text-slate-800 dark:text-white hover:bg-white dark:hover:bg-neutral-900 transition-colors whitespace-nowrap shrink-0"
          >
            <UserCheck className="w-4 h-4" />
            <span>Swipe Attendance</span>
          </button>
        </div>
      </section>

      {/* Section A: Today's Overview Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5" aria-label="Today's overview metrics">
        <button
          type="button"
          onClick={() => onNavigate('attendance')}
          className="liquid-glass rounded-2xl p-4 sm:p-5 text-left hover:bg-white/95 dark:hover:bg-neutral-900 transition-colors"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-neutral-400">Attendance Today</p>
          <p className="font-mono tabular-nums text-2xl sm:text-3xl font-bold text-slate-950 dark:text-white mt-1.5">
            {counts.present}/{counts.expected}
          </p>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-1">
            {counts.unmarked} unmarked · {counts.absent} absent
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('homework')}
          className="liquid-glass rounded-2xl p-4 sm:p-5 text-left hover:bg-white/95 dark:hover:bg-neutral-900 transition-colors"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-neutral-400">Homework Pending</p>
          <p className="font-mono tabular-nums text-2xl sm:text-3xl font-bold text-slate-950 dark:text-white mt-1.5">
            {pendingHomework.length}
          </p>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-1">
            {dueTodayHw.length} due today · {pendingHomework.filter((h) => h.needsHelp).length} need help
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('exams')}
          className="liquid-glass rounded-2xl p-4 sm:p-5 text-left hover:bg-white/95 dark:hover:bg-neutral-900 transition-colors"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-neutral-400">Upcoming Exams</p>
          <p className="font-mono tabular-nums text-2xl sm:text-3xl font-bold text-slate-950 dark:text-white mt-1.5">
            {upcomingExams.length}
          </p>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-1 truncate">
            {upcomingExams[0]
              ? `${upcomingExams[0].studentName.split(' ')[0]} · ${upcomingExams[0].daysUntil === 0 ? 'Today' : upcomingExams[0].daysUntil === 1 ? 'Tomorrow' : `In ${upcomingExams[0].daysUntil}d`}`
              : 'No exams scheduled'}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('fees')}
          className="liquid-glass rounded-2xl p-4 sm:p-5 text-left hover:bg-white/95 dark:hover:bg-neutral-900 transition-colors"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-neutral-400">Fees Requiring Attention</p>
          <p className="font-mono tabular-nums text-2xl sm:text-3xl font-bold text-slate-950 dark:text-white mt-1.5">
            {feeReminders.length}
          </p>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-1 font-mono tabular-nums">
            {formatRupeesFromPaise(feeReminders.reduce((s, r) => s + r.balancePaise, 0))} pending
          </p>
        </button>
      </section>

      {/* Main 2-Column Workspace: Left = Timeline (6–8 PM), Right = Next Best Actions & Urgent Alerts */}
      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Section B: 6:00 PM – 8:00 PM Visual Tuition Timeline */}
        <section className="lg:col-span-7 liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">
                {formatHHMMTo12Hour(workspace.settings.sessionStart)} – {formatHHMMTo12Hour(workspace.settings.sessionEnd)} Tuition Timeline
              </h2>
              <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
                Parallel teaching plan · {dailyPlan.plannedTeacherExclusiveMinutes} / {dailyPlan.totalSessionMinutes} min planned
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('planner')}
              className="self-start sm:self-auto inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-white hover:underline whitespace-nowrap shrink-0"
            >
              <span>Edit Plan</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {dailyPlan.isOverloaded && dailyPlan.overloadWarning && (
            <div className="p-3.5 rounded-2xl bg-amber-50/90 dark:bg-neutral-900 border border-amber-200 dark:border-white/25 flex items-start gap-2.5 text-xs text-amber-900 dark:text-white">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{dailyPlan.overloadWarning}</span>
            </div>
          )}

          <div className="divide-y divide-sky-100/80 dark:divide-white/10">
            {dailyPlan.blocks.map((block) => (
              <div key={block.id} className="py-3.5 first:pt-1 last:pb-1 grid sm:grid-cols-12 gap-2 sm:gap-4 items-start">
                <div className="sm:col-span-3">
                  <p className="font-mono tabular-nums text-xs font-semibold text-sky-800 dark:text-white">
                    {formatMinutesTo12Hour(block.startMinute)} – {formatMinutesTo12Hour(block.endMinute)}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-neutral-400 font-mono tabular-nums mt-0.5">
                    {block.teacherExclusiveMinutes} min
                  </p>
                </div>
                <div className="sm:col-span-9 space-y-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{block.title}</p>
                  <p className="text-xs text-slate-600 dark:text-neutral-300">{block.teacherActivity}</p>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    Parallel students: {block.studentActivity}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section C & D: Next Best Actions + Urgent Alerts */}
        <div className="lg:col-span-5 space-y-6">
          <section className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">Next Best Actions</h2>
              <span className="text-xs text-slate-500 dark:text-neutral-400 font-mono tabular-nums">
                {dailyPlan.nextBestActions.length} prioritized
              </span>
            </div>

            {dailyPlan.nextBestActions.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-neutral-400 py-4">
                Everything is on track for today’s batch.
              </p>
            ) : (
              <div className="divide-y divide-sky-100/80 dark:divide-white/10">
                {dailyPlan.nextBestActions.slice(0, 6).map((act) => (
                  <div key={act.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{act.title}</p>
                      <p className="text-xs text-slate-600 dark:text-neutral-400">{act.detail}</p>
                      <p className="text-[11px] text-sky-700 dark:text-neutral-300">{act.reason}</p>
                    </div>
                    {act.studentId ? (
                      <button
                        type="button"
                        onClick={() => onOpenStudent(act.studentId!)}
                        className="text-xs font-semibold text-sky-700 dark:text-white hover:underline shrink-0 py-1"
                      >
                        View
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onNavigate(act.category === 'fee' ? 'fees' : 'planner')}
                        className="text-xs font-semibold text-sky-700 dark:text-white hover:underline shrink-0 py-1"
                      >
                        Open
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Quick Actions Bar */}
          <section className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-3.5">
            <h2 className="text-base font-bold text-slate-950 dark:text-white">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate('students')}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-sky-200/80 dark:border-white/15 bg-white/60 dark:bg-neutral-950 hover:bg-white dark:hover:bg-neutral-900 text-xs font-medium text-slate-800 dark:text-neutral-100 transition-colors"
              >
                <Users className="w-4 h-4 text-sky-600 dark:text-white shrink-0" />
                <span className="truncate">Add / View Students</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('homework')}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-sky-200/80 dark:border-white/15 bg-white/60 dark:bg-neutral-950 hover:bg-white dark:hover:bg-neutral-900 text-xs font-medium text-slate-800 dark:text-neutral-100 transition-colors"
              >
                <BookOpen className="w-4 h-4 text-sky-600 dark:text-white shrink-0" />
                <span className="truncate">Assign Homework</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('fees')}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-sky-200/80 dark:border-white/15 bg-white/60 dark:bg-neutral-950 hover:bg-white dark:hover:bg-neutral-900 text-xs font-medium text-slate-800 dark:text-neutral-100 transition-colors"
              >
                <IndianRupee className="w-4 h-4 text-sky-600 dark:text-white shrink-0" />
                <span className="truncate">Record Fee Payment</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('exams')}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-sky-200/80 dark:border-white/15 bg-white/60 dark:bg-neutral-950 hover:bg-white dark:hover:bg-neutral-900 text-xs font-medium text-slate-800 dark:text-neutral-100 transition-colors"
              >
                <GraduationCap className="w-4 h-4 text-sky-600 dark:text-white shrink-0" />
                <span className="truncate">Schedule Exam</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Expected Arrival Roster Preview */}
      <section className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">Expected Students Today</h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              Ordered by arrival time and priority — tap any student for full academic & fee history
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('students')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-white hover:underline"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Manage Roster</span>
          </button>
        </div>

        {activeStudents.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-sm text-slate-600 dark:text-neutral-400">No active students enrolled yet.</p>
            <button
              type="button"
              onClick={() => onNavigate('students')}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
            >
              Enroll Your First Student
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-sky-100 dark:border-white/15 text-xs text-slate-500 dark:text-neutral-400">
                  <th className="py-2.5 pr-4 font-medium">Student</th>
                  <th className="py-2.5 px-3 font-medium">Expected Arrival</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-3 font-medium">Today’s Focus</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-100/70 dark:divide-white/10 text-sm">
                {[...activeStudents]
                  .sort((a, b) => a.preferredArrivalTime.localeCompare(b.preferredArrivalTime))
                  .map((s) => {
                    const rec = todayAttMap.get(s.id);
                    const plan = dailyPlan.studentPlans.find((p) => p.studentId === s.id);
                    const stuDue = feeReminders.find((r) => r.studentId === s.id);
                    return (
                      <tr key={s.id} className="hover:bg-sky-50/50 dark:hover:bg-white/5 transition-colors">
                        <td className="py-3 pr-4">
                          <button
                            type="button"
                            onClick={() => onOpenStudent(s.id)}
                            className="text-left group"
                          >
                            <p className="font-semibold text-slate-900 dark:text-white group-hover:text-sky-700 dark:group-hover:underline">
                              {s.fullName}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-neutral-400">
                              Class {s.classLevel} · {s.board} · {s.schoolName || s.studentCode}
                            </p>
                          </button>
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-xs text-slate-700 dark:text-neutral-300 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {formatHHMMTo12Hour(s.preferredArrivalTime)}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs whitespace-nowrap">
                          {rec?.status === 'present' ? (
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-white">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Present
                            </span>
                          ) : rec?.status === 'late' ? (
                            <span className="font-medium text-amber-700 dark:text-neutral-300">Late</span>
                          ) : rec?.status === 'absent' ? (
                            <span className="font-medium text-rose-700 dark:text-neutral-400">Absent</span>
                          ) : (
                            <span className="text-slate-500 dark:text-neutral-500">Unmarked</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600 dark:text-neutral-300 max-w-xs truncate">
                          {plan?.topTasks[0] ?? `${s.subjects[0] ?? 'Regular'} study`}
                          {stuDue ? ` · Fee due ${formatRupeesFromPaise(stuDue.balancePaise)}` : ''}
                        </td>
                        <td className="py-3 pl-3 text-right whitespace-nowrap">
                          {(!rec || rec.status === 'unmarked') ? (
                            <button
                              type="button"
                              onClick={() => onQuickAttendance(s.id, 'present')}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black"
                            >
                              Mark Present
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onOpenStudent(s.id)}
                              className="text-xs font-medium text-sky-700 dark:text-neutral-300 hover:underline"
                            >
                              Profile
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {/* Keep studentMap referenced cleanly */}
      <span className="sr-only">{studentMap.size}</span>
    </div>
  );
};
