import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AttendanceRecord,
  AuditLogEntry,
  DailyProgressLog,
  DiscountRule,
  ExamItem,
  FeeInvoice,
  FeePayment,
  HomeworkItem,
  HomeworkTemplate,
  NotificationItem,
  Student,
  TuitionSettings,
  WorkspaceSnapshot,
} from '../src/types';
import { formatIstDate, formatIstMonthKey } from '../src/engines/istDate';
import { evaluateFeeReminders } from '../src/engines/feeEngine';
import { buildDemoDataset, createDefaultSettings, createDefaultTemplates } from './demoSeed';

const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || './data/tuitio.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

const MIGRATION_PATH = path.resolve(process.cwd(), 'cloudflare/migrations/0001_initial.sql');
const schemaSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
db.exec(schemaSql);

// Ensure default settings & templates exist
function ensureBootstrapDefaults() {
  const row = db.prepare('SELECT id FROM app_settings WHERE id = ?').get('default');
  if (!row) {
    const def = createDefaultSettings();
    db.prepare('INSERT INTO app_settings (id, settings_json, updated_at) VALUES (?, ?, ?)').run(
      'default',
      JSON.stringify(def),
      new Date().toISOString(),
    );
  }
  const tplCount = db.prepare('SELECT COUNT(*) as c FROM homework_templates').get() as { c: number };
  if (tplCount.c === 0) {
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO homework_templates (id, title, subject, chapter, topic, instructions, estimated_minutes, source, class_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const t of createDefaultTemplates()) {
      stmt.run(
        t.id,
        t.title,
        t.subject,
        t.chapter,
        t.topic,
        t.instructions,
        t.estimatedMinutes,
        t.source,
        t.classLevel ?? null,
      );
    }
  }
}

ensureBootstrapDefaults();

// Password hashing using Node scrypt + timingSafeEqual
export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return { hash: derived, salt: actualSalt };
}

export function verifyPassword(password: string, storedHash: string, storedSalt: string): boolean {
  const derived = crypto.scryptSync(password, storedSalt, 64);
  const target = Buffer.from(storedHash, 'hex');
  if (derived.length !== target.length) return false;
  return crypto.timingSafeEqual(derived, target);
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

export function logAudit(action: string, entityType: string, entityId: string, summary: string) {
  db.prepare(
    'INSERT INTO audit_logs (id, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(generateId('aud'), action, entityType, entityId, summary, new Date().toISOString());
}

export function getSettings(): TuitionSettings {
  const row = db.prepare('SELECT settings_json FROM app_settings WHERE id = ?').get('default') as
    | { settings_json: string }
    | undefined;
  if (!row) return createDefaultSettings();
  const parsed = JSON.parse(row.settings_json) as Partial<TuitionSettings>;
  const defaults = createDefaultSettings();
  return {
    ...defaults,
    ...parsed,
    feeConfig: { ...defaults.feeConfig, ...(parsed.feeConfig || {}) },
    reminders: { ...defaults.reminders, ...(parsed.reminders || {}) },
  };
}

export function saveSettings(settings: TuitionSettings): TuitionSettings {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO app_settings (id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at',
  ).run('default', JSON.stringify(settings), now);
  return settings;
}

export function getTeacherCount(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM teachers').get() as { c: number };
  return row.c;
}

export function createSession(teacherId: string): { token: string; expiresAt: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(); // 14 days
  db.prepare(
    'INSERT INTO sessions (token_hash, teacher_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(tokenHash, teacherId, expiresAt, new Date().toISOString());
  return { token: rawToken, expiresAt };
}

export function getSessionTeacher(rawToken: string): { id: string; email: string; name: string } | null {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const row = db
    .prepare(
      `SELECT t.id, t.email, t.name, s.expires_at
       FROM sessions s
       JOIN teachers t ON t.id = s.teacher_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as { id: string; email: string; name: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

export function deleteSession(rawToken: string): void {
  if (!rawToken) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(rawToken));
}

export function seedDemoWorkspace(): void {
  const existingDemo = db.prepare('SELECT COUNT(*) as c FROM students WHERE is_demo = 1').get() as { c: number };
  if (existingDemo.c > 0) return;

  const data = buildDemoDataset(new Date());

  const insertStudent = db.prepare(`
    INSERT OR IGNORE INTO students (
      id, student_code, full_name, avatar_color, class_level, board, school_name,
      admission_date, date_of_birth, student_phone, parent_name, parent_phone,
      emergency_contact, address, subjects_json, strengths_json, weaknesses_json,
      academic_performance, preferred_arrival_time, allocated_slot, expected_duration_minutes,
      regular_days_json, fee_due_day, fee_override_json, credit_balance_paise, notes,
      learning_speed, priority, academic_goals, status, discontinued_at, is_demo, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const s of data.students) {
    insertStudent.run(
      s.id,
      s.studentCode,
      s.fullName,
      s.avatarColor,
      s.classLevel,
      s.board,
      s.schoolName,
      s.admissionDate,
      s.dateOfBirth ?? null,
      s.studentPhone ?? null,
      s.parentName,
      s.parentPhone,
      s.emergencyContact ?? null,
      s.address ?? null,
      JSON.stringify(s.subjects),
      JSON.stringify(s.strengths),
      JSON.stringify(s.weaknesses),
      s.academicPerformance,
      s.preferredArrivalTime,
      s.allocatedSlot,
      s.expectedDurationMinutes,
      JSON.stringify(s.regularDays),
      s.feeDueDay,
      s.feeOverride ? JSON.stringify(s.feeOverride) : null,
      s.creditBalancePaise,
      s.notes,
      s.learningSpeed,
      s.priority,
      s.academicGoals,
      s.status,
      s.discontinuedAt ?? null,
      1,
      s.createdAt,
      s.updatedAt,
    );
  }

  const insertDiscount = db.prepare(`
    INSERT OR IGNORE INTO discounts (id, name, kind, value, scope, student_id, class_level, board, start_date, end_date, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const d of data.discounts) {
    insertDiscount.run(
      d.id,
      d.name,
      d.kind,
      d.value,
      d.scope,
      d.studentId ?? null,
      d.classLevel ?? null,
      d.board ?? null,
      d.startDate ?? null,
      d.endDate ?? null,
      d.active ? 1 : 0,
      d.createdAt,
    );
  }

  const insertAtt = db.prepare(`
    INSERT OR IGNORE INTO attendance (id, student_id, date, status, actual_arrival_time, departure_time, note, is_demo, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const a of data.attendance) {
    insertAtt.run(
      a.id,
      a.studentId,
      a.date,
      a.status,
      a.actualArrivalTime ?? null,
      a.departureTime ?? null,
      a.note ?? '',
      1,
      a.updatedAt,
    );
  }

  const insertHw = db.prepare(`
    INSERT OR IGNORE INTO homework (
      id, student_id, subject, chapter, topic, title, instructions, assigned_date, due_date,
      estimated_minutes, priority, source, completion_pct, status, completed_date,
      teacher_verified, needs_help, remarks, carried_from_id, is_demo, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const h of data.homework) {
    insertHw.run(
      h.id,
      h.studentId,
      h.subject,
      h.chapter,
      h.topic,
      h.title,
      h.instructions,
      h.assignedDate,
      h.dueDate,
      h.estimatedMinutes,
      h.priority,
      h.source,
      h.completionPct,
      h.status,
      h.completedDate ?? null,
      h.teacherVerified ? 1 : 0,
      h.needsHelp ? 1 : 0,
      h.remarks,
      h.carriedFromId ?? null,
      1,
      h.updatedAt,
    );
  }

  const insertExam = db.prepare(`
    INSERT OR IGNORE INTO exams (
      id, student_id, subject, exam_name, exam_type, exam_date, syllabus, max_marks,
      obtained_marks, important_chapters_json, preparation_status, revision_plan, weak_areas_json, is_demo, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const e of data.exams) {
    insertExam.run(
      e.id,
      e.studentId,
      e.subject,
      e.examName,
      e.examType,
      e.examDate,
      e.syllabus,
      e.maxMarks,
      e.obtainedMarks ?? null,
      JSON.stringify(e.importantChapters),
      e.preparationStatus,
      e.revisionPlan,
      JSON.stringify(e.weakAreas),
      1,
      e.updatedAt,
    );
  }

  const insertInv = db.prepare(`
    INSERT OR IGNORE INTO fee_invoices (
      id, student_id, month_key, class_level_snapshot, board_snapshot, base_amount_paise,
      board_surcharge_paise, override_applied, discount_paise, discount_summary,
      total_amount_paise, paid_amount_paise, due_date, status, notes, is_demo, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const inv of data.invoices) {
    insertInv.run(
      inv.id,
      inv.studentId,
      inv.monthKey,
      inv.classLevelSnapshot,
      inv.boardSnapshot,
      inv.baseAmountPaise,
      inv.boardSurchargePaise,
      inv.overrideApplied ? 1 : 0,
      inv.discountPaise,
      inv.discountSummary,
      inv.totalAmountPaise,
      inv.paidAmountPaise,
      inv.dueDate,
      inv.status,
      inv.notes ?? '',
      1,
      inv.createdAt,
      inv.updatedAt,
    );
  }

  const insertPay = db.prepare(`
    INSERT OR IGNORE INTO fee_payments (
      id, invoice_id, student_id, amount_paise, payment_date, method, transaction_ref,
      receipt_number, notes, is_advance, is_demo, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of data.payments) {
    insertPay.run(
      p.id,
      p.invoiceId ?? null,
      p.studentId,
      p.amountPaise,
      p.paymentDate,
      p.method,
      p.transactionRef,
      p.receiptNumber,
      p.notes,
      p.isAdvance ? 1 : 0,
      1,
      p.createdAt,
    );
  }

  const insertProg = db.prepare(`
    INSERT OR IGNORE INTO daily_progress (
      id, student_id, date, subjects_covered_json, topics_studied, homework_completed_count,
      homework_remaining_count, doubts_cleared, teacher_comment, improvement_areas,
      next_session_tasks, completion_pct, is_demo, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const pr of data.progressLogs) {
    insertProg.run(
      pr.id,
      pr.studentId,
      pr.date,
      JSON.stringify(pr.subjectsCovered),
      pr.topicsStudied,
      pr.homeworkCompletedCount,
      pr.homeworkRemainingCount,
      pr.doubtsCleared,
      pr.teacherComment,
      pr.improvementAreas,
      pr.nextSessionTasks,
      pr.completionPct,
      1,
      pr.updatedAt,
    );
  }

  logAudit('SEED_DEMO', 'workspace', 'demo', 'Loaded isolated sample student & tuition dataset');
}

export function clearDemoWorkspace(): void {
  db.prepare('DELETE FROM fee_payments WHERE is_demo = 1').run();
  db.prepare('DELETE FROM fee_invoices WHERE is_demo = 1').run();
  db.prepare('DELETE FROM daily_progress WHERE is_demo = 1').run();
  db.prepare('DELETE FROM exams WHERE is_demo = 1').run();
  db.prepare('DELETE FROM homework WHERE is_demo = 1').run();
  db.prepare('DELETE FROM attendance WHERE is_demo = 1').run();
  db.prepare('DELETE FROM students WHERE is_demo = 1').run();
  db.prepare("DELETE FROM discounts WHERE id LIKE 'demo-%'").run();
  logAudit('CLEAR_DEMO', 'workspace', 'demo', 'Removed all sample demo records cleanly');
}

// Row mappers
function mapStudent(r: Record<string, unknown>): Student {
  return {
    id: String(r.id),
    studentCode: String(r.student_code),
    fullName: String(r.full_name),
    avatarColor: String(r.avatar_color),
    classLevel: Number(r.class_level) as Student['classLevel'],
    board: String(r.board) as Student['board'],
    schoolName: String(r.school_name ?? ''),
    admissionDate: String(r.admission_date),
    dateOfBirth: r.date_of_birth ? String(r.date_of_birth) : undefined,
    studentPhone: r.student_phone ? String(r.student_phone) : undefined,
    parentName: String(r.parent_name),
    parentPhone: String(r.parent_phone),
    emergencyContact: r.emergency_contact ? String(r.emergency_contact) : undefined,
    address: r.address ? String(r.address) : undefined,
    subjects: JSON.parse(String(r.subjects_json || '[]')),
    strengths: JSON.parse(String(r.strengths_json || '[]')),
    weaknesses: JSON.parse(String(r.weaknesses_json || '[]')),
    academicPerformance: Number(r.academic_performance ?? 75),
    preferredArrivalTime: String(r.preferred_arrival_time || '18:00'),
    allocatedSlot: String(r.allocated_slot || '18:00–20:00'),
    expectedDurationMinutes: Number(r.expected_duration_minutes ?? 90),
    regularDays: JSON.parse(String(r.regular_days_json || '[1,2,3,4,5,6]')),
    feeDueDay: Number(r.fee_due_day ?? 5),
    feeOverride: r.fee_override_json ? JSON.parse(String(r.fee_override_json)) : null,
    creditBalancePaise: Number(r.credit_balance_paise ?? 0),
    notes: String(r.notes ?? ''),
    learningSpeed: String(r.learning_speed || 'steady') as Student['learningSpeed'],
    priority: String(r.priority || 'normal') as Student['priority'],
    academicGoals: String(r.academic_goals ?? ''),
    status: String(r.status || 'active') as Student['status'],
    discontinuedAt: r.discontinued_at ? String(r.discontinued_at) : null,
    isDemo: Number(r.is_demo) === 1,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function reconcileNotifications(
  settings: TuitionSettings,
  students: Student[],
  invoices: FeeInvoice[],
  exams: ExamItem[],
  todayIst: string,
): void {
  const insertNotif = db.prepare(`
    INSERT OR IGNORE INTO notifications (id, category, title, message, student_id, priority, read, dedup_key, scheduled_for, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);
  const nowIso = new Date().toISOString();

  // 1. Daily 5:30 PM prep summary
  const activeCount = students.filter((s) => s.status === 'active').length;
  if (activeCount > 0) {
    insertNotif.run(
      generateId('ntf'),
      'daily_preparation',
      '5:30 PM Tuition Preparation Ready',
      `${activeCount} active student${activeCount === 1 ? '' : 's'} configured for today’s ${settings.sessionStart}–${settings.sessionEnd} batch. Open Planner to review priority order.`,
      null,
      'normal',
      `prep:${todayIst}`,
      `${todayIst} ${settings.reminders.dailyPrepTime}`,
      nowIso,
    );
  }

  // 2. Fee reminders (deduped via dedup_key)
  const feeRems = evaluateFeeReminders({
    students,
    invoices,
    todayDate: todayIst,
    reminderSettings: settings.reminders,
    tuitionName: settings.tuitionName,
  });
  for (const r of feeRems) {
    insertNotif.run(
      generateId('ntf'),
      r.daysFromDue > 0 ? 'fee_overdue' : 'fee_due',
      `${r.studentName} — ${r.reason}`,
      `Parent: ${r.parentName} (${r.parentPhone}). Ready to copy or share polite reminder.`,
      r.studentId,
      r.urgency,
      r.dedupKey,
      todayIst,
      nowIso,
    );
  }

  // 3. Upcoming exams within 3 days
  const studentMap = new Map(students.map((s) => [s.id, s]));
  for (const ex of exams) {
    if (ex.obtainedMarks != null) continue;
    const stu = studentMap.get(ex.studentId);
    if (!stu || stu.status !== 'active') continue;
    if (ex.examDate >= todayIst) {
      const [y1, m1, d1] = todayIst.split('-').map(Number);
      const [y2, m2, d2] = ex.examDate.split('-').map(Number);
      const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
      if (days <= 3) {
        insertNotif.run(
          generateId('ntf'),
          'upcoming_exam',
          `${stu.fullName}: ${ex.subject} exam ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
          `${ex.examName} · Syllabus: ${ex.syllabus}. Prioritized automatically in today’s tuition timeline.`,
          stu.id,
          days <= 1 ? 'urgent' : 'high',
          `exam:${ex.id}:${days}d`,
          ex.examDate,
          nowIso,
        );
      }
    }
  }
}

export function getWorkspaceSnapshot(): WorkspaceSnapshot {
  const settings = getSettings();
  const todayIst = formatIstDate(new Date());
  const currentMonthIst = formatIstMonthKey(new Date());

  const studentRows = db.prepare('SELECT * FROM students ORDER BY full_name ASC').all() as Record<string, unknown>[];
  const students = studentRows.map(mapStudent);

  const discountRows = db.prepare('SELECT * FROM discounts ORDER BY created_at DESC').all() as Record<string, unknown>[];
  const discounts: DiscountRule[] = discountRows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: String(r.kind) as DiscountRule['kind'],
    value: Number(r.value),
    scope: String(r.scope) as DiscountRule['scope'],
    studentId: r.student_id ? String(r.student_id) : undefined,
    classLevel: r.class_level != null ? (Number(r.class_level) as DiscountRule['classLevel']) : undefined,
    board: r.board ? (String(r.board) as DiscountRule['board']) : undefined,
    startDate: r.start_date ? String(r.start_date) : undefined,
    endDate: r.end_date ? String(r.end_date) : undefined,
    active: Number(r.active) === 1,
    createdAt: String(r.created_at),
  }));

  const attRows = db.prepare('SELECT * FROM attendance ORDER BY date DESC').all() as Record<string, unknown>[];
  const attendance: AttendanceRecord[] = attRows.map((r) => ({
    id: String(r.id),
    studentId: String(r.student_id),
    date: String(r.date),
    status: String(r.status) as AttendanceRecord['status'],
    actualArrivalTime: r.actual_arrival_time ? String(r.actual_arrival_time) : null,
    departureTime: r.departure_time ? String(r.departure_time) : null,
    note: String(r.note ?? ''),
    isDemo: Number(r.is_demo) === 1,
    updatedAt: String(r.updated_at),
  }));

  const hwRows = db.prepare('SELECT * FROM homework ORDER BY due_date ASC, updated_at DESC').all() as Record<string, unknown>[];
  const homework: HomeworkItem[] = hwRows.map((r) => ({
    id: String(r.id),
    studentId: String(r.student_id),
    subject: String(r.subject),
    chapter: String(r.chapter ?? ''),
    topic: String(r.topic ?? ''),
    title: String(r.title),
    instructions: String(r.instructions ?? ''),
    assignedDate: String(r.assigned_date),
    dueDate: String(r.due_date),
    estimatedMinutes: Number(r.estimated_minutes ?? 20),
    priority: String(r.priority || 'normal') as HomeworkItem['priority'],
    source: String(r.source || 'tuition') as HomeworkItem['source'],
    completionPct: Number(r.completion_pct ?? 0),
    status: String(r.status || 'not_started') as HomeworkItem['status'],
    completedDate: r.completed_date ? String(r.completed_date) : null,
    teacherVerified: Number(r.teacher_verified) === 1,
    needsHelp: Number(r.needs_help) === 1,
    remarks: String(r.remarks ?? ''),
    carriedFromId: r.carried_from_id ? String(r.carried_from_id) : null,
    isDemo: Number(r.is_demo) === 1,
    updatedAt: String(r.updated_at),
  }));

  const tplRows = db.prepare('SELECT * FROM homework_templates ORDER BY title ASC').all() as Record<string, unknown>[];
  const templates: HomeworkTemplate[] = tplRows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    subject: String(r.subject),
    chapter: String(r.chapter ?? ''),
    topic: String(r.topic ?? ''),
    instructions: String(r.instructions ?? ''),
    estimatedMinutes: Number(r.estimated_minutes ?? 20),
    source: String(r.source || 'tuition') as HomeworkTemplate['source'],
    classLevel: r.class_level != null ? (Number(r.class_level) as HomeworkTemplate['classLevel']) : null,
  }));

  const examRows = db.prepare('SELECT * FROM exams ORDER BY exam_date ASC').all() as Record<string, unknown>[];
  const exams: ExamItem[] = examRows.map((r) => ({
    id: String(r.id),
    studentId: String(r.student_id),
    subject: String(r.subject),
    examName: String(r.exam_name),
    examType: String(r.exam_type || 'unit_test') as ExamItem['examType'],
    examDate: String(r.exam_date),
    syllabus: String(r.syllabus ?? ''),
    maxMarks: Number(r.max_marks ?? 50),
    obtainedMarks: r.obtained_marks != null ? Number(r.obtained_marks) : null,
    importantChapters: JSON.parse(String(r.important_chapters_json || '[]')),
    preparationStatus: Number(r.preparation_status ?? 0),
    revisionPlan: String(r.revision_plan ?? ''),
    weakAreas: JSON.parse(String(r.weak_areas_json || '[]')),
    isDemo: Number(r.is_demo) === 1,
    updatedAt: String(r.updated_at),
  }));

  const invRows = db.prepare('SELECT * FROM fee_invoices ORDER BY month_key DESC, due_date ASC').all() as Record<string, unknown>[];
  const invoices: FeeInvoice[] = invRows.map((r) => ({
    id: String(r.id),
    studentId: String(r.student_id),
    monthKey: String(r.month_key),
    classLevelSnapshot: Number(r.class_level_snapshot) as FeeInvoice['classLevelSnapshot'],
    boardSnapshot: String(r.board_snapshot) as FeeInvoice['boardSnapshot'],
    baseAmountPaise: Number(r.base_amount_paise),
    boardSurchargePaise: Number(r.board_surcharge_paise),
    overrideApplied: Number(r.override_applied) === 1,
    discountPaise: Number(r.discount_paise),
    discountSummary: String(r.discount_summary ?? ''),
    totalAmountPaise: Number(r.total_amount_paise),
    paidAmountPaise: Number(r.paid_amount_paise),
    dueDate: String(r.due_date),
    status: String(r.status) as FeeInvoice['status'],
    notes: String(r.notes ?? ''),
    isDemo: Number(r.is_demo) === 1,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  const payRows = db.prepare('SELECT * FROM fee_payments ORDER BY payment_date DESC, created_at DESC').all() as Record<string, unknown>[];
  const payments: FeePayment[] = payRows.map((r) => ({
    id: String(r.id),
    invoiceId: r.invoice_id ? String(r.invoice_id) : null,
    studentId: String(r.student_id),
    amountPaise: Number(r.amount_paise),
    paymentDate: String(r.payment_date),
    method: String(r.method) as FeePayment['method'],
    transactionRef: String(r.transaction_ref ?? ''),
    receiptNumber: String(r.receipt_number),
    notes: String(r.notes ?? ''),
    isAdvance: Number(r.is_advance) === 1,
    isDemo: Number(r.is_demo) === 1,
    createdAt: String(r.created_at),
  }));

  const progRows = db.prepare('SELECT * FROM daily_progress ORDER BY date DESC').all() as Record<string, unknown>[];
  const progressLogs: DailyProgressLog[] = progRows.map((r) => ({
    id: String(r.id),
    studentId: String(r.student_id),
    date: String(r.date),
    subjectsCovered: JSON.parse(String(r.subjects_covered_json || '[]')),
    topicsStudied: String(r.topics_studied ?? ''),
    homeworkCompletedCount: Number(r.homework_completed_count ?? 0),
    homeworkRemainingCount: Number(r.homework_remaining_count ?? 0),
    doubtsCleared: String(r.doubts_cleared ?? ''),
    teacherComment: String(r.teacher_comment ?? ''),
    improvementAreas: String(r.improvement_areas ?? ''),
    nextSessionTasks: String(r.next_session_tasks ?? ''),
    completionPct: Number(r.completion_pct ?? 0),
    isDemo: Number(r.is_demo) === 1,
    updatedAt: String(r.updated_at),
  }));

  reconcileNotifications(settings, students, invoices, exams, todayIst);

  const notifRows = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 80').all() as Record<string, unknown>[];
  const notifications: NotificationItem[] = notifRows.map((r) => ({
    id: String(r.id),
    category: String(r.category) as NotificationItem['category'],
    title: String(r.title),
    message: String(r.message),
    studentId: r.student_id ? String(r.student_id) : null,
    priority: String(r.priority || 'normal') as NotificationItem['priority'],
    read: Number(r.read) === 1,
    dedupKey: String(r.dedup_key),
    scheduledFor: r.scheduled_for ? String(r.scheduled_for) : undefined,
    createdAt: String(r.created_at),
  }));

  const auditRows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 60').all() as Record<string, unknown>[];
  const auditLogs: AuditLogEntry[] = auditRows.map((r) => ({
    id: String(r.id),
    action: String(r.action),
    entityType: String(r.entity_type),
    entityId: String(r.entity_id),
    summary: String(r.summary),
    createdAt: String(r.created_at),
  }));

  return {
    settings,
    students,
    discounts,
    attendance,
    homework,
    templates,
    exams,
    invoices,
    payments,
    progressLogs,
    notifications,
    auditLogs,
    todayIst,
    currentMonthIst,
    hasDemoData: students.some((s) => s.isDemo),
  };
}
