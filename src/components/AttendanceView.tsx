import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import {
  Calendar,
  Check,
  Clock,
  Layers,
  List,
  RotateCcw,
  ShieldAlert,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import type { AttendanceStatus, Student, WorkspaceSnapshot } from '../types';
import {
  addDaysToDateStr,
  diffDaysBetweenDateStrs,
  formatHHMMTo12Hour,
  formatIstTimeHHMM,
  formatRupeesFromPaise,
} from '../engines/istDate';

interface AttendanceViewProps {
  workspace: WorkspaceSnapshot;
  onMarkAttendance: (params: {
    studentId: string;
    date: string;
    status: AttendanceStatus;
    actualArrivalTime?: string | null;
    note?: string;
  }) => Promise<void>;
  onBulkMarkAbsent: (date: string, studentIds: string[]) => Promise<void>;
  onOpenStudent: (studentId: string) => void;
}

type ViewTab = 'swipe' | 'list' | 'calendar';

interface UndoEntry {
  studentId: string;
  studentName: string;
  date: string;
  previousStatus: AttendanceStatus;
}

export const AttendanceView: React.FC<AttendanceViewProps> = ({
  workspace,
  onMarkAttendance,
  onBulkMarkAbsent,
  onOpenStudent,
}) => {
  const [selectedDate, setSelectedDate] = useState(workspace.todayIst);
  const [mode, setMode] = useState<ViewTab>('swipe');
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [confirmEndSession, setConfirmEndSession] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeStudents = useMemo(
    () =>
      workspace.students
        .filter((s) => s.status === 'active')
        .sort((a, b) => a.preferredArrivalTime.localeCompare(b.preferredArrivalTime)),
    [workspace.students],
  );

  const attByStudent = useMemo(() => {
    const m = new Map<string, WorkspaceSnapshot['attendance'][number]>();
    for (const a of workspace.attendance) {
      if (a.date === selectedDate) m.set(a.studentId, a);
    }
    return m;
  }, [workspace.attendance, selectedDate]);

  const unmarkedStudents = useMemo(
    () =>
      activeStudents.filter((s) => {
        const rec = attByStudent.get(s.id);
        return !rec || rec.status === 'unmarked';
      }),
    [activeStudents, attByStudent],
  );

  const stats = useMemo(() => {
    let present = 0;
    let absent = 0;
    let late = 0;
    let excused = 0;
    let unmarked = 0;
    for (const s of activeStudents) {
      const st = attByStudent.get(s.id)?.status ?? 'unmarked';
      if (st === 'present') present += 1;
      else if (st === 'late') late += 1;
      else if (st === 'absent') absent += 1;
      else if (st === 'excused') excused += 1;
      else unmarked += 1;
    }
    return { present, absent, late, excused, unmarked, total: activeStudents.length };
  }, [activeStudents, attByStudent]);

  const recordStatus = useCallback(
    async (student: Student, status: AttendanceStatus) => {
      if (busy) return;
      setBusy(true);
      try {
        const prev = attByStudent.get(student.id)?.status ?? 'unmarked';
        setUndoStack((stk) => [
          ...stk.slice(-14),
          { studentId: student.id, studentName: student.fullName, date: selectedDate, previousStatus: prev },
        ]);
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(15);
          } catch {
            // ignore
          }
        }
        const arrival =
          status === 'present' || status === 'late'
            ? formatIstTimeHHMM(new Date())
            : null;
        await onMarkAttendance({
          studentId: student.id,
          date: selectedDate,
          status,
          actualArrivalTime: arrival,
        });
      } finally {
        setBusy(false);
      }
    },
    [attByStudent, busy, onMarkAttendance, selectedDate],
  );

  const handleUndo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last || busy) return;
    setBusy(true);
    try {
      setUndoStack((stk) => stk.slice(0, -1));
      await onMarkAttendance({
        studentId: last.studentId,
        date: last.date,
        status: last.previousStatus,
      });
    } finally {
      setBusy(false);
    }
  }, [busy, onMarkAttendance, undoStack]);

  // Keyboard shortcuts on desktop when in Swipe mode
  useEffect(() => {
    if (mode !== 'swipe') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const top = unmarkedStudents[0];
      if (e.key === 'ArrowRight' && top) {
        e.preventDefault();
        void recordStatus(top, 'present');
      } else if (e.key === 'ArrowLeft' && top) {
        e.preventDefault();
        void recordStatus(top, 'absent');
      } else if (e.key === 'ArrowUp' && top) {
        e.preventDefault();
        void recordStatus(top, 'late');
      } else if ((e.key === 'z' || e.key === 'Z') && undoStack.length > 0) {
        e.preventDefault();
        void handleUndo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, mode, recordStatus, undoStack.length, unmarkedStudents]);

  // Calendar 14-day recent grid
  const calendarDays = useMemo(() => {
    const arr: string[] = [];
    for (let i = 13; i >= 0; i--) {
      arr.push(addDaysToDateStr(workspace.todayIst, -i));
    }
    return arr;
  }, [workspace.todayIst]);

  const currentCard = unmarkedStudents[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 dark:text-white">Attendance</h1>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
            Swipe right for Present · Swipe left for Absent · Unmarked students are never auto-marked absent without confirmation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="date"
            aria-label="Attendance date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-xl liquid-glass text-xs font-mono text-slate-900 dark:text-white focus:outline-none"
          />

          <div className="flex items-center p-1 rounded-xl liquid-glass gap-1">
            {(
              [
                { id: 'swipe', label: 'Swipe', icon: Layers },
                { id: 'list', label: 'List', icon: List },
                { id: 'calendar', label: 'History', icon: Calendar },
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMode(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    mode === t.id
                      ? 'bg-sky-600 text-white dark:bg-white dark:text-black'
                      : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Live Totals Bar */}
      <div className="liquid-glass rounded-2xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-5 text-xs font-mono tabular-nums">
          <span className="text-emerald-700 dark:text-white font-semibold">Present: {stats.present}</span>
          <span className="text-amber-700 dark:text-neutral-300 font-semibold">Late: {stats.late}</span>
          <span className="text-rose-700 dark:text-neutral-400 font-semibold">Absent: {stats.absent}</span>
          <span className="text-slate-600 dark:text-neutral-400">Excused: {stats.excused}</span>
          <span className="text-sky-700 dark:text-white font-semibold">Unmarked: {stats.unmarked}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={undoStack.length === 0 || busy}
            onClick={handleUndo}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-200 disabled:opacity-40 hover:bg-white dark:hover:bg-white/10 whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Undo{undoStack.length > 0 ? ` (${undoStack[undoStack.length - 1].studentName.split(' ')[0]})` : ''}</span>
          </button>

          {stats.unmarked > 0 && (
            <button
              type="button"
              onClick={() => setConfirmEndSession(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-rose-200 dark:border-white/25 text-rose-700 dark:text-neutral-200 hover:bg-rose-50 dark:hover:bg-white/10 whitespace-nowrap"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Mark Remaining Absent</span>
            </button>
          )}
        </div>
      </div>

      {/* Confirmation dialog for End-of-Session Mark Remaining Absent */}
      {confirmEndSession && (
        <div className="liquid-glass-strong rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 border-rose-300 dark:border-white/30">
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-slate-950 dark:text-white">
              End-of-session check: Mark {stats.unmarked} unmarked student{stats.unmarked === 1 ? '' : 's'} absent?
            </p>
            <p className="text-xs text-slate-600 dark:text-neutral-400">
              Their assigned homework will be preserved automatically and today’s plan will adjust.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmEndSession(false)}
              className="px-3.5 py-2 rounded-xl text-xs font-medium border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                setConfirmEndSession(false);
                await onBulkMarkAbsent(selectedDate, unmarkedStudents.map((s) => s.id));
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-600 dark:bg-white text-white dark:text-black"
            >
              Confirm Mark Absent
            </button>
          </div>
        </div>
      )}

      {/* MODE 1: SUPER-FAST SWIPE ATTENDANCE */}
      {mode === 'swipe' && (
        <div className="grid lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 flex flex-col items-center">
            {currentCard ? (
              <SwipeAttendanceCard
                key={`${currentCard.id}-${selectedDate}`}
                student={currentCard}
                workspace={workspace}
                selectedDate={selectedDate}
                remainingCount={unmarkedStudents.length}
                onDecide={(status) => recordStatus(currentCard, status)}
                onOpenStudent={onOpenStudent}
              />
            ) : (
              <div className="liquid-glass-strong w-full max-w-md rounded-3xl p-8 text-center space-y-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-sky-100 dark:bg-white/10 text-sky-700 dark:text-white flex items-center justify-center">
                  <Check className="w-7 h-7" />
                </div>
                <h2 className="text-xl font-bold text-slate-950 dark:text-white">
                  All {stats.total} students marked for {selectedDate}
                </h2>
                <p className="text-sm text-slate-600 dark:text-neutral-400">
                  {stats.present} present · {stats.late} late · {stats.absent} absent · {stats.excused} excused. Switch to List mode anytime to edit individual records.
                </p>
                <div className="flex justify-center gap-2 pt-1">
                  {undoStack.length > 0 && (
                    <button
                      type="button"
                      onClick={handleUndo}
                      className="px-4 py-2 rounded-xl text-xs font-semibold border border-sky-200 dark:border-white/20 text-slate-800 dark:text-white"
                    >
                      Undo Last Swipe
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setMode('list')}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
                  >
                    Review Full List
                  </button>
                </div>
              </div>
            )}

            <p className="text-xs text-slate-500 dark:text-neutral-500 mt-4 text-center">
              Desktop shortcuts: <span className="font-mono">→</span> Present · <span className="font-mono">←</span> Absent · <span className="font-mono">↑</span> Late · <span className="font-mono">Z</span> Undo
            </p>
          </div>

          {/* Right side queue & recently marked */}
          <div className="lg:col-span-5 liquid-glass rounded-3xl p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-950 dark:text-white">
              Today’s Attendance Roll ({stats.total - stats.unmarked}/{stats.total})
            </h2>
            <div className="divide-y divide-sky-100/80 dark:divide-white/10 max-h-[430px] overflow-y-auto">
              {activeStudents.map((s) => {
                const st = attByStudent.get(s.id)?.status ?? 'unmarked';
                return (
                  <div key={s.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{s.fullName}</p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        Class {s.classLevel} · {s.board} · {formatHHMMTo12Hour(s.preferredArrivalTime)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => recordStatus(s, 'present')}
                        aria-label={`Mark ${s.fullName} present`}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                          st === 'present'
                            ? 'bg-emerald-600 text-white dark:bg-white dark:text-black'
                            : 'border border-sky-200 dark:border-white/15 text-slate-600 dark:text-neutral-400'
                        }`}
                      >
                        P
                      </button>
                      <button
                        type="button"
                        onClick={() => recordStatus(s, 'late')}
                        aria-label={`Mark ${s.fullName} late`}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                          st === 'late'
                            ? 'bg-amber-600 text-white dark:bg-neutral-300 dark:text-black'
                            : 'border border-sky-200 dark:border-white/15 text-slate-600 dark:text-neutral-400'
                        }`}
                      >
                        L
                      </button>
                      <button
                        type="button"
                        onClick={() => recordStatus(s, 'absent')}
                        aria-label={`Mark ${s.fullName} absent`}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                          st === 'absent'
                            ? 'bg-rose-600 text-white dark:bg-neutral-700 dark:text-white'
                            : 'border border-sky-200 dark:border-white/15 text-slate-600 dark:text-neutral-400'
                        }`}
                      >
                        A
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: COMPACT LIST MODE */}
      {mode === 'list' && (
        <div className="liquid-glass rounded-3xl p-5 sm:p-6 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-sky-100 dark:border-white/15 text-xs text-slate-500 dark:text-neutral-400">
                <th className="py-2.5 pr-4 font-medium">Student</th>
                <th className="py-2.5 px-3 font-medium">Expected</th>
                <th className="py-2.5 px-3 font-medium">Actual Arrival</th>
                <th className="py-2.5 pl-3 text-right font-medium">Status Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-100/70 dark:divide-white/10 text-sm">
              {activeStudents.map((s) => {
                const rec = attByStudent.get(s.id);
                const status = rec?.status ?? 'unmarked';
                return (
                  <tr key={s.id}>
                    <td className="py-3 pr-4">
                      <button
                        type="button"
                        onClick={() => onOpenStudent(s.id)}
                        className="font-semibold text-slate-900 dark:text-white hover:underline text-left"
                      >
                        {s.fullName}
                      </button>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        Class {s.classLevel} · {s.board}
                      </p>
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-xs text-slate-600 dark:text-neutral-400">
                      {formatHHMMTo12Hour(s.preferredArrivalTime)}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-xs text-slate-700 dark:text-neutral-300">
                      {rec?.actualArrivalTime ? formatHHMMTo12Hour(rec.actualArrivalTime) : '—'}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {(['present', 'late', 'excused', 'absent'] as AttendanceStatus[]).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => recordStatus(s, opt)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                              status === opt
                                ? 'bg-sky-600 text-white dark:bg-white dark:text-black'
                                : 'border border-sky-200/80 dark:border-white/15 text-slate-700 dark:text-neutral-300 hover:bg-sky-50 dark:hover:bg-white/10'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MODE 3: 14-DAY CALENDAR HISTORY & MONTHLY SUMMARY */}
      {mode === 'calendar' && (
        <div className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-4 overflow-x-auto">
          <div>
            <h2 className="text-base font-bold text-slate-950 dark:text-white">14-Day Attendance History</h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              P = Present · L = Late · A = Absent · E = Excused · — = Unmarked
            </p>
          </div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-sky-100 dark:border-white/15 text-slate-500 dark:text-neutral-400">
                <th className="py-2 pr-3 font-medium sticky left-0">Student</th>
                {calendarDays.map((d) => (
                  <th key={d} className="py-2 px-1.5 text-center font-mono tabular-nums">
                    {d.slice(8)}
                  </th>
                ))}
                <th className="py-2 pl-3 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-100/70 dark:divide-white/10">
              {activeStudents.map((s) => {
                let markedCount = 0;
                let presentCount = 0;
                return (
                  <tr key={s.id}>
                    <td className="py-2.5 pr-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                      {s.fullName}
                    </td>
                    {calendarDays.map((d) => {
                      const rec = workspace.attendance.find((a) => a.studentId === s.id && a.date === d);
                      const st = rec?.status ?? 'unmarked';
                      if (st !== 'unmarked') {
                        markedCount += 1;
                        if (st === 'present' || st === 'late') presentCount += 1;
                      }
                      const letter =
                        st === 'present' ? 'P' : st === 'late' ? 'L' : st === 'absent' ? 'A' : st === 'excused' ? 'E' : '·';
                      return (
                        <td
                          key={d}
                          className={`py-2.5 px-1.5 text-center font-mono font-semibold ${
                            st === 'present'
                              ? 'text-emerald-700 dark:text-white'
                              : st === 'absent'
                                ? 'text-rose-600 dark:text-neutral-500'
                                : st === 'late'
                                  ? 'text-amber-700 dark:text-neutral-300'
                                  : 'text-slate-300 dark:text-neutral-700'
                          }`}
                        >
                          {letter}
                        </td>
                      );
                    })}
                    <td className="py-2.5 pl-3 text-right font-mono tabular-nums font-semibold text-slate-800 dark:text-neutral-200">
                      {markedCount > 0 ? `${Math.round((presentCount / markedCount) * 100)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

interface SwipeCardProps {
  student: Student;
  workspace: WorkspaceSnapshot;
  selectedDate: string;
  remainingCount: number;
  onDecide: (status: AttendanceStatus) => void;
  onOpenStudent: (id: string) => void;
}

const SwipeAttendanceCard: React.FC<SwipeCardProps> = ({
  student,
  workspace,
  selectedDate,
  remainingCount,
  onDecide,
  onOpenStudent,
}) => {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-10, 0, 10]);
  const presentOpacity = useTransform(x, [30, 110], [0, 1]);
  const absentOpacity = useTransform(x, [-110, -30], [1, 0]);

  const pendingHwCount = workspace.homework.filter(
    (h) => h.studentId === student.id && h.status !== 'completed' && h.status !== 'verified',
  ).length;

  const nearestExam = workspace.exams
    .filter((e) => e.studentId === student.id && e.obtainedMarks == null && e.examDate >= selectedDate)
    .sort((a, b) => a.examDate.localeCompare(b.examDate))[0];

  const unpaidBalance = workspace.invoices
    .filter((i) => i.studentId === student.id && i.status !== 'paid' && i.status !== 'waived')
    .reduce((sum, i) => sum + Math.max(0, i.totalAmountPaise - i.paidAmountPaise), 0);

  const lastAttendance = workspace.attendance
    .filter((a) => a.studentId === student.id && a.date < selectedDate)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  const initials = student.fullName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="w-full max-w-md space-y-4">
      <motion.div
        style={{ x, rotate }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.85}
        onDragEnd={(_e, info) => {
          if (info.offset.x > 105 || info.velocity.x > 500) {
            onDecide('present');
          } else if (info.offset.x < -105 || info.velocity.x < -500) {
            onDecide('absent');
          }
        }}
        className="relative liquid-glass-strong rounded-3xl p-6 cursor-grab active:cursor-grabbing select-none touch-pan-y"
      >
        {/* Directional Swipe Feedback Overlays */}
        <motion.div
          style={{ opacity: presentOpacity }}
          className="pointer-events-none absolute top-5 right-5 px-3 py-1 rounded-lg border-2 border-emerald-600 dark:border-white text-emerald-700 dark:text-white font-display font-bold text-xs tracking-wider"
        >
          PRESENT
        </motion.div>
        <motion.div
          style={{ opacity: absentOpacity }}
          className="pointer-events-none absolute top-5 left-5 px-3 py-1 rounded-lg border-2 border-rose-600 dark:border-neutral-400 text-rose-700 dark:text-neutral-300 font-display font-bold text-xs tracking-wider"
        >
          ABSENT
        </motion.div>

        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400 mb-5">
          <span>Card 1 of {remainingCount} unmarked</span>
          <span className="font-mono tabular-nums">{student.studentCode}</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-sky-600 dark:bg-white text-white dark:text-black flex items-center justify-center font-display font-bold text-xl shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onOpenStudent(student.id)}
              className="text-xl font-bold text-slate-950 dark:text-white hover:underline text-left truncate block max-w-full"
            >
              {student.fullName}
            </button>
            <p className="text-sm text-slate-600 dark:text-neutral-300">
              Class {student.classLevel} · {student.board} · {student.schoolName || 'Regular Batch'}
            </p>
            <p className="text-xs font-mono tabular-nums text-sky-700 dark:text-neutral-400 mt-1 inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Expected {formatHHMMTo12Hour(student.preferredArrivalTime)} ({student.allocatedSlot})
            </p>
          </div>
        </div>

        {/* Context Summary */}
        <div className="mt-6 pt-5 border-t border-sky-100 dark:border-white/15 grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-slate-500 dark:text-neutral-500">Last Attendance</p>
            <p className="font-medium text-slate-900 dark:text-white mt-0.5 capitalize">
              {lastAttendance ? `${lastAttendance.status} (${lastAttendance.date})` : 'First recorded day'}
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-neutral-500">Homework Pending</p>
            <p className="font-mono tabular-nums font-medium text-slate-900 dark:text-white mt-0.5">
              {pendingHwCount} active task{pendingHwCount === 1 ? '' : 's'}
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-neutral-500">Upcoming Exam</p>
            <p className="font-medium text-slate-900 dark:text-white mt-0.5 truncate">
              {nearestExam
                ? `${nearestExam.subject} (${diffDaysBetweenDateStrs(selectedDate, nearestExam.examDate)}d)`
                : 'None in queue'}
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-neutral-500">Fee Status</p>
            <p className="font-mono tabular-nums font-medium text-slate-900 dark:text-white mt-0.5">
              {unpaidBalance > 0 ? `${formatRupeesFromPaise(unpaidBalance)} due` : 'All clear'}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Tactile Action Controls (Large Touch Targets >= 48px) */}
      <div className="grid grid-cols-4 gap-2.5">
        <button
          type="button"
          onClick={() => onDecide('absent')}
          className="min-h-[52px] rounded-2xl border border-rose-200 dark:border-white/20 bg-white/80 dark:bg-neutral-950 hover:bg-rose-50 dark:hover:bg-neutral-900 text-rose-700 dark:text-neutral-200 flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-transform active:scale-95"
        >
          <UserX className="w-4 h-4" />
          <span>Absent</span>
        </button>

        <button
          type="button"
          onClick={() => onDecide('excused')}
          className="min-h-[52px] rounded-2xl border border-sky-200/80 dark:border-white/15 bg-white/80 dark:bg-neutral-950 hover:bg-sky-50 dark:hover:bg-neutral-900 text-slate-700 dark:text-neutral-300 flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-transform active:scale-95"
        >
          <X className="w-4 h-4" />
          <span>Leave</span>
        </button>

        <button
          type="button"
          onClick={() => onDecide('late')}
          className="min-h-[52px] rounded-2xl border border-amber-200 dark:border-white/20 bg-white/80 dark:bg-neutral-950 hover:bg-amber-50 dark:hover:bg-neutral-900 text-amber-800 dark:text-neutral-200 flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-transform active:scale-95"
        >
          <Clock className="w-4 h-4" />
          <span>Late</span>
        </button>

        <button
          type="button"
          onClick={() => onDecide('present')}
          className="min-h-[52px] rounded-2xl bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-transform active:scale-95"
        >
          <UserCheck className="w-4 h-4" />
          <span>Present</span>
        </button>
      </div>
    </div>
  );
};
