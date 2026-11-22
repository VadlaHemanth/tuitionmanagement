import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Edit3,
  PauseCircle,
  PlayCircle,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserMinus,
  X,
} from 'lucide-react';
import type {
  BoardType,
  ClassLevel,
  LearningSpeed,
  Student,
  StudentPriority,
  StudentStatus,
  WorkspaceSnapshot,
} from '../types';
import { calculateStudentMonthlyFee, previewStudentPromotion } from '../engines/feeEngine';
import { formatHHMMTo12Hour, formatRupeesFromPaise } from '../engines/istDate';

interface StudentsViewProps {
  workspace: WorkspaceSnapshot;
  selectedStudentId: string | null;
  onSelectStudent: (id: string | null) => void;
  onCreateStudent: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateStudent: (id: string, payload: Record<string, unknown>) => Promise<void>;
  onChangeStatus: (id: string, status: StudentStatus) => Promise<void>;
  onPermanentDelete: (id: string) => Promise<void>;
  onPromoteStudents: (params: {
    studentIds: string[];
    overridePolicy: 'keep_override' | 'adopt_class_rate';
    targetBoard?: BoardType;
  }) => Promise<void>;
  onRecordPaymentShortcut: (studentId: string) => void;
}

type ProfileTab = 'overview' | 'academics' | 'homework' | 'attendance' | 'fees' | 'exams' | 'timeline' | 'notes';

export const StudentsView: React.FC<StudentsViewProps> = ({
  workspace,
  selectedStudentId,
  onSelectStudent,
  onCreateStudent,
  onUpdateStudent,
  onChangeStatus,
  onPermanentDelete,
  onPromoteStudents,
  onRecordPaymentShortcut,
}) => {
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [boardFilter, setBoardFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [dueOnly, setDueOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'class' | 'arrival' | 'performance'>('arrival');

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [profileTab, setProfileTab] = useState<ProfileTab>('overview');
  const [confirmPermanentDeleteId, setConfirmPermanentDeleteId] = useState<string | null>(null);

  const selectedStudent = useMemo(
    () => workspace.students.find((s) => s.id === selectedStudentId) ?? null,
    [workspace.students, selectedStudentId],
  );

  const balanceByStudent = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of workspace.invoices) {
      if (inv.status === 'paid' || inv.status === 'waived') continue;
      const bal = Math.max(0, inv.totalAmountPaise - inv.paidAmountPaise);
      map.set(inv.studentId, (map.get(inv.studentId) ?? 0) + bal);
    }
    return map;
  }, [workspace.invoices]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workspace.students
      .filter((s) => {
        if (statusFilter !== 'all' && s.status !== statusFilter) return false;
        if (classFilter !== 'all' && String(s.classLevel) !== classFilter) return false;
        if (boardFilter !== 'all' && s.board !== boardFilter) return false;
        if (dueOnly && (balanceByStudent.get(s.id) ?? 0) <= 0) return false;
        if (q) {
          const hay = `${s.fullName} ${s.studentCode} ${s.schoolName} ${s.parentName} ${s.parentPhone} class ${s.classLevel} ${s.board}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.fullName.localeCompare(b.fullName);
        if (sortBy === 'class') return a.classLevel - b.classLevel || a.fullName.localeCompare(b.fullName);
        if (sortBy === 'performance') return b.academicPerformance - a.academicPerformance;
        return a.preferredArrivalTime.localeCompare(b.preferredArrivalTime);
      });
  }, [workspace.students, statusFilter, classFilter, boardFilter, dueOnly, search, sortBy, balanceByStudent]);

  // --- STUDENT PROFILE VIEW (8 TABS) ---
  if (selectedStudent) {
    const feeCalc = calculateStudentMonthlyFee({
      student: selectedStudent,
      feeConfig: workspace.settings.feeConfig,
      discounts: workspace.discounts,
      asOfDate: workspace.todayIst,
    });
    const stuHomework = workspace.homework.filter((h) => h.studentId === selectedStudent.id);
    const stuAttendance = workspace.attendance.filter((a) => a.studentId === selectedStudent.id);
    const stuInvoices = workspace.invoices.filter((i) => i.studentId === selectedStudent.id);
    const stuPayments = workspace.payments.filter((p) => p.studentId === selectedStudent.id);
    const stuExams = workspace.exams.filter((e) => e.studentId === selectedStudent.id);
    const stuProgress = workspace.progressLogs.filter((p) => p.studentId === selectedStudent.id);
    const outstanding = balanceByStudent.get(selectedStudent.id) ?? 0;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onSelectStudent(null)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-neutral-300 hover:text-slate-950 dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Students</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditingStudent(selectedStudent);
                setShowFormModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-sky-200 dark:border-white/20 bg-white/80 dark:bg-neutral-950 text-slate-800 dark:text-white"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Profile & Fee</span>
            </button>

            {selectedStudent.status === 'active' ? (
              <>
                <button
                  type="button"
                  onClick={() => onChangeStatus(selectedStudent.id, 'paused')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-300"
                >
                  <PauseCircle className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeStatus(selectedStudent.id, 'discontinued')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-rose-200 dark:border-white/20 text-rose-700 dark:text-neutral-300"
                >
                  <UserMinus className="w-3.5 h-3.5" />
                  <span>Discontinue</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onChangeStatus(selectedStudent.id, 'active')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restore Active (History Preserved)</span>
              </button>
            )}
          </div>
        </div>

        {/* Profile Header */}
        <div className="liquid-glass-strong rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-sky-600 dark:bg-white text-white dark:text-black flex items-center justify-center font-display font-bold text-xl shrink-0">
              {selectedStudent.fullName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-950 dark:text-white">{selectedStudent.fullName}</h1>
              <p className="text-sm text-slate-600 dark:text-neutral-400">
                Class {selectedStudent.classLevel} · {selectedStudent.board} · {selectedStudent.schoolName || 'School not set'} · <span className="capitalize">{selectedStudent.status}</span>
              </p>
              <p className="text-xs text-slate-500 dark:text-neutral-400 mt-1 font-mono tabular-nums">
                {selectedStudent.studentCode} · Arrives {formatHHMMTo12Hour(selectedStudent.preferredArrivalTime)} · Guardian: {selectedStudent.parentName} ({selectedStudent.parentPhone})
              </p>
            </div>
          </div>

          <div className="sm:text-right space-y-1">
            <p className="text-xs text-slate-500 dark:text-neutral-400">Monthly Tuition Fee</p>
            <p className="font-mono tabular-nums text-2xl font-bold text-slate-950 dark:text-white">
              {formatRupeesFromPaise(feeCalc.finalAmountPaise)}
            </p>
            <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-neutral-400">
              {outstanding > 0 ? `${formatRupeesFromPaise(outstanding)} unpaid balance` : 'No unpaid balance'}
            </p>
          </div>
        </div>

        {/* 8 Profile Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {(
            [
              ['overview', 'Overview'],
              ['academics', 'Academics'],
              ['homework', `Homework (${stuHomework.length})`],
              ['attendance', `Attendance (${stuAttendance.length})`],
              ['fees', `Fees (${stuInvoices.length})`],
              ['exams', `Exams (${stuExams.length})`],
              ['timeline', 'Timeline'],
              ['notes', 'Notes'],
            ] as [ProfileTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setProfileTab(id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                profileTab === id
                  ? 'bg-sky-600 text-white dark:bg-white dark:text-black'
                  : 'text-slate-600 dark:text-neutral-400 hover:bg-white/70 dark:hover:bg-white/10'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab Contents */}
        <div className="liquid-glass rounded-3xl p-5 sm:p-6">
          {profileTab === 'overview' && (
            <div className="grid md:grid-cols-2 gap-6 text-sm">
              <div className="space-y-3">
                <h2 className="text-base font-bold text-slate-950 dark:text-white">Enrollment & Schedule</h2>
                <dl className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-sky-100/70 dark:border-white/10">
                    <dt className="text-slate-500 dark:text-neutral-400">Admission Date</dt>
                    <dd className="font-mono text-slate-900 dark:text-white">{selectedStudent.admissionDate}</dd>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-sky-100/70 dark:border-white/10">
                    <dt className="text-slate-500 dark:text-neutral-400">Allocated Tuition Slot</dt>
                    <dd className="font-mono text-slate-900 dark:text-white">{selectedStudent.allocatedSlot} ({selectedStudent.expectedDurationMinutes}m)</dd>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-sky-100/70 dark:border-white/10">
                    <dt className="text-slate-500 dark:text-neutral-400">Learning Speed & Priority</dt>
                    <dd className="capitalize text-slate-900 dark:text-white">{selectedStudent.learningSpeed.replace('_', ' ')} · {selectedStudent.priority}</dd>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-sky-100/70 dark:border-white/10">
                    <dt className="text-slate-500 dark:text-neutral-400">Fee Due Day</dt>
                    <dd className="font-mono text-slate-900 dark:text-white">Day {selectedStudent.feeDueDay} of every month</dd>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <dt className="text-slate-500 dark:text-neutral-400">Address / Emergency</dt>
                    <dd className="text-slate-900 dark:text-white text-right">{selectedStudent.address || '—'} {selectedStudent.emergencyContact ? `· ${selectedStudent.emergencyContact}` : ''}</dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-3">
                <h2 className="text-base font-bold text-slate-950 dark:text-white">Live Fee Calculation Breakdown</h2>
                <ul className="space-y-1.5 text-xs text-slate-700 dark:text-neutral-300">
                  {feeCalc.steps.map((st, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-sky-600 dark:text-white shrink-0" />
                      <span>{st}</span>
                    </li>
                  ))}
                </ul>
                {selectedStudent.creditBalancePaise > 0 && (
                  <p className="text-xs font-mono text-emerald-700 dark:text-white pt-1">
                    Advance Credit Available: {formatRupeesFromPaise(selectedStudent.creditBalancePaise)}
                  </p>
                )}
              </div>
            </div>
          )}

          {profileTab === 'academics' && (
            <div className="space-y-4 text-sm">
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">Overall Performance</p>
                  <p className="font-mono tabular-nums text-2xl font-bold text-slate-950 dark:text-white mt-1">
                    {selectedStudent.academicPerformance}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">Subjects Studied</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white mt-1">
                    {selectedStudent.subjects.join(' · ') || 'None specified'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">Academic Goal</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white mt-1">
                    {selectedStudent.academicGoals || 'Steady syllabus mastery'}
                  </p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-sky-100 dark:border-white/15">
                <div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-neutral-300">Strengths</p>
                  <p className="text-sm text-slate-700 dark:text-neutral-300 mt-1">
                    {selectedStudent.strengths.join(', ') || 'Not recorded yet'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-neutral-300">Weak Areas / Focus Topics</p>
                  <p className="text-sm text-slate-700 dark:text-neutral-300 mt-1">
                    {selectedStudent.weaknesses.join(', ') || 'Not recorded yet'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {profileTab === 'homework' && (
            <div className="divide-y divide-sky-100/70 dark:divide-white/10">
              {stuHomework.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-neutral-400">No homework recorded for this student yet.</p>
              ) : (
                stuHomework.map((h) => (
                  <div key={h.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{h.title}</p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        {h.subject} · {h.topic || h.chapter} · Due {h.dueDate} · {h.estimatedMinutes}m
                      </p>
                    </div>
                    <span className="text-xs font-mono capitalize text-slate-700 dark:text-neutral-300">
                      {h.status.replace('_', ' ')} ({h.completionPct}%)
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {profileTab === 'attendance' && (
            <div className="divide-y divide-sky-100/70 dark:divide-white/10">
              {stuAttendance.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-neutral-400">No attendance history recorded yet.</p>
              ) : (
                stuAttendance.map((a) => (
                  <div key={a.id} className="py-2.5 flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-900 dark:text-white">{a.date}</span>
                    <span className="capitalize font-semibold text-slate-800 dark:text-neutral-200">{a.status}</span>
                    <span className="font-mono text-slate-500 dark:text-neutral-400">{a.actualArrivalTime || '—'}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {profileTab === 'fees' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-950 dark:text-white">Invoices & Payment History</h2>
                <button
                  type="button"
                  onClick={() => onRecordPaymentShortcut(selectedStudent.id)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
                >
                  Record Payment
                </button>
              </div>
              <div className="divide-y divide-sky-100/70 dark:divide-white/10 text-xs">
                {stuInvoices.map((inv) => (
                  <div key={inv.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        Month {inv.monthKey} · Class {inv.classLevelSnapshot} {inv.boardSnapshot}
                      </p>
                      <p className="text-slate-500 dark:text-neutral-400">
                        Due {inv.dueDate}{inv.discountSummary ? ` · ${inv.discountSummary}` : ''}
                      </p>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <p className="font-semibold text-slate-900 dark:text-white">
                        Paid {formatRupeesFromPaise(inv.paidAmountPaise)} / {formatRupeesFromPaise(inv.totalAmountPaise)}
                      </p>
                      <p className="capitalize text-slate-500 dark:text-neutral-400">{inv.status}</p>
                    </div>
                  </div>
                ))}
                {stuInvoices.length === 0 && (
                  <p className="text-sm text-slate-500 dark:text-neutral-400">No invoices generated for this student yet.</p>
                )}
              </div>
              {stuPayments.length > 0 && (
                <div className="pt-3 border-t border-sky-100 dark:border-white/15">
                  <p className="text-xs font-semibold text-slate-600 dark:text-neutral-400 mb-2">Receipts</p>
                  {stuPayments.map((p) => (
                    <div key={p.id} className="py-1.5 flex items-center justify-between text-xs font-mono tabular-nums">
                      <span>{p.receiptNumber} · {p.paymentDate} ({p.method.toUpperCase()})</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{formatRupeesFromPaise(p.amountPaise)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {profileTab === 'exams' && (
            <div className="divide-y divide-sky-100/70 dark:divide-white/10">
              {stuExams.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-neutral-400">No examinations recorded yet.</p>
              ) : (
                stuExams.map((ex) => (
                  <div key={ex.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{ex.examName}</p>
                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                        {ex.subject} · {ex.examDate} · {ex.syllabus}
                      </p>
                    </div>
                    <div className="text-right font-mono tabular-nums text-xs">
                      {ex.obtainedMarks != null ? (
                        <span className="font-bold text-slate-950 dark:text-white">
                          {ex.obtainedMarks}/{ex.maxMarks} ({Math.round((ex.obtainedMarks / ex.maxMarks) * 100)}%)
                        </span>
                      ) : (
                        <span className="text-slate-600 dark:text-neutral-300">Prep {ex.preparationStatus}%</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {profileTab === 'timeline' && (
            <div className="divide-y divide-sky-100/70 dark:divide-white/10">
              {stuProgress.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-neutral-400">
                  Daily study progress logs will appear here after each evening session.
                </p>
              ) : (
                stuProgress.map((pr) => (
                  <div key={pr.id} className="py-3 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-slate-900 dark:text-white">{pr.date}</span>
                      <span className="font-mono text-sky-700 dark:text-neutral-300">{pr.completionPct}% completed</span>
                    </div>
                    <p className="text-sm text-slate-800 dark:text-neutral-200">{pr.topicsStudied}</p>
                    {pr.teacherComment && (
                      <p className="text-xs text-slate-500 dark:text-neutral-400">{pr.teacherComment}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {profileTab === 'notes' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-800 dark:text-neutral-200 whitespace-pre-wrap">
                {selectedStudent.notes || 'No personal academic notes added yet.'}
              </p>

              {/* Separate Explicitly Confirmed Permanent Privacy Removal */}
              <div className="pt-6 mt-6 border-t border-sky-100 dark:border-white/15 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-neutral-300">Data Retention & Privacy</p>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    Normal discontinuation preserves all history. Permanent removal erases this student and all linked records irreversibly.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmPermanentDeleteId(selectedStudent.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-rose-300 dark:border-white/25 text-rose-700 dark:text-neutral-300 hover:bg-rose-50 dark:hover:bg-white/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Permanent Privacy Delete</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Permanent Delete Confirmation */}
        {confirmPermanentDeleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 dark:bg-black/80 backdrop-blur-sm p-4">
            <div className="liquid-glass-strong max-w-md w-full rounded-3xl p-6 space-y-4">
              <h3 className="text-lg font-bold text-slate-950 dark:text-white">Permanently erase student data?</h3>
              <p className="text-xs text-slate-600 dark:text-neutral-300 leading-relaxed">
                This will permanently remove <strong>{selectedStudent.fullName}</strong> along with attendance, homework, exam, and fee records. Use <strong>Discontinue</strong> instead if you want to keep historical records.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmPermanentDeleteId(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium border border-sky-200 dark:border-white/20"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const id = confirmPermanentDeleteId;
                    setConfirmPermanentDeleteId(null);
                    onSelectStudent(null);
                    await onPermanentDelete(id);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 dark:bg-white text-white dark:text-black"
                >
                  Yes, Permanently Erase
                </button>
              </div>
            </div>
          </div>
        )}

        {showFormModal && (
          <StudentFormModal
            workspace={workspace}
            initialStudent={editingStudent}
            onClose={() => {
              setShowFormModal(false);
              setEditingStudent(null);
            }}
            onSubmit={async (payload) => {
              if (editingStudent) {
                await onUpdateStudent(editingStudent.id, payload);
              } else {
                await onCreateStudent(payload);
              }
              setShowFormModal(false);
              setEditingStudent(null);
            }}
          />
        )}
      </div>
    );
  }

  // --- STUDENT DIRECTORY VIEW ---
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 dark:text-white">Students</h1>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
            Classes 3–10 · SSC, CBSE, ICSE · Automatic class-wise fee calculation & history-safe promotion
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowPromoteModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold border border-sky-200 dark:border-white/20 bg-white/80 dark:bg-neutral-950 text-slate-800 dark:text-white hover:bg-white dark:hover:bg-neutral-900 whitespace-nowrap"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Annual / Bulk Promotion</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingStudent(null);
              setShowFormModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Add Student</span>
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="liquid-glass rounded-2xl p-4 grid sm:grid-cols-12 gap-3 items-center">
        <div className="sm:col-span-4 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search students"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, parent, school, ID..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/70 dark:border-white/15 text-xs text-slate-900 dark:text-white focus:outline-none"
          />
        </div>
        <div className="sm:col-span-8 flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/70 dark:border-white/15 text-xs text-slate-800 dark:text-white"
          >
            <option value="active">Active</option>
            <option value="all">All Statuses</option>
            <option value="paused">Paused</option>
            <option value="discontinued">Discontinued</option>
            <option value="graduated">Graduated</option>
          </select>

          <select
            aria-label="Filter by class"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/70 dark:border-white/15 text-xs text-slate-800 dark:text-white"
          >
            <option value="all">All Classes</option>
            {[3, 4, 5, 6, 7, 8, 9, 10].map((c) => (
              <option key={c} value={String(c)}>Class {c}</option>
            ))}
          </select>

          <select
            aria-label="Filter by board"
            value={boardFilter}
            onChange={(e) => setBoardFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/70 dark:border-white/15 text-xs text-slate-800 dark:text-white"
          >
            <option value="all">All Boards</option>
            <option value="SSC">SSC</option>
            <option value="CBSE">CBSE</option>
            <option value="ICSE">ICSE</option>
          </select>

          <select
            aria-label="Sort students"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/70 dark:border-white/15 text-xs text-slate-800 dark:text-white"
          >
            <option value="arrival">Sort: Arrival Time</option>
            <option value="name">Sort: Name</option>
            <option value="class">Sort: Class</option>
            <option value="performance">Sort: Performance</option>
          </select>

          <button
            type="button"
            onClick={() => setDueOnly((v) => !v)}
            className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap ${
              dueOnly
                ? 'bg-sky-600 text-white border-sky-600 dark:bg-white dark:text-black dark:border-white'
                : 'bg-white/70 dark:bg-black border-sky-200/70 dark:border-white/15 text-slate-700 dark:text-neutral-300'
            }`}
          >
            Fees Due Only
          </button>
        </div>
      </div>

      {/* Student Roster Table */}
      <div className="liquid-glass rounded-3xl p-4 sm:p-6 overflow-x-auto">
        {filteredStudents.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <p className="text-sm text-slate-600 dark:text-neutral-400">No students match the current filters.</p>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setClassFilter('all');
                setBoardFilter('all');
                setStatusFilter('all');
                setDueOnly(false);
              }}
              className="text-xs font-semibold text-sky-700 dark:text-white hover:underline"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-sky-100 dark:border-white/15 text-xs text-slate-500 dark:text-neutral-400">
                <th className="py-2.5 pr-4 font-medium">Student</th>
                <th className="py-2.5 px-3 font-medium">Class & Board</th>
                <th className="py-2.5 px-3 font-medium">Arrival</th>
                <th className="py-2.5 px-3 text-right font-medium">Monthly Fee</th>
                <th className="py-2.5 px-3 text-right font-medium">Balance</th>
                <th className="py-2.5 pl-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-100/70 dark:divide-white/10 text-sm">
              {filteredStudents.map((s) => {
                const fee = calculateStudentMonthlyFee({
                  student: s,
                  feeConfig: workspace.settings.feeConfig,
                  discounts: workspace.discounts,
                  asOfDate: workspace.todayIst,
                });
                const bal = balanceByStudent.get(s.id) ?? 0;
                return (
                  <tr key={s.id} className="hover:bg-sky-50/50 dark:hover:bg-white/5 transition-colors">
                    <td className="py-3 pr-4">
                      <button
                        type="button"
                        onClick={() => {
                          setProfileTab('overview');
                          onSelectStudent(s.id);
                        }}
                        className="text-left group"
                      >
                        <p className="font-semibold text-slate-900 dark:text-white group-hover:text-sky-700 dark:group-hover:underline">
                          {s.fullName}
                          {s.isDemo ? <span className="ml-1.5 text-[11px] font-normal text-slate-400">(Sample)</span> : null}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-neutral-400">
                          {s.parentName} · {s.parentPhone}
                        </p>
                      </button>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-700 dark:text-neutral-300 whitespace-nowrap">
                      Class {s.classLevel} · {s.board}
                      <span className="block text-slate-400 dark:text-neutral-500 capitalize">{s.status}</span>
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-xs text-slate-700 dark:text-neutral-300 whitespace-nowrap">
                      {formatHHMMTo12Hour(s.preferredArrivalTime)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                      {formatRupeesFromPaise(fee.finalAmountPaise)}
                      {fee.overrideApplied && (
                        <span className="block text-[10px] font-sans font-normal text-sky-700 dark:text-neutral-400">Custom rate</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-xs whitespace-nowrap">
                      {bal > 0 ? (
                        <span className="font-semibold text-rose-700 dark:text-white">{formatRupeesFromPaise(bal)}</span>
                      ) : (
                        <span className="text-emerald-700 dark:text-neutral-400">Paid</span>
                      )}
                    </td>
                    <td className="py-3 pl-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setProfileTab('overview');
                            onSelectStudent(s.id);
                          }}
                          className="text-xs font-semibold text-sky-700 dark:text-white hover:underline"
                        >
                          Profile
                        </button>
                        {s.status === 'discontinued' && (
                          <button
                            type="button"
                            onClick={() => onChangeStatus(s.id, 'active')}
                            aria-label={`Restore ${s.fullName}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-white hover:underline"
                          >
                            <PlayCircle className="w-3.5 h-3.5" /> Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit Student Modal */}
      {showFormModal && (
        <StudentFormModal
          workspace={workspace}
          initialStudent={editingStudent}
          onClose={() => {
            setShowFormModal(false);
            setEditingStudent(null);
          }}
          onSubmit={async (payload) => {
            if (editingStudent) {
              await onUpdateStudent(editingStudent.id, payload);
            } else {
              await onCreateStudent(payload);
            }
            setShowFormModal(false);
            setEditingStudent(null);
          }}
        />
      )}

      {/* Bulk / Annual Promotion Modal */}
      {showPromoteModal && (
        <PromotionModal
          workspace={workspace}
          onClose={() => setShowPromoteModal(false)}
          onConfirm={async (params) => {
            await onPromoteStudents(params);
            setShowPromoteModal(false);
          }}
        />
      )}
    </div>
  );
};

interface StudentFormModalProps {
  workspace: WorkspaceSnapshot;
  initialStudent: Student | null;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

const StudentFormModal: React.FC<StudentFormModalProps> = ({
  workspace,
  initialStudent,
  onClose,
  onSubmit,
}) => {
  const [fullName, setFullName] = useState(initialStudent?.fullName ?? '');
  const [classLevel, setClassLevel] = useState<ClassLevel>(initialStudent?.classLevel ?? 7);
  const [board, setBoard] = useState<BoardType>(initialStudent?.board ?? 'CBSE');
  const [schoolName, setSchoolName] = useState(initialStudent?.schoolName ?? '');
  const [parentName, setParentName] = useState(initialStudent?.parentName ?? '');
  const [parentPhone, setParentPhone] = useState(initialStudent?.parentPhone ?? '');
  const [preferredArrivalTime, setPreferredArrivalTime] = useState(initialStudent?.preferredArrivalTime ?? '18:00');
  const [expectedDurationMinutes, setExpectedDurationMinutes] = useState(initialStudent?.expectedDurationMinutes ?? 90);
  const [feeDueDay, setFeeDueDay] = useState(initialStudent?.feeDueDay ?? workspace.settings.feeConfig.defaultDueDay);
  const [learningSpeed, setLearningSpeed] = useState<LearningSpeed>(initialStudent?.learningSpeed ?? 'steady');
  const [priority, setPriority] = useState<StudentPriority>(initialStudent?.priority ?? 'normal');
  const [subjectsText, setSubjectsText] = useState((initialStudent?.subjects ?? ['Mathematics', 'Science', 'English']).join(', '));
  const [weaknessesText, setWeaknessesText] = useState((initialStudent?.weaknesses ?? []).join(', '));
  const [academicGoals, setAcademicGoals] = useState(initialStudent?.academicGoals ?? '');
  const [notes, setNotes] = useState(initialStudent?.notes ?? '');

  // Custom Fee Override controls
  const [useOverride, setUseOverride] = useState(Boolean(initialStudent?.feeOverride));
  const [overrideRupees, setOverrideRupees] = useState(
    initialStudent?.feeOverride ? String(initialStudent.feeOverride.amountPaise / 100) : '',
  );
  const [overrideTemporary, setOverrideTemporary] = useState(initialStudent?.feeOverride?.isTemporary ?? false);
  const [overrideStart, setOverrideStart] = useState(initialStudent?.feeOverride?.startDate ?? workspace.todayIst);
  const [overrideEnd, setOverrideEnd] = useState(initialStudent?.feeOverride?.endDate ?? '');
  const [overrideReason, setOverrideReason] = useState(initialStudent?.feeOverride?.reason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewCalc = useMemo(() => {
    const ovNum = Number(overrideRupees);
    const feeOverride =
      useOverride && Number.isFinite(ovNum) && ovNum >= 0 && overrideRupees !== ''
        ? {
            amountPaise: Math.round(ovNum * 100),
            isTemporary: overrideTemporary,
            startDate: overrideTemporary ? overrideStart : undefined,
            endDate: overrideTemporary && overrideEnd ? overrideEnd : undefined,
            reason: overrideReason || undefined,
          }
        : null;

    return calculateStudentMonthlyFee({
      student: {
        id: initialStudent?.id ?? 'preview',
        classLevel,
        board,
        feeOverride,
        admissionDate: initialStudent?.admissionDate ?? workspace.todayIst,
      },
      feeConfig: workspace.settings.feeConfig,
      discounts: workspace.discounts,
      asOfDate: workspace.todayIst,
    });
  }, [
    useOverride,
    overrideRupees,
    overrideTemporary,
    overrideStart,
    overrideEnd,
    overrideReason,
    initialStudent,
    classLevel,
    board,
    workspace,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !parentName.trim() || parentPhone.trim().length < 7) {
      setError('Please enter student full name, guardian name, and valid guardian phone number.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ovNum = Number(overrideRupees);
      const feeOverride =
        useOverride && Number.isFinite(ovNum) && ovNum >= 0 && overrideRupees !== ''
          ? {
              amountPaise: Math.round(ovNum * 100),
              isTemporary: overrideTemporary,
              startDate: overrideTemporary ? overrideStart : undefined,
              endDate: overrideTemporary && overrideEnd ? overrideEnd : undefined,
              reason: overrideReason.trim() || undefined,
            }
          : null;

      await onSubmit({
        fullName: fullName.trim(),
        classLevel,
        board,
        schoolName: schoolName.trim(),
        parentName: parentName.trim(),
        parentPhone: parentPhone.trim(),
        preferredArrivalTime,
        allocatedSlot: `${preferredArrivalTime}–${workspace.settings.sessionEnd}`,
        expectedDurationMinutes,
        feeDueDay,
        learningSpeed,
        priority,
        subjects: subjectsText.split(',').map((s) => s.trim()).filter(Boolean),
        weaknesses: weaknessesText.split(',').map((s) => s.trim()).filter(Boolean),
        academicGoals: academicGoals.trim(),
        notes: notes.trim(),
        feeOverride,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save student.');
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 dark:bg-black/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={initialStudent ? 'Edit Student' : 'Add Student'}
    >
      <form
        onSubmit={handleSubmit}
        className="liquid-glass-strong w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">
              {initialStudent ? `Edit ${initialStudent.fullName}` : 'Enroll New Student'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              Monthly fee auto-calculates from Class & Board unless customized below
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close modal" className="p-2 rounded-xl hover:bg-sky-50 dark:hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-neutral-900 border border-rose-200 dark:border-white/25 text-xs text-rose-700 dark:text-white">
            {error}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="stu-name" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Student Full Name *
            </label>
            <input
              id="stu-name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Aarav Verma"
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label htmlFor="stu-school" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              School Name
            </label>
            <input
              id="stu-school"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              placeholder="e.g. Kendriya Vidyalaya"
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label htmlFor="stu-class" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Class (3–10)
            </label>
            <select
              id="stu-class"
              value={classLevel}
              onChange={(e) => setClassLevel(Number(e.target.value) as ClassLevel)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            >
              {[3, 4, 5, 6, 7, 8, 9, 10].map((c) => (
                <option key={c} value={c}>Class {c}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="stu-board" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Board
            </label>
            <select
              id="stu-board"
              value={board}
              onChange={(e) => setBoard(e.target.value as BoardType)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            >
              <option value="SSC">SSC / State Board</option>
              <option value="CBSE">CBSE</option>
              <option value="ICSE">ICSE</option>
            </select>
          </div>
          <div>
            <label htmlFor="stu-parent" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Parent / Guardian Name *
            </label>
            <input
              id="stu-parent"
              required
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
              placeholder="e.g. Rajesh Verma"
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label htmlFor="stu-phone" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Parent Phone *
            </label>
            <input
              id="stu-phone"
              required
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
              placeholder="e.g. 9876543210"
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label htmlFor="stu-arrival" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Preferred Arrival Time (IST)
            </label>
            <input
              id="stu-arrival"
              type="time"
              value={preferredArrivalTime}
              onChange={(e) => setPreferredArrivalTime(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="stu-dur" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
                Duration (min)
              </label>
              <input
                id="stu-dur"
                type="number"
                min={30}
                max={180}
                value={expectedDurationMinutes}
                onChange={(e) => setExpectedDurationMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="stu-due" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
                Fee Due Day
              </label>
              <input
                id="stu-due"
                type="number"
                min={1}
                max={28}
                value={feeDueDay}
                onChange={(e) => setFeeDueDay(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label htmlFor="stu-speed" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Learning Speed
            </label>
            <select
              id="stu-speed"
              value={learningSpeed}
              onChange={(e) => setLearningSpeed(e.target.value as LearningSpeed)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            >
              <option value="fast">Fast / Independent</option>
              <option value="steady">Steady</option>
              <option value="needs_support">Needs Extra Support</option>
            </select>
          </div>
          <div>
            <label htmlFor="stu-priority" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Teaching Priority
            </label>
            <select
              id="stu-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as StudentPriority)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            >
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label htmlFor="stu-subjects" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Subjects (comma-separated)
            </label>
            <input
              id="stu-subjects"
              value={subjectsText}
              onChange={(e) => setSubjectsText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label htmlFor="stu-weak" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Weak Topics (comma-separated)
            </label>
            <input
              id="stu-weak"
              value={weaknessesText}
              onChange={(e) => setWeaknessesText(e.target.value)}
              placeholder="e.g. Fractions, Algebra"
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* Live Fee Calculation Preview & Custom Override */}
        <div className="rounded-2xl p-4 bg-sky-50/75 dark:bg-neutral-900 border border-sky-200/70 dark:border-white/15 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-white">
                Calculated Monthly Fee: <span className="font-mono text-base">{formatRupeesFromPaise(previewCalc.finalAmountPaise)}</span>
              </p>
              <p className="text-[11px] text-slate-600 dark:text-neutral-400">
                {previewCalc.steps.slice(0, -1).join(' · ')}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-neutral-200 cursor-pointer">
              <input
                type="checkbox"
                checked={useOverride}
                onChange={(e) => setUseOverride(e.target.checked)}
                className="accent-sky-600 dark:accent-white"
              />
              <span>Custom Fee Override</span>
            </label>
          </div>

          {useOverride && (
            <div className="grid sm:grid-cols-3 gap-2.5 pt-2 border-t border-sky-200/60 dark:border-white/10">
              <div>
                <label className="block text-[11px] text-slate-600 dark:text-neutral-400 mb-1">Custom Amount (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={overrideRupees}
                  onChange={(e) => setOverrideRupees(e.target.value)}
                  placeholder="e.g. 650"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black border border-sky-200 dark:border-white/20 text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-600 dark:text-neutral-400 mb-1">Reason</label>
                <input
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Sibling / special plan"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black border border-sky-200 dark:border-white/20 text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-neutral-300 py-1.5">
                  <input
                    type="checkbox"
                    checked={overrideTemporary}
                    onChange={(e) => setOverrideTemporary(e.target.checked)}
                  />
                  <span>Temporary dates</span>
                </label>
              </div>
              {overrideTemporary && (
                <>
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-neutral-400 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={overrideStart}
                      onChange={(e) => setOverrideStart(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black border border-sky-200 dark:border-white/20 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-neutral-400 mb-1">End Date</label>
                    <input
                      type="date"
                      value={overrideEnd}
                      onChange={(e) => setOverrideEnd(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black border border-sky-200 dark:border-white/20 text-xs font-mono"
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="stu-goals" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Academic Goals
            </label>
            <input
              id="stu-goals"
              value={academicGoals}
              onChange={(e) => setAcademicGoals(e.target.value)}
              placeholder="e.g. Score 90%+ in Math & Science"
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label htmlFor="stu-notes" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Teacher Notes
            </label>
            <input
              id="stu-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Important study habits or parent preferences"
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-xs font-medium border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black disabled:opacity-60"
          >
            {saving ? 'Saving...' : initialStudent ? 'Save Changes' : 'Enroll Student'}
          </button>
        </div>
      </form>
    </div>
  );
};

interface PromotionModalProps {
  workspace: WorkspaceSnapshot;
  onClose: () => void;
  onConfirm: (params: {
    studentIds: string[];
    overridePolicy: 'keep_override' | 'adopt_class_rate';
  }) => Promise<void>;
}

const PromotionModal: React.FC<PromotionModalProps> = ({ workspace, onClose, onConfirm }) => {
  const activeStudents = useMemo(
    () => workspace.students.filter((s) => s.status === 'active'),
    [workspace.students],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() => activeStudents.map((s) => s.id));
  const [overridePolicy, setOverridePolicy] = useState<'keep_override' | 'adopt_class_rate'>('keep_override');
  const [running, setRunning] = useState(false);

  const previews = useMemo(
    () =>
      activeStudents.map((s) =>
        previewStudentPromotion({
          student: s,
          feeConfig: workspace.settings.feeConfig,
          discounts: workspace.discounts,
          effectiveDate: workspace.todayIst,
          overridePolicy,
        }),
      ),
    [activeStudents, workspace, overridePolicy],
  );

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 dark:bg-black/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Annual Promotion Preview"
    >
      <div className="liquid-glass-strong w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">Academic Year Promotion Preview</h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              Updates future billing rates only — historical invoices, receipts, and academic records remain untouched.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close promotion modal" className="p-2 rounded-xl hover:bg-sky-50 dark:hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-sky-50/80 dark:bg-neutral-900 border border-sky-200/70 dark:border-white/15 text-xs">
          <span className="font-medium text-slate-800 dark:text-neutral-200">
            For students with a custom fee override:
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOverridePolicy('keep_override')}
              className={`px-3 py-1.5 rounded-lg font-semibold ${
                overridePolicy === 'keep_override'
                  ? 'bg-sky-600 text-white dark:bg-white dark:text-black'
                  : 'border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-300'
              }`}
            >
              Preserve Custom Fee
            </button>
            <button
              type="button"
              onClick={() => setOverridePolicy('adopt_class_rate')}
              className={`px-3 py-1.5 rounded-lg font-semibold ${
                overridePolicy === 'adopt_class_rate'
                  ? 'bg-sky-600 text-white dark:bg-white dark:text-black'
                  : 'border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-300'
              }`}
            >
              Adopt New Class Fee
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-sky-100 dark:border-white/15 text-slate-500 dark:text-neutral-400">
                <th className="py-2 pr-2">Select</th>
                <th className="py-2 px-2">Student</th>
                <th className="py-2 px-2">Class Change</th>
                <th className="py-2 px-2 text-right">Current Fee</th>
                <th className="py-2 px-2 text-right">New Future Fee</th>
                <th className="py-2 pl-2">Rule Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-100/70 dark:divide-white/10">
              {previews.map((p) => (
                <tr key={p.studentId}>
                  <td className="py-2.5 pr-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(p.studentId)}
                      onChange={() => toggle(p.studentId)}
                      aria-label={`Select ${p.studentName} for promotion`}
                    />
                  </td>
                  <td className="py-2.5 px-2 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                    {p.studentName}
                  </td>
                  <td className="py-2.5 px-2 font-mono whitespace-nowrap text-slate-700 dark:text-neutral-300">
                    Class {p.currentClass} {p.board} → {p.nextClass === 'graduated' ? 'Graduated' : `Class ${p.nextClass}`}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-neutral-400">
                    {formatRupeesFromPaise(p.currentFeePaise)}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums font-semibold text-slate-950 dark:text-white">
                    {p.nextClass === 'graduated' ? '—' : formatRupeesFromPaise(p.effectiveNextFeePaise)}
                  </td>
                  <td className="py-2.5 pl-2 text-slate-500 dark:text-neutral-400">{p.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-slate-500 dark:text-neutral-400">
            {selectedIds.length} student{selectedIds.length === 1 ? '' : 's'} selected
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium border border-sky-200 dark:border-white/20"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0 || running}
              onClick={async () => {
                setRunning(true);
                await onConfirm({ studentIds: selectedIds, overridePolicy });
                setRunning(false);
              }}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black disabled:opacity-50"
            >
              {running ? 'Promoting...' : `Confirm Promote (${selectedIds.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
