import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  Play,
  RotateCcw,
  Users,
} from 'lucide-react';
import type { DailyPlanResult, ScheduleBlock, WorkspaceSnapshot } from '../types';
import { formatHHMMTo12Hour, formatMinutesTo12Hour } from '../engines/istDate';

interface PlannerViewProps {
  workspace: WorkspaceSnapshot;
  dailyPlan: DailyPlanResult;
  blockOverrides: Partial<Record<ScheduleBlock['mode'], number>>;
  onUpdateBlockDuration: (mode: ScheduleBlock['mode'], minutes: number) => void;
  onResetOverrides: () => void;
  onStartLiveMode: () => void;
  onSaveProgress: (payload: {
    studentId: string;
    date: string;
    subjectsCovered: string[];
    topicsStudied: string;
    homeworkCompletedCount: number;
    homeworkRemainingCount: number;
    doubtsCleared: string;
    teacherComment: string;
    improvementAreas: string;
    nextSessionTasks: string;
    completionPct: number;
  }) => Promise<void>;
  onOpenStudent: (id: string) => void;
}

export const PlannerView: React.FC<PlannerViewProps> = ({
  workspace,
  dailyPlan,
  blockOverrides,
  onUpdateBlockDuration,
  onResetOverrides,
  onStartLiveMode,
  onSaveProgress,
  onOpenStudent,
}) => {
  const [blockOrder, setBlockOrder] = useState<string[]>([]);
  const [editingProgressStudentId, setEditingProgressStudentId] = useState<string | null>(null);
  const [topicsStudied, setTopicsStudied] = useState('');
  const [doubtsCleared, setDoubtsCleared] = useState('');
  const [teacherComment, setTeacherComment] = useState('');
  const [nextTasks, setNextTasks] = useState('');
  const [completionPct, setCompletionPct] = useState(80);
  const [savingProg, setSavingProg] = useState(false);

  const orderedBlocks = useMemo(() => {
    const base = [...dailyPlan.blocks];
    if (blockOrder.length === 0) return base;
    const rank = new Map(blockOrder.map((id, idx) => [id, idx]));
    base.sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
    // Recompute sequential start/end times after manual reorder
    let cursor = dailyPlan.blocks[0]?.startMinute ?? 1080;
    return base.map((b) => {
      const s = cursor;
      const e = cursor + b.teacherExclusiveMinutes;
      cursor = e;
      return { ...b, startMinute: s, endMinute: e };
    });
  }, [dailyPlan.blocks, blockOrder]);

  const moveBlock = (index: number, delta: -1 | 1) => {
    const ids = orderedBlocks.map((b) => b.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setBlockOrder(next);
  };

  const openProgressEditor = (studentId: string) => {
    const existing = workspace.progressLogs.find(
      (p) => p.studentId === studentId && p.date === workspace.todayIst,
    );
    const stuHw = workspace.homework.filter((h) => h.studentId === studentId);
    const done = stuHw.filter((h) => h.status === 'completed' || h.status === 'verified').length;
    const total = stuHw.length;

    setEditingProgressStudentId(studentId);
    setTopicsStudied(existing?.topicsStudied ?? '');
    setDoubtsCleared(existing?.doubtsCleared ?? '');
    setTeacherComment(existing?.teacherComment ?? '');
    setNextTasks(existing?.nextSessionTasks ?? '');
    setCompletionPct(existing?.completionPct ?? (total > 0 ? Math.round((done / total) * 100) : 85));
  };

  const handleSaveProgress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProgressStudentId) return;
    setSavingProg(true);
    try {
      const stu = workspace.students.find((s) => s.id === editingProgressStudentId);
      const stuHw = workspace.homework.filter((h) => h.studentId === editingProgressStudentId);
      const done = stuHw.filter((h) => h.status === 'completed' || h.status === 'verified').length;
      const rem = stuHw.length - done;

      await onSaveProgress({
        studentId: editingProgressStudentId,
        date: workspace.todayIst,
        subjectsCovered: stu?.subjects.slice(0, 3) ?? ['Mathematics'],
        topicsStudied: topicsStudied.trim() || 'Daily syllabus practice',
        homeworkCompletedCount: done,
        homeworkRemainingCount: rem,
        doubtsCleared: doubtsCleared.trim(),
        teacherComment: teacherComment.trim(),
        improvementAreas: stu?.weaknesses.join(', ') ?? '',
        nextSessionTasks: nextTasks.trim() || 'Continue next exercise',
        completionPct,
      });
      setEditingProgressStudentId(null);
    } finally {
      setSavingProg(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 dark:text-white">
            Daily Tuition Planner ({formatHHMMTo12Hour(workspace.settings.sessionStart)}–{formatHHMMTo12Hour(workspace.settings.sessionEnd)})
          </h1>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
            Parallel multi-student scheduler · Adjust block durations or reorder freely · Overload detection active
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {Object.keys(blockOverrides).length > 0 && (
            <button
              type="button"
              onClick={() => {
                onResetOverrides();
                setBlockOrder([]);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-300"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Auto Plan</span>
            </button>
          )}
          <button
            type="button"
            onClick={onStartLiveMode}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Open Live Session Screen</span>
          </button>
        </div>
      </div>

      {/* Capacity & Overload Strip */}
      <div className="liquid-glass rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6 text-xs">
          <div>
            <p className="text-slate-500 dark:text-neutral-400">Session Window</p>
            <p className="font-mono tabular-nums text-base font-bold text-slate-950 dark:text-white">
              {dailyPlan.totalSessionMinutes} min
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-neutral-400">Planned Teacher Blocks</p>
            <p className="font-mono tabular-nums text-base font-bold text-slate-950 dark:text-white">
              {dailyPlan.plannedTeacherExclusiveMinutes} min
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-neutral-400">Parallel Learners Today</p>
            <p className="font-mono tabular-nums text-base font-bold text-slate-950 dark:text-white">
              {dailyPlan.studentPlans.length} active
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-neutral-400">Buffer / Capacity</p>
            <p className={`font-mono tabular-nums text-base font-bold ${dailyPlan.isOverloaded ? 'text-rose-700 dark:text-white' : 'text-emerald-700 dark:text-white'}`}>
              {dailyPlan.isOverloaded ? `Over by ${dailyPlan.overloadMinutes}m` : `${dailyPlan.bufferMinutes}m buffer`}
            </p>
          </div>
        </div>
      </div>

      {dailyPlan.isOverloaded && dailyPlan.overloadWarning && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-amber-50 dark:bg-neutral-900 border border-amber-300 dark:border-white/30 flex items-start gap-3 text-xs text-amber-950 dark:text-white"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">Two-Hour Capacity Warning — Teacher Overbooking Detected</p>
            <p>{dailyPlan.overloadWarning}</p>
          </div>
        </div>
      )}

      {/* Group Teaching Suggestions (Rule G) */}
      {dailyPlan.groupSuggestions.length > 0 && (
        <div className="liquid-glass rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Users className="w-5 h-5 text-sky-600 dark:text-white shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-slate-950 dark:text-white">
                Group Teaching Opportunity: {dailyPlan.groupSuggestions[0].subject} — {dailyPlan.groupSuggestions[0].topic}
              </p>
              <p className="text-xs text-slate-600 dark:text-neutral-400 mt-0.5">
                {dailyPlan.groupSuggestions[0].reason}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Editable Timetable */}
      <section className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
        <h2 className="text-lg font-bold text-slate-950 dark:text-white">Interactive 6:00 PM – 8:00 PM Block Schedule</h2>
        <div className="divide-y divide-sky-100/80 dark:divide-white/10">
          {orderedBlocks.map((block, idx) => (
            <div key={block.id} className="py-4 first:pt-1 last:pb-1 grid lg:grid-cols-12 gap-4 items-center">
              <div className="lg:col-span-3 space-y-1">
                <p className="font-mono tabular-nums text-xs font-bold text-sky-800 dark:text-white inline-flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {formatMinutesTo12Hour(block.startMinute)} – {formatMinutesTo12Hour(block.endMinute)}
                </p>
                <p className="text-sm font-semibold text-slate-950 dark:text-white">{block.title}</p>
                <p className="text-[11px] text-slate-500 dark:text-neutral-400">{block.reason}</p>
              </div>

              <div className="lg:col-span-6 space-y-1.5 text-xs">
                <p className="text-slate-800 dark:text-neutral-200">
                  <strong className="font-semibold">Teacher:</strong> {block.teacherActivity}
                </p>
                <p className="text-slate-600 dark:text-neutral-400">
                  <strong className="font-semibold">Parallel students:</strong> {block.studentActivity}
                </p>
              </div>

              <div className="lg:col-span-3 flex items-center lg:justify-end gap-1.5">
                <button
                  type="button"
                  aria-label={`Decrease duration of ${block.title}`}
                  onClick={() => onUpdateBlockDuration(block.mode, Math.max(5, block.teacherExclusiveMinutes - 5))}
                  className="px-2.5 py-1.5 rounded-lg border border-sky-200 dark:border-white/20 text-xs font-mono font-semibold text-slate-700 dark:text-neutral-200"
                >
                  -5m
                </button>
                <span className="font-mono tabular-nums text-xs font-bold w-12 text-center text-slate-900 dark:text-white">
                  {block.teacherExclusiveMinutes}m
                </span>
                <button
                  type="button"
                  aria-label={`Increase duration of ${block.title}`}
                  onClick={() => onUpdateBlockDuration(block.mode, Math.min(60, block.teacherExclusiveMinutes + 5))}
                  className="px-2.5 py-1.5 rounded-lg border border-sky-200 dark:border-white/20 text-xs font-mono font-semibold text-slate-700 dark:text-neutral-200"
                >
                  +5m
                </button>
                <button
                  type="button"
                  disabled={idx === 0}
                  aria-label={`Move ${block.title} earlier`}
                  onClick={() => moveBlock(idx, -1)}
                  className="p-1.5 rounded-lg border border-sky-200 dark:border-white/15 disabled:opacity-30"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={idx === orderedBlocks.length - 1}
                  aria-label={`Move ${block.title} later`}
                  onClick={() => moveBlock(idx, 1)}
                  className="p-1.5 rounded-lg border border-sky-200 dark:border-white/15 disabled:opacity-30"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Student-by-Student Parallel Allocation & End-of-Session Progress Review */}
      <section className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-950 dark:text-white">Student Attention Priority & Daily Progress Review</h2>
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            Ranked automatically by exam proximity, needs-help flags, and learning support — log today’s progress in one tap
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {dailyPlan.studentPlans.map((sp, i) => {
            const todayLog = workspace.progressLogs.find(
              (p) => p.studentId === sp.studentId && p.date === workspace.todayIst,
            );
            return (
              <div
                key={sp.studentId}
                className="p-4 rounded-2xl bg-white/60 dark:bg-neutral-950 border border-sky-100/90 dark:border-white/15 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => onOpenStudent(sp.studentId)}
                      className="text-sm font-bold text-slate-950 dark:text-white hover:underline text-left"
                    >
                      {i + 1}. {sp.studentName}
                    </button>
                    <p className="text-xs text-slate-500 dark:text-neutral-400">
                      Class {sp.classLevel} · {sp.board} · Arrives {formatHHMMTo12Hour(sp.arrivalTime)}
                    </p>
                  </div>
                  <div className="text-right font-mono tabular-nums text-xs">
                    <p className="font-semibold text-sky-700 dark:text-white">{sp.recommendedTeacherMinutes}m guided</p>
                    <p className="text-slate-500 dark:text-neutral-400">{sp.independentMinutes}m solo</p>
                  </div>
                </div>

                <div className="text-xs text-slate-700 dark:text-neutral-300 space-y-1">
                  <p><strong>Why prioritized:</strong> {sp.reasons.join(' · ')}</p>
                  <p><strong>Tasks:</strong> {sp.topTasks.join(' · ')}</p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-sky-100/70 dark:border-white/10">
                  {todayLog ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-white">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Logged today ({todayLog.completionPct}%)
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-neutral-500">End-of-day review pending</span>
                  )}
                  <button
                    type="button"
                    onClick={() => openProgressEditor(sp.studentId)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-sky-200 dark:border-white/20 text-slate-800 dark:text-white hover:bg-sky-50 dark:hover:bg-white/10"
                  >
                    {todayLog ? 'Edit Review' : 'Log Progress'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Daily Progress Review Modal */}
      {editingProgressStudentId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 dark:bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Log Daily Student Progress"
        >
          <form onSubmit={handleSaveProgress} className="liquid-glass-strong w-full max-w-lg rounded-3xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-950 dark:text-white">
              Daily Review — {workspace.students.find((s) => s.id === editingProgressStudentId)?.fullName}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
                  Topics Studied Today
                </label>
                <input
                  value={topicsStudied}
                  onChange={(e) => setTopicsStudied(e.target.value)}
                  placeholder="e.g. Fractions word problems & Photosynthesis"
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
                  Doubts Cleared
                </label>
                <input
                  value={doubtsCleared}
                  onChange={(e) => setDoubtsCleared(e.target.value)}
                  placeholder="e.g. Sign convention for concave mirrors"
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
                  Tomorrow’s Next Tasks
                </label>
                <input
                  value={nextTasks}
                  onChange={(e) => setNextTasks(e.target.value)}
                  placeholder="e.g. Finish Science notes and English grammar"
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
                  Completion Progress: <span className="font-mono">{completionPct}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={completionPct}
                  onChange={(e) => setCompletionPct(Number(e.target.value))}
                  className="w-full accent-sky-600 dark:accent-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
                  Teacher Comment
                </label>
                <textarea
                  rows={2}
                  value={teacherComment}
                  onChange={(e) => setTeacherComment(e.target.value)}
                  placeholder="Focused well today; needs 10m revision tomorrow"
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingProgressStudentId(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-sky-200 dark:border-white/20"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingProg}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
              >
                {savingProg ? 'Saving...' : 'Save Daily Review'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
