import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarClock,
  GraduationCap,
  IndianRupee,
  Search,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { WorkspaceSnapshot } from '../types';

export type NavSection =
  | 'dashboard'
  | 'students'
  | 'attendance'
  | 'planner'
  | 'homework'
  | 'exams'
  | 'fees'
  | 'notifications'
  | 'reports'
  | 'settings';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  workspace: WorkspaceSnapshot;
  onNavigate: (section: NavSection) => void;
  onOpenStudent: (studentId: string) => void;
  onStartLiveMode: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  workspace,
  onNavigate,
  onOpenStudent,
  onStartLiveMode,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedStudents = workspace.students
      .filter(
        (s) =>
          !q ||
          s.fullName.toLowerCase().includes(q) ||
          s.studentCode.toLowerCase().includes(q) ||
          s.board.toLowerCase().includes(q) ||
          `class ${s.classLevel}`.includes(q) ||
          s.parentName.toLowerCase().includes(q),
      )
      .slice(0, 6);

    const matchedHw = q
      ? workspace.homework
          .filter((h) => h.title.toLowerCase().includes(q) || h.subject.toLowerCase().includes(q) || h.topic.toLowerCase().includes(q))
          .slice(0, 4)
      : [];

    const matchedExams = q
      ? workspace.exams
          .filter((e) => e.examName.toLowerCase().includes(q) || e.subject.toLowerCase().includes(q))
          .slice(0, 3)
      : [];

    return { matchedStudents, matchedHw, matchedExams };
  }, [query, workspace]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/45 dark:bg-black/75 backdrop-blur-sm p-4 pt-16 sm:pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Global search and quick actions"
      onClick={onClose}
    >
      <div
        className="liquid-glass-strong w-full max-w-xl rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-sky-200/60 dark:border-white/15">
          <Search className="w-4 h-4 text-sky-600 dark:text-neutral-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search students, boards, homework, exams, or jump to a workspace..."
            className="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-neutral-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-sky-50 dark:text-neutral-400 dark:hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-3 space-y-4">
          {/* Quick jumps */}
          <div>
            <p className="px-2 pb-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
              Quick Actions
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  onStartLiveMode();
                  onClose();
                }}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-xs font-medium text-slate-800 dark:text-neutral-100 hover:bg-sky-50 dark:hover:bg-white/10 transition-colors"
              >
                <CalendarClock className="w-4 h-4 text-sky-600 dark:text-white shrink-0" />
                <span className="truncate">Live Tuition Mode</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate('attendance');
                  onClose();
                }}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-xs font-medium text-slate-800 dark:text-neutral-100 hover:bg-sky-50 dark:hover:bg-white/10 transition-colors"
              >
                <UserCheck className="w-4 h-4 text-sky-600 dark:text-white shrink-0" />
                <span className="truncate">Swipe Attendance</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate('fees');
                  onClose();
                }}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-xs font-medium text-slate-800 dark:text-neutral-100 hover:bg-sky-50 dark:hover:bg-white/10 transition-colors"
              >
                <IndianRupee className="w-4 h-4 text-sky-600 dark:text-white shrink-0" />
                <span className="truncate">Fee Collection</span>
              </button>
            </div>
          </div>

          {/* Students */}
          {results.matchedStudents.length > 0 && (
            <div>
              <p className="px-2 pb-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
                Students ({results.matchedStudents.length})
              </p>
              <div className="divide-y divide-sky-100/70 dark:divide-white/10">
                {results.matchedStudents.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      onOpenStudent(s.id);
                      onClose();
                    }}
                    className="w-full flex items-center justify-between gap-3 px-2.5 py-2.5 text-left rounded-xl hover:bg-sky-50/80 dark:hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Users className="w-4 h-4 text-sky-600 dark:text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{s.fullName}</p>
                        <p className="text-xs text-slate-500 dark:text-neutral-400 truncate">
                          Class {s.classLevel} · {s.board} · {s.parentName}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-slate-500 dark:text-neutral-400 shrink-0">
                      {s.studentCode}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Homework */}
          {results.matchedHw.length > 0 && (
            <div>
              <p className="px-2 pb-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
                Homework
              </p>
              <div className="divide-y divide-sky-100/70 dark:divide-white/10">
                {results.matchedHw.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      onNavigate('homework');
                      onClose();
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl hover:bg-sky-50/80 dark:hover:bg-white/10"
                  >
                    <BookOpen className="w-4 h-4 text-sky-600 dark:text-neutral-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{h.title}</p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        {h.subject} · Due {h.dueDate}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Exams */}
          {results.matchedExams.length > 0 && (
            <div>
              <p className="px-2 pb-1.5 text-xs font-medium text-slate-500 dark:text-neutral-400">
                Examinations
              </p>
              <div className="divide-y divide-sky-100/70 dark:divide-white/10">
                {results.matchedExams.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => {
                      onNavigate('exams');
                      onClose();
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl hover:bg-sky-50/80 dark:hover:bg-white/10"
                  >
                    <GraduationCap className="w-4 h-4 text-sky-600 dark:text-neutral-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{ex.examName}</p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        {ex.subject} · {ex.examDate}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
