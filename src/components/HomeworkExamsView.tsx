import React, { useMemo, useState } from 'react';
import {
  Check,
  Forward,
  GraduationCap,
  HelpCircle,
  Mic,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { ExamType, HomeworkSource, PriorityLevel, WorkspaceSnapshot } from '../types';
import { addDaysToDateStr, diffDaysBetweenDateStrs } from '../engines/istDate';

// --- HOMEWORK VIEW ---

interface HomeworkViewProps {
  workspace: WorkspaceSnapshot;
  onCreateHomework: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateHomework: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDeleteHomework: (id: string) => Promise<void>;
  onCarryForward: () => Promise<number>;
}

export const HomeworkView: React.FC<HomeworkViewProps> = ({
  workspace,
  onCreateHomework,
  onUpdateHomework,
  onDeleteHomework,
  onCarryForward,
}) => {
  const [filterStudent, setFilterStudent] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'pending' | 'all' | 'completed'>('pending');
  const [showAddModal, setShowAddModal] = useState(false);
  const [carryNotice, setCarryNotice] = useState<string | null>(null);

  // Quick Add state
  const [targetStudents, setTargetStudents] = useState<string[]>([]);
  const [subject, setSubject] = useState('Mathematics');
  const [chapter, setChapter] = useState('');
  const [topic, setTopic] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueDate, setDueDate] = useState(addDaysToDateStr(workspace.todayIst, 1));
  const [estimatedMinutes, setEstimatedMinutes] = useState(20);
  const [priority, setPriority] = useState<PriorityLevel>('normal');
  const [source, setSource] = useState<HomeworkSource>('tuition');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeStudents = useMemo(
    () => workspace.students.filter((s) => s.status === 'active'),
    [workspace.students],
  );
  const studentMap = useMemo(() => new Map(workspace.students.map((s) => [s.id, s])), [workspace.students]);

  const filteredHw = useMemo(() => {
    return workspace.homework.filter((h) => {
      if (filterStudent !== 'all' && h.studentId !== filterStudent) return false;
      const done = h.status === 'completed' || h.status === 'verified';
      if (filterStatus === 'pending' && done) return false;
      if (filterStatus === 'completed' && !done) return false;
      return true;
    });
  }, [workspace.homework, filterStudent, filterStatus]);

  const groupedByStudent = useMemo(() => {
    const map = new Map<string, typeof filteredHw>();
    for (const h of filteredHw) {
      const list = map.get(h.studentId) ?? [];
      list.push(h);
      map.set(h.studentId, list);
    }
    return Array.from(map.entries());
  }, [filteredHw]);

  const startVoiceInput = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void;
        onend: () => void;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void;
        onend: () => void;
        start: () => void;
      };
    };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-IN';
    setListening(true);
    rec.onresult = (ev) => {
      const transcript = ev.results[0][0].transcript;
      setTitle((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onend = () => setListening(false);
    rec.start();
  };

  const applyTemplate = (tplId: string) => {
    const tpl = workspace.templates.find((t) => t.id === tplId);
    if (!tpl) return;
    setSubject(tpl.subject);
    setChapter(tpl.chapter);
    setTopic(tpl.topic);
    setTitle(tpl.title);
    setInstructions(tpl.instructions);
    setEstimatedMinutes(tpl.estimatedMinutes);
    setSource(tpl.source);
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ids = targetStudents.length > 0 ? targetStudents : activeStudents.slice(0, 1).map((s) => s.id);
    if (ids.length === 0 || !title.trim()) return;
    setSaving(true);
    try {
      await onCreateHomework({
        studentIds: ids,
        subject,
        chapter: chapter.trim(),
        topic: topic.trim(),
        title: title.trim(),
        instructions: instructions.trim(),
        dueDate,
        estimatedMinutes,
        priority,
        source,
        saveAsTemplate,
      });
      setTitle('');
      setInstructions('');
      setShowAddModal(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 dark:text-white">Homework & Study Tasks</h1>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
            One-tap Done / Partial / Needs Help · Duplicate-safe carry-forward · Reusable templates
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              const count = await onCarryForward();
              setCarryNotice(
                count > 0
                  ? `Carried ${count} unfinished task${count === 1 ? '' : 's'} forward to tomorrow without duplicates.`
                  : 'All unfinished tasks due today are already carried forward.',
              );
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold border border-sky-200 dark:border-white/20 bg-white/80 dark:bg-neutral-950 text-slate-800 dark:text-white whitespace-nowrap"
          >
            <Forward className="w-4 h-4" />
            <span>Carry Forward Incomplete</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTargetStudents(activeStudents[0] ? [activeStudents[0].id] : []);
              setShowAddModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Assign Homework</span>
          </button>
        </div>
      </div>

      {carryNotice && (
        <div className="liquid-glass rounded-2xl px-4 py-3 flex items-center justify-between text-xs text-slate-800 dark:text-white">
          <span>{carryNotice}</span>
          <button type="button" onClick={() => setCarryNotice(null)} aria-label="Dismiss notice">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center p-1 rounded-xl liquid-glass gap-1">
          {(['pending', 'completed', 'all'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${
                filterStatus === st
                  ? 'bg-sky-600 text-white dark:bg-white dark:text-black'
                  : 'text-slate-600 dark:text-neutral-400'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <select
          aria-label="Filter homework by student"
          value={filterStudent}
          onChange={(e) => setFilterStudent(e.target.value)}
          className="px-3 py-2 rounded-xl liquid-glass text-xs text-slate-800 dark:text-white"
        >
          <option value="all">All Students</option>
          {activeStudents.map((s) => (
            <option key={s.id} value={s.id}>{s.fullName} (Class {s.classLevel} {s.board})</option>
          ))}
        </select>
      </div>

      {/* Student-grouped Homework Lists */}
      {groupedByStudent.length === 0 ? (
        <div className="liquid-glass rounded-3xl p-10 text-center space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-neutral-300">
            No {filterStatus === 'pending' ? 'pending' : ''} homework tasks here.
          </p>
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            Use Assign Homework to add tasks for one student or bulk-assign to an entire class.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByStudent.map(([studentId, items]) => {
            const stu = studentMap.get(studentId);
            return (
              <section key={studentId} className="liquid-glass rounded-3xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-slate-950 dark:text-white">
                      {stu?.fullName ?? 'Student'}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-neutral-400">
                      {stu ? `Class ${stu.classLevel} · ${stu.board}` : ''} · {items.length} task{items.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>

                <div className="divide-y divide-sky-100/80 dark:divide-white/10">
                  {items.map((hw) => {
                    const isDone = hw.status === 'completed' || hw.status === 'verified';
                    return (
                      <div key={hw.id} className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="space-y-0.5 min-w-0">
                          <p className={`text-sm font-semibold ${isDone ? 'line-through text-slate-400 dark:text-neutral-500' : 'text-slate-900 dark:text-white'}`}>
                            {hw.subject} — {hw.title}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-neutral-400">
                            {hw.topic || hw.chapter || hw.source} · Due {hw.dueDate} · {hw.estimatedMinutes} min · {hw.completionPct}%
                            {hw.needsHelp ? ' · Needs Teacher Help' : ''}
                            {hw.status === 'carried_forward' ? ' · Carried Forward' : ''}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onUpdateHomework(hw.id, { status: 'completed', completionPct: 100, teacherVerified: true, needsHelp: false })}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                              isDone
                                ? 'bg-emerald-600 text-white dark:bg-white dark:text-black'
                                : 'border border-sky-200 dark:border-white/20 text-slate-800 dark:text-white hover:bg-sky-50 dark:hover:bg-white/10'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" /> Done
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateHomework(hw.id, { status: 'partial', completionPct: 50 })}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                              hw.status === 'partial'
                                ? 'bg-amber-600 text-white dark:bg-neutral-300 dark:text-black'
                                : 'border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-300'
                            }`}
                          >
                            Partial
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateHomework(hw.id, { status: 'not_started', completionPct: 0 })}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-300"
                          >
                            Not Done
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateHomework(hw.id, { needsHelp: !hw.needsHelp })}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                              hw.needsHelp
                                ? 'bg-rose-600 text-white dark:bg-neutral-700 dark:text-white'
                                : 'border border-sky-200 dark:border-white/20 text-slate-700 dark:text-neutral-300'
                            }`}
                          >
                            <HelpCircle className="w-3.5 h-3.5" /> Needs Help
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete homework ${hw.title}`}
                            onClick={() => onDeleteHomework(hw.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-white"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Assign Homework Modal (Multi-Student, Templates & Voice-to-Text) */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 dark:bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Assign Homework"
        >
          <form onSubmit={handleAssignSubmit} className="liquid-glass-strong w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">Assign Homework</h2>
              <button type="button" onClick={() => setShowAddModal(false)} aria-label="Close homework modal" className="p-2 rounded-xl">
                <X className="w-4 h-4" />
              </button>
            </div>

            {workspace.templates.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-neutral-400 mb-1">
                  Quick Fill from Template
                </label>
                <select
                  defaultValue=""
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-xs text-slate-900 dark:text-white"
                >
                  <option value="">Choose a reusable template (optional)...</option>
                  {workspace.templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.subject}: {t.title} ({t.estimatedMinutes}m)</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-slate-700 dark:text-neutral-300">Assign to Student(s)</span>
                <button
                  type="button"
                  onClick={() => setTargetStudents(activeStudents.map((s) => s.id))}
                  className="text-xs font-semibold text-sky-700 dark:text-white hover:underline"
                >
                  Select All Active
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {activeStudents.map((s) => {
                  const selected = targetStudents.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setTargetStudents((prev) =>
                          prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                        )
                      }
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${
                        selected
                          ? 'bg-sky-600 text-white border-sky-600 dark:bg-white dark:text-black dark:border-white'
                          : 'bg-white/70 dark:bg-black border-sky-200 dark:border-white/15 text-slate-700 dark:text-neutral-300'
                      }`}
                    >
                      {s.fullName} (C{s.classLevel})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Subject</label>
                <select
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
                >
                  {workspace.settings.subjects.map((sub) => (
                    <option key={sub} value={sub}>{sub}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Topic / Concept</label>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Fractions, Photosynthesis"
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="hw-title" className="text-xs font-medium text-slate-700 dark:text-neutral-300">
                  Homework Title *
                </label>
                <button
                  type="button"
                  onClick={startVoiceInput}
                  className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-white"
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>{listening ? 'Listening...' : 'Voice Dictate'}</span>
                </button>
              </div>
              <input
                id="hw-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Exercise 5.2, Questions 1–10"
                className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Est. Minutes</label>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={estimatedMinutes}
                  onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Source</label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as HomeworkSource)}
                  className="w-full px-2.5 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-xs text-slate-900 dark:text-white"
                >
                  <option value="tuition">Tuition</option>
                  <option value="school">School</option>
                </select>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-xs text-slate-900 dark:text-white"
                >
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-neutral-300 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveAsTemplate}
                    onChange={(e) => setSaveAsTemplate(e.target.checked)}
                  />
                  <span>Save as reusable template</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-sky-200 dark:border-white/20"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
              >
                {saving ? 'Assigning...' : 'Assign Task'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

// --- EXAMS VIEW ---

interface ExamsViewProps {
  workspace: WorkspaceSnapshot;
  onCreateExam: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateExam: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDeleteExam: (id: string) => Promise<void>;
}

export const ExamsView: React.FC<ExamsViewProps> = ({
  workspace,
  onCreateExam,
  onUpdateExam,
  onDeleteExam,
}) => {
  const [showAdd, setShowAdd] = useState(false);
  const [studentId, setStudentId] = useState(workspace.students.find((s) => s.status === 'active')?.id ?? '');
  const [subject, setSubject] = useState('Mathematics');
  const [examName, setExamName] = useState('');
  const [examType, setExamType] = useState<ExamType>('unit_test');
  const [examDate, setExamDate] = useState(addDaysToDateStr(workspace.todayIst, 3));
  const [syllabus, setSyllabus] = useState('');
  const [maxMarks, setMaxMarks] = useState(40);
  const [revisionPlan, setRevisionPlan] = useState('');
  const [marksEntryId, setMarksEntryId] = useState<string | null>(null);
  const [marksValue, setMarksValue] = useState('');

  const studentMap = useMemo(() => new Map(workspace.students.map((s) => [s.id, s])), [workspace.students]);

  const upcoming = useMemo(
    () =>
      workspace.exams
        .filter((e) => e.obtainedMarks == null)
        .map((e) => ({ ...e, daysUntil: diffDaysBetweenDateStrs(workspace.todayIst, e.examDate) }))
        .sort((a, b) => a.daysUntil - b.daysUntil),
    [workspace.exams, workspace.todayIst],
  );

  const completed = useMemo(
    () => workspace.exams.filter((e) => e.obtainedMarks != null).sort((a, b) => b.examDate.localeCompare(a.examDate)),
    [workspace.exams],
  );

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId || !examName.trim()) return;
    await onCreateExam({
      studentId,
      subject,
      examName: examName.trim(),
      examType,
      examDate,
      syllabus: syllabus.trim(),
      maxMarks,
      revisionPlan: revisionPlan.trim() || 'Daily 20-minute paced revision',
      preparationStatus: 30,
    });
    setExamName('');
    setSyllabus('');
    setShowAdd(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 dark:text-white">Examinations & Revision</h1>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
            Exams within 1–3 days auto-escalate in today’s 6:00–8:00 PM schedule · Track marks & subject mastery
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black whitespace-nowrap self-start"
        >
          <Plus className="w-4 h-4" />
          <span>Add Examination</span>
        </button>
      </div>

      {/* Upcoming Exams */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-slate-950 dark:text-white">
          Upcoming Exams ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <div className="liquid-glass rounded-3xl p-8 text-center text-sm text-slate-500 dark:text-neutral-400">
            No upcoming exams scheduled. Add upcoming school tests or tuition revision tests to auto-plan revision.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {upcoming.map((ex) => {
              const stu = studentMap.get(ex.studentId);
              const urgent = ex.daysUntil <= 1;
              return (
                <div key={ex.id} className="liquid-glass rounded-3xl p-5 space-y-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono font-semibold text-sky-700 dark:text-neutral-300">
                        {ex.daysUntil < 0
                          ? `Date passed (${ex.examDate}) — Enter Marks`
                          : ex.daysUntil === 0
                            ? 'TODAY'
                            : ex.daysUntil === 1
                              ? 'TOMORROW — High Priority'
                              : `In ${ex.daysUntil} days · ${ex.examDate}`}
                      </p>
                      <h3 className="text-base font-bold text-slate-950 dark:text-white mt-0.5">
                        {stu?.fullName ?? 'Student'} — {ex.subject}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-neutral-400">
                        {ex.examName} · Max {ex.maxMarks} marks{urgent ? ' · Auto-prioritized today' : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteExam(ex.id)}
                      aria-label={`Delete exam ${ex.examName}`}
                      className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-white"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {ex.syllabus && (
                    <p className="text-xs text-slate-700 dark:text-neutral-300">
                      <strong>Syllabus:</strong> {ex.syllabus}
                    </p>
                  )}
                  {ex.revisionPlan && (
                    <p className="text-xs text-slate-600 dark:text-neutral-400">
                      <strong>Revision Plan:</strong> {ex.revisionPlan}
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 dark:text-neutral-400">Preparation Progress</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-white">{ex.preparationStatus}%</span>
                    </div>
                    <input
                      type="range"
                      aria-label={`Preparation progress for ${ex.examName}`}
                      min={0}
                      max={100}
                      step={5}
                      value={ex.preparationStatus}
                      onChange={(e) => onUpdateExam(ex.id, { preparationStatus: Number(e.target.value) })}
                      className="w-full accent-sky-600 dark:accent-white"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-sky-100 dark:border-white/15">
                    {marksEntryId === ex.id ? (
                      <div className="flex items-center gap-2 w-full">
                        <input
                          type="number"
                          min={0}
                          max={ex.maxMarks}
                          value={marksValue}
                          onChange={(e) => setMarksValue(e.target.value)}
                          placeholder={`Marks / ${ex.maxMarks}`}
                          className="flex-1 px-3 py-1.5 rounded-lg bg-white dark:bg-black border border-sky-200 dark:border-white/20 text-xs font-mono"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const num = Number(marksValue);
                            if (!Number.isFinite(num)) return;
                            await onUpdateExam(ex.id, { obtainedMarks: num, preparationStatus: 100 });
                            setMarksEntryId(null);
                            setMarksValue('');
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setMarksEntryId(ex.id);
                          setMarksValue('');
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-white hover:underline"
                      >
                        <GraduationCap className="w-4 h-4" />
                        <span>Record Marks</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Completed Exam Results */}
      <section className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-4 overflow-x-auto">
        <h2 className="text-base font-bold text-slate-950 dark:text-white">Results & Performance History</h2>
        {completed.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-neutral-400">Recorded marks and percentages will appear here.</p>
        ) : (
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-sky-100 dark:border-white/15 text-xs text-slate-500 dark:text-neutral-400">
                <th className="py-2 pr-4 font-medium">Student</th>
                <th className="py-2 px-3 font-medium">Exam & Subject</th>
                <th className="py-2 px-3 font-medium">Date</th>
                <th className="py-2 pl-3 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-100/70 dark:divide-white/10">
              {completed.map((ex) => {
                const stu = studentMap.get(ex.studentId);
                const pct = ex.obtainedMarks != null ? Math.round((ex.obtainedMarks / ex.maxMarks) * 100) : 0;
                return (
                  <tr key={ex.id}>
                    <td className="py-3 pr-4 font-semibold text-slate-900 dark:text-white">{stu?.fullName ?? 'Student'}</td>
                    <td className="py-3 px-3 text-xs text-slate-700 dark:text-neutral-300">
                      {ex.subject} · {ex.examName}
                    </td>
                    <td className="py-3 px-3 font-mono text-xs text-slate-500 dark:text-neutral-400">{ex.examDate}</td>
                    <td className="py-3 pl-3 text-right font-mono tabular-nums text-xs font-bold text-slate-950 dark:text-white">
                      {ex.obtainedMarks}/{ex.maxMarks} ({pct}%)
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 dark:bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add Examination"
        >
          <form onSubmit={handleAdd} className="liquid-glass-strong w-full max-w-lg rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-950 dark:text-white">Schedule Examination</h2>
              <button type="button" onClick={() => setShowAdd(false)} aria-label="Close exam modal"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Student</label>
                <select
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
                >
                  {workspace.students.filter((s) => s.status === 'active').map((s) => (
                    <option key={s.id} value={s.id}>{s.fullName} (Class {s.classLevel})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Subject</label>
                <select
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
                >
                  {workspace.settings.subjects.map((sub) => (
                    <option key={sub} value={sub}>{sub}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Exam Name *</label>
                <input
                  required
                  value={examName}
                  onChange={(e) => setExamName(e.target.value)}
                  placeholder="e.g. Unit Test 2 — Quadratic Equations"
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Exam Date</label>
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Max Marks</label>
                <input
                  type="number"
                  min={5}
                  max={500}
                  value={maxMarks}
                  onChange={(e) => setMaxMarks(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Exam Type</label>
                <select
                  value={examType}
                  onChange={(e) => setExamType(e.target.value as ExamType)}
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-xs text-slate-900 dark:text-white"
                >
                  <option value="unit_test">Unit Test</option>
                  <option value="school_exam">School Exam</option>
                  <option value="weekly_test">Weekly Test</option>
                  <option value="revision_test">Revision Test</option>
                  <option value="tuition_test">Tuition Test</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Revision Plan</label>
                <input
                  value={revisionPlan}
                  onChange={(e) => setRevisionPlan(e.target.value)}
                  placeholder="20 min daily practice"
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Syllabus / Chapters</label>
                <input
                  value={syllabus}
                  onChange={(e) => setSyllabus(e.target.value)}
                  placeholder="Chapters 4, 5 & key diagrams"
                  className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-xl text-xs border border-sky-200 dark:border-white/20">Cancel</button>
              <button type="submit" className="px-5 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black">Save Exam</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
