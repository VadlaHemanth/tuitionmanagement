// Cloudflare Worker Entrypoint — Complete Edge Runtime with D1 + Static Assets + Cron Triggers
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
  BoardType,
  ClassLevel,
} from '../src/types';
import {
  allocatePaymentToInvoices,
  buildMonthlyInvoiceDraft,
  computeInvoiceStatus,
  evaluateFeeReminders,
} from '../src/engines/feeEngine';
import { buildCarryForwardHomeworkDrafts } from '../src/engines/schedulerEngine';
import { addDaysToDateStr, formatIstDate, formatIstMonthKey, formatRupeesFromPaise } from '../src/engines/istDate';
import { buildDemoDataset, createDefaultSettings, createDefaultTemplates } from '../server/demoSeed';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  TEACHER_ADMIN_PASSCODE?: string;
}

interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      run(): Promise<{ success: boolean; meta?: unknown }>;
    };
  };
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

// Helper: Hex / Bytes utilities
function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const keyBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return { hash: bytesToHex(new Uint8Array(keyBits)), salt: bytesToHex(salt) };
}

async function verifyPassword(password: string, storedHash: string, storedSalt: string): Promise<boolean> {
  const { hash } = await hashPassword(password, storedSalt);
  return hash === storedHash;
}

function generateId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${bytesToHex(bytes)}`;
}

// Cookie helpers
function parseCookies(cookieHeader?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function extractToken(request: Request): string {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(request.headers.get('cookie'));
  return cookies.tuitio_session || '';
}

function makeSessionCookie(token: string, maxAgeSeconds: number): string {
  return [
    `tuitio_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
    'SameSite=Lax',
    'Secure',
  ].join('; ');
}

// JSON response helper with CORS headers
function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function errorResponse(error: string, status = 400): Response {
  return jsonResponse({ error }, status);
}

// D1 Database operations
async function getTeacherCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as c FROM teachers').bind().first<{ c: number }>();
  return row?.c ?? 0;
}

async function getSessionTeacher(db: D1Database, rawToken: string): Promise<{ id: string; email: string; name: string } | null> {
  if (!rawToken) return null;
  const tokenHash = await sha256(rawToken);
  const row = await db
    .prepare(
      `SELECT t.id, t.email, t.name, s.expires_at
       FROM sessions s
       JOIN teachers t ON t.id = s.teacher_id
       WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{ id: string; email: string; name: string; expires_at: string }>();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

async function createSession(db: D1Database, teacherId: string): Promise<{ token: string; expiresAt: string }> {
  const rawToken = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  await db
    .prepare('INSERT INTO sessions (token_hash, teacher_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, teacherId, expiresAt, new Date().toISOString())
    .run();
  return { token: rawToken, expiresAt };
}

async function deleteSession(db: D1Database, rawToken: string): Promise<void> {
  if (!rawToken) return;
  const tokenHash = await sha256(rawToken);
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

async function logAudit(db: D1Database, action: string, entityType: string, entityId: string, summary: string): Promise<void> {
  await db
    .prepare('INSERT INTO audit_logs (id, action, entity_type, entity_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(generateId('aud'), action, entityType, entityId, summary, new Date().toISOString())
    .run();
}

async function getSettings(db: D1Database): Promise<TuitionSettings> {
  const row = await db.prepare('SELECT settings_json FROM app_settings WHERE id = ?').bind('default').first<{ settings_json: string }>();
  if (!row) return createDefaultSettings();
  try {
    const parsed = JSON.parse(row.settings_json) as Partial<TuitionSettings>;
    const defaults = createDefaultSettings();
    return {
      ...defaults,
      ...parsed,
      feeConfig: { ...defaults.feeConfig, ...(parsed.feeConfig || {}) },
      reminders: { ...defaults.reminders, ...(parsed.reminders || {}) },
    };
  } catch {
    return createDefaultSettings();
  }
}

async function saveSettings(db: D1Database, settings: TuitionSettings): Promise<TuitionSettings> {
  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO app_settings (id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at',
    )
    .bind('default', JSON.stringify(settings), now)
    .run();
  return settings;
}

async function ensureBootstrapDefaults(db: D1Database): Promise<void> {
  const row = await db.prepare('SELECT id FROM app_settings WHERE id = ?').bind('default').first<{ id: string }>();
  if (!row) {
    const def = createDefaultSettings();
    await db
      .prepare('INSERT INTO app_settings (id, settings_json, updated_at) VALUES (?, ?, ?)')
      .bind('default', JSON.stringify(def), new Date().toISOString())
      .run();
  }
  const tplCount = await db.prepare('SELECT COUNT(*) as c FROM homework_templates').bind().first<{ c: number }>();
  if (!tplCount || tplCount.c === 0) {
    for (const t of createDefaultTemplates()) {
      await db
        .prepare(
          'INSERT OR IGNORE INTO homework_templates (id, title, subject, chapter, topic, instructions, estimated_minutes, source, class_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(t.id, t.title, t.subject, t.chapter, t.topic, t.instructions, t.estimatedMinutes, t.source, t.classLevel ?? null)
        .run();
    }
  }
}

async function getWorkspaceSnapshot(db: D1Database): Promise<WorkspaceSnapshot> {
  const nowTick = new Date();
  const todayIst = formatIstDate(nowTick);
  const currentMonthIst = formatIstMonthKey(nowTick);
  const settings = await getSettings(db);

  const studentRows = (await db.prepare('SELECT * FROM students ORDER BY class_level ASC, full_name ASC').bind().all<Record<string, unknown>>()).results;
  const students: Student[] = studentRows.map((r) => ({
    id: String(r.id),
    studentCode: String(r.student_code),
    fullName: String(r.full_name),
    avatarColor: String(r.avatar_color),
    classLevel: Number(r.class_level) as ClassLevel,
    board: String(r.board) as BoardType,
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
  }));

  const discRows = (await db.prepare('SELECT * FROM discounts WHERE active = 1 ORDER BY created_at DESC').bind().all<Record<string, unknown>>()).results;
  const discounts: DiscountRule[] = discRows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: String(r.kind) as DiscountRule['kind'],
    value: Number(r.value),
    scope: String(r.scope) as DiscountRule['scope'],
    studentId: r.student_id ? String(r.student_id) : undefined,
    classLevel: r.class_level != null ? (Number(r.class_level) as ClassLevel) : undefined,
    board: r.board ? (String(r.board) as BoardType) : undefined,
    startDate: r.start_date ? String(r.start_date) : undefined,
    endDate: r.end_date ? String(r.end_date) : undefined,
    active: Number(r.active) === 1,
    createdAt: String(r.created_at),
  }));

  const attRows = (await db.prepare('SELECT * FROM attendance ORDER BY date DESC, updated_at DESC LIMIT 500').bind().all<Record<string, unknown>>()).results;
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

  const hwRows = (await db.prepare('SELECT * FROM homework ORDER BY due_date ASC, updated_at DESC').bind().all<Record<string, unknown>>()).results;
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

  const tplRows = (await db.prepare('SELECT * FROM homework_templates ORDER BY title ASC').bind().all<Record<string, unknown>>()).results;
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

  const examRows = (await db.prepare('SELECT * FROM exams ORDER BY exam_date ASC').bind().all<Record<string, unknown>>()).results;
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

  const invRows = (await db.prepare('SELECT * FROM fee_invoices ORDER BY month_key DESC, due_date ASC').bind().all<Record<string, unknown>>()).results;
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

  const payRows = (await db.prepare('SELECT * FROM fee_payments ORDER BY payment_date DESC, created_at DESC').bind().all<Record<string, unknown>>()).results;
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

  const progRows = (await db.prepare('SELECT * FROM daily_progress ORDER BY date DESC').bind().all<Record<string, unknown>>()).results;
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

  const notifRows = (await db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 80').bind().all<Record<string, unknown>>()).results;
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

  const auditRows = (await db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 60').bind().all<Record<string, unknown>>()).results;
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

async function seedDemoWorkspace(db: D1Database): Promise<void> {
  const existing = await db.prepare('SELECT COUNT(*) as c FROM students WHERE is_demo = 1').bind().first<{ c: number }>();
  if (existing && existing.c > 0) return;

  const data = buildDemoDataset(new Date());

  for (const s of data.students) {
    await db
      .prepare(`
        INSERT OR IGNORE INTO students (
          id, student_code, full_name, avatar_color, class_level, board, school_name,
          admission_date, date_of_birth, student_phone, parent_name, parent_phone,
          emergency_contact, address, subjects_json, strengths_json, weaknesses_json,
          academic_performance, preferred_arrival_time, allocated_slot, expected_duration_minutes,
          regular_days_json, fee_due_day, fee_override_json, credit_balance_paise, notes,
          learning_speed, priority, academic_goals, status, discontinued_at, is_demo, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
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
      )
      .run();
  }

  for (const d of data.discounts) {
    await db
      .prepare(`
        INSERT OR IGNORE INTO discounts (id, name, kind, value, scope, student_id, class_level, board, start_date, end_date, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(d.id, d.name, d.kind, d.value, d.scope, d.studentId ?? null, d.classLevel ?? null, d.board ?? null, d.startDate ?? null, d.endDate ?? null, 1, d.createdAt)
      .run();
  }

  for (const a of data.attendance) {
    await db
      .prepare(`
        INSERT OR IGNORE INTO attendance (id, student_id, date, status, actual_arrival_time, departure_time, note, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .bind(a.id, a.studentId, a.date, a.status, a.actualArrivalTime ?? null, a.departureTime ?? null, a.note, a.updatedAt, a.updatedAt)
      .run();
  }

  for (const h of data.homework) {
    await db
      .prepare(`
        INSERT OR IGNORE INTO homework (id, student_id, subject, chapter, topic, title, instructions, assigned_date, due_date, estimated_minutes, priority, source, completion_pct, status, completed_date, teacher_verified, needs_help, remarks, carried_from_id, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .bind(h.id, h.studentId, h.subject, h.chapter, h.topic, h.title, h.instructions, h.assignedDate, h.dueDate, h.estimatedMinutes, h.priority, h.source, h.completionPct, h.status, h.completedDate ?? null, h.teacherVerified ? 1 : 0, h.needsHelp ? 1 : 0, h.remarks, h.carriedFromId ?? null, h.updatedAt, h.updatedAt)
      .run();
  }

  for (const e of data.exams) {
    await db
      .prepare(`
        INSERT OR IGNORE INTO exams (id, student_id, subject, exam_name, exam_type, exam_date, syllabus, max_marks, obtained_marks, important_chapters_json, preparation_status, revision_plan, weak_areas_json, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .bind(e.id, e.studentId, e.subject, e.examName, e.examType, e.examDate, e.syllabus, e.maxMarks, e.obtainedMarks ?? null, JSON.stringify(e.importantChapters), e.preparationStatus, e.revisionPlan, JSON.stringify(e.weakAreas), e.updatedAt, e.updatedAt)
      .run();
  }

  for (const inv of data.invoices) {
    await db
      .prepare(`
        INSERT OR IGNORE INTO fee_invoices (id, student_id, month_key, class_level_snapshot, board_snapshot, base_amount_paise, board_surcharge_paise, override_applied, discount_paise, discount_summary, total_amount_paise, paid_amount_paise, due_date, status, notes, is_demo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .bind(inv.id, inv.studentId, inv.monthKey, inv.classLevelSnapshot, inv.boardSnapshot, inv.baseAmountPaise, inv.boardSurchargePaise, inv.overrideApplied ? 1 : 0, inv.discountPaise, inv.discountSummary, inv.totalAmountPaise, inv.paidAmountPaise, inv.dueDate, inv.status, inv.notes, inv.createdAt, inv.updatedAt)
      .run();
  }

  for (const p of data.payments) {
    await db
      .prepare(`
        INSERT OR IGNORE INTO fee_payments (id, invoice_id, student_id, amount_paise, payment_date, method, transaction_ref, receipt_number, notes, is_advance, is_demo, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `)
      .bind(p.id, p.invoiceId ?? null, p.studentId, p.amountPaise, p.paymentDate, p.method, p.transactionRef, p.receiptNumber, p.notes, p.isAdvance ? 1 : 0, p.createdAt)
      .run();
  }
}

async function clearDemoWorkspace(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM fee_payments WHERE is_demo = 1').run();
  await db.prepare('DELETE FROM fee_invoices WHERE is_demo = 1').run();
  await db.prepare('DELETE FROM exams WHERE is_demo = 1').run();
  await db.prepare('DELETE FROM homework WHERE is_demo = 1').run();
  await db.prepare('DELETE FROM attendance WHERE is_demo = 1').run();
  await db.prepare('DELETE FROM daily_progress WHERE is_demo = 1').run();
  await db.prepare('DELETE FROM students WHERE is_demo = 1').run();
  await db.prepare("DELETE FROM notifications WHERE dedup_key LIKE 'demo-%'").run();
}

// Router
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // Health check endpoint
    if (url.pathname === '/api/health') {
      try {
        const check = await env.DB.prepare('SELECT 1 as ok').bind().first<{ ok: number }>();
        return jsonResponse({ status: 'ok', runtime: 'cloudflare-workers-d1', db: check?.ok === 1 });
      } catch (err: unknown) {
        return errorResponse(`D1 connection failed: ${err instanceof Error ? err.message : String(err)}`, 500);
      }
    }

    // Ensure initial app settings and templates exist
    await ensureBootstrapDefaults(env.DB);

    // Only process /api/ routes in Worker logic; serve static assets for everything else
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // 1. Auth Status
    if (url.pathname === '/api/auth/status' && method === 'GET') {
      const token = extractToken(request);
      const teacher = await getSessionTeacher(env.DB, token);
      const count = await getTeacherCount(env.DB);
      return jsonResponse({
        initialized: count > 0,
        authenticated: Boolean(teacher),
        teacher,
        hasEnvPasscode: Boolean(env.TEACHER_ADMIN_PASSCODE?.trim()),
      });
    }

    // 2. Auth Setup
    if (url.pathname === '/api/auth/setup' && method === 'POST') {
      const count = await getTeacherCount(env.DB);
      if (count > 0) {
        return errorResponse('Workspace already claimed. Please sign in.', 400);
      }
      const body = (await request.json().catch(() => ({}))) as Record<string, string>;
      const { email, name, password, tuitionName, passcode } = body;
      if (!email || !name || !password) {
        return errorResponse('Email, name, and password are required.', 400);
      }
      if (env.TEACHER_ADMIN_PASSCODE?.trim() && passcode !== env.TEACHER_ADMIN_PASSCODE.trim()) {
        return errorResponse('Invalid administrative claim passcode.', 403);
      }

      const teacherId = generateId('tch');
      const now = new Date().toISOString();
      const { hash, salt } = await hashPassword(password);
      await env.DB
        .prepare('INSERT INTO teachers (id, email, name, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(teacherId, email.trim().toLowerCase(), name.trim(), hash, salt, now, now)
        .run();

      if (tuitionName?.trim()) {
        const settings = await getSettings(env.DB);
        settings.tuitionName = tuitionName.trim();
        settings.teacherName = name.trim();
        settings.contactEmail = email.trim();
        await saveSettings(env.DB, settings);
      }

      const session = await createSession(env.DB, teacherId);
      const cookie = makeSessionCookie(session.token, 60 * 60 * 24 * 14);
      return jsonResponse(
        { token: session.token, teacher: { id: teacherId, email: email.trim().toLowerCase(), name: name.trim() } },
        201,
        { 'Set-Cookie': cookie },
      );
    }

    // 3. Auth Demo Bootstrap
    if (url.pathname === '/api/auth/demo-bootstrap' && method === 'POST') {
      let teacherRow = await env.DB.prepare('SELECT id, email, name FROM teachers LIMIT 1').bind().first<{ id: string; email: string; name: string }>();
      if (!teacherRow) {
        const now = new Date().toISOString();
        const { hash, salt } = await hashPassword('demo123456');
        await env.DB
          .prepare('INSERT INTO teachers (id, email, name, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind('demo-teacher', 'meera@tuitio.app', 'Meera Deshmukh', hash, salt, now, now)
          .run();
        teacherRow = { id: 'demo-teacher', email: 'meera@tuitio.app', name: 'Meera Deshmukh' };
      }
      await seedDemoWorkspace(env.DB);
      const session = await createSession(env.DB, teacherRow.id);
      const cookie = makeSessionCookie(session.token, 60 * 60 * 24 * 14);
      return jsonResponse({ token: session.token, teacher: teacherRow }, 201, { 'Set-Cookie': cookie });
    }

    // 4. Auth Login
    if (url.pathname === '/api/auth/login' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, string>;
      const { email, password, passcode } = body;
      if (!email || !password) return errorResponse('Email and password required.', 400);

      const teacher = await env.DB
        .prepare('SELECT id, email, name, password_hash, password_salt FROM teachers WHERE LOWER(email) = LOWER(?)')
        .bind(email.trim())
        .first<{ id: string; email: string; name: string; password_hash: string; password_salt: string }>();

      let valid = false;
      if (env.TEACHER_ADMIN_PASSCODE?.trim() && passcode === env.TEACHER_ADMIN_PASSCODE.trim()) {
        valid = true;
      } else if (teacher) {
        valid = await verifyPassword(password, teacher.password_hash, teacher.password_salt);
      }

      if (!valid || !teacher) {
        return errorResponse('Invalid email or password.', 401);
      }

      const session = await createSession(env.DB, teacher.id);
      const cookie = makeSessionCookie(session.token, 60 * 60 * 24 * 14);
      return jsonResponse(
        { token: session.token, teacher: { id: teacher.id, email: teacher.email, name: teacher.name } },
        200,
        { 'Set-Cookie': cookie },
      );
    }

    // 5. Auth Logout
    if (url.pathname === '/api/auth/logout' && method === 'POST') {
      const token = extractToken(request);
      await deleteSession(env.DB, token);
      const cookie = makeSessionCookie('', 0);
      return jsonResponse({ ok: true }, 200, { 'Set-Cookie': cookie });
    }

    // Authenticate Protected Routes
    const token = extractToken(request);
    const authedTeacher = await getSessionTeacher(env.DB, token);
    if (!authedTeacher) {
      return errorResponse('Authentication required.', 401);
    }

    // 6. Workspace Snapshot
    if (url.pathname === '/api/workspace' && method === 'GET') {
      const snap = await getWorkspaceSnapshot(env.DB);
      return jsonResponse(snap);
    }

    // 7. Demo Data controls
    if (url.pathname === '/api/demo/seed' && method === 'POST') {
      await seedDemoWorkspace(env.DB);
      return jsonResponse(await getWorkspaceSnapshot(env.DB));
    }
    if (url.pathname === '/api/demo/clear' && method === 'POST') {
      await clearDemoWorkspace(env.DB);
      return jsonResponse(await getWorkspaceSnapshot(env.DB));
    }

    // 8. Students
    if (url.pathname === '/api/students' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const id = generateId('stu');
      const now = new Date().toISOString();
      const codeCount = await env.DB.prepare('SELECT COUNT(*) as c FROM students').bind().first<{ c: number }>();
      const studentCode = `STU-${String((codeCount?.c ?? 0) + 101).padStart(3, '0')}`;

      await env.DB
        .prepare(`
          INSERT INTO students (
            id, student_code, full_name, avatar_color, class_level, board, school_name,
            admission_date, date_of_birth, student_phone, parent_name, parent_phone,
            emergency_contact, address, subjects_json, strengths_json, weaknesses_json,
            academic_performance, preferred_arrival_time, allocated_slot, expected_duration_minutes,
            regular_days_json, fee_due_day, fee_override_json, credit_balance_paise, notes,
            learning_speed, priority, academic_goals, status, is_demo, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'active', 0, ?, ?)
        `)
        .bind(
          id,
          studentCode,
          String(body.fullName || '').trim(),
          String(body.avatarColor || '#0284C7'),
          Number(body.classLevel || 5),
          String(body.board || 'SSC'),
          String(body.schoolName || ''),
          String(body.admissionDate || formatIstDate(new Date())),
          body.dateOfBirth ? String(body.dateOfBirth) : null,
          body.studentPhone ? String(body.studentPhone) : null,
          String(body.parentName || ''),
          String(body.parentPhone || ''),
          body.emergencyContact ? String(body.emergencyContact) : null,
          body.address ? String(body.address) : null,
          JSON.stringify(body.subjects || ['Mathematics', 'Science', 'English']),
          JSON.stringify(body.strengths || []),
          JSON.stringify(body.weaknesses || []),
          Number(body.academicPerformance || 75),
          String(body.preferredArrivalTime || '18:00'),
          String(body.allocatedSlot || '18:00–19:30'),
          Number(body.expectedDurationMinutes || 90),
          JSON.stringify(body.regularDays || [1, 2, 3, 4, 5, 6]),
          Number(body.feeDueDay || 5),
          body.feeOverride ? JSON.stringify(body.feeOverride) : null,
          String(body.notes || ''),
          String(body.learningSpeed || 'steady'),
          String(body.priority || 'normal'),
          String(body.academicGoals || ''),
          now,
          now,
        )
        .run();

      await logAudit(env.DB, 'CREATE_STUDENT', 'student', id, `Enrolled student ${body.fullName} (Class ${body.classLevel} ${body.board})`);
      return jsonResponse(await getWorkspaceSnapshot(env.DB), 201);
    }

    // 9. Attendance
    if (url.pathname === '/api/attendance' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const { studentId, date, status, actualArrivalTime, departureTime, note } = body;
      const now = new Date().toISOString();
      const existing = await env.DB.prepare('SELECT id FROM attendance WHERE student_id = ? AND date = ?').bind(studentId, date).first<{ id: string }>();

      if (existing) {
        await env.DB
          .prepare('UPDATE attendance SET status = ?, actual_arrival_time = ?, departure_time = ?, note = ?, updated_at = ? WHERE id = ?')
          .bind(status, actualArrivalTime ?? null, departureTime ?? null, note ?? '', now, existing.id)
          .run();
      } else {
        await env.DB
          .prepare('INSERT INTO attendance (id, student_id, date, status, actual_arrival_time, departure_time, note, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
          .bind(generateId('att'), studentId, date, status, actualArrivalTime ?? null, departureTime ?? null, note ?? '', now, now)
          .run();
      }
      return jsonResponse(await getWorkspaceSnapshot(env.DB));
    }

    // 10. Homework
    if (url.pathname === '/api/homework' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const now = new Date().toISOString();
      const studentIds = Array.isArray(body.studentIds) ? body.studentIds : [body.studentId];

      for (const sId of studentIds) {
        await env.DB
          .prepare(`
            INSERT INTO homework (
              id, student_id, subject, chapter, topic, title, instructions, assigned_date, due_date,
              estimated_minutes, priority, source, completion_pct, status, completed_date, teacher_verified,
              needs_help, remarks, carried_from_id, is_demo, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'not_started', NULL, 0, 0, '', NULL, 0, ?, ?)
          `)
          .bind(
            generateId('hw'),
            sId,
            String(body.subject || 'General'),
            String(body.chapter || ''),
            String(body.topic || ''),
            String(body.title || 'Homework'),
            String(body.instructions || ''),
            String(body.assignedDate || formatIstDate(new Date())),
            String(body.dueDate || formatIstDate(new Date())),
            Number(body.estimatedMinutes || 20),
            String(body.priority || 'normal'),
            String(body.source || 'tuition'),
            now,
            now,
          )
          .run();
      }
      return jsonResponse(await getWorkspaceSnapshot(env.DB), 201);
    }

    // 11. Fees - Record Payment
    if (url.pathname === '/api/fees/payments' && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const studentId = String(body.studentId || '');
      const amountPaise = Number(body.amountPaise || 0);
      const snap = await getWorkspaceSnapshot(env.DB);
      const student = snap.students.find((s) => s.id === studentId);
      if (!student) return errorResponse('Student not found.', 404);

      const studentInvoices = snap.invoices.filter((i) => i.studentId === studentId);
      const alloc = allocatePaymentToInvoices({
        invoices: studentInvoices,
        paymentAmountPaise: amountPaise,
        todayDate: snap.todayIst,
        targetInvoiceId: body.invoiceId ? String(body.invoiceId) : undefined,
      });

      const now = new Date().toISOString();
      const payDate = body.paymentDate ? String(body.paymentDate) : snap.todayIst;
      const payCount = await env.DB.prepare('SELECT COUNT(*) as c FROM fee_payments').bind().first<{ c: number }>();
      const receiptNumber = `RCPT-${payDate.slice(0, 4)}-${String((payCount?.c ?? 0) + 101).padStart(4, '0')}`;
      const paymentId = generateId('pay');

      for (const a of alloc.allocations) {
        await env.DB
          .prepare('UPDATE fee_invoices SET paid_amount_paise = ?, status = ?, updated_at = ? WHERE id = ?')
          .bind(a.newPaidPaise, a.newStatus, now, a.invoiceId)
          .run();
      }

      if (alloc.remainingAdvanceCreditPaise > 0) {
        await env.DB
          .prepare('UPDATE students SET credit_balance_paise = credit_balance_paise + ?, updated_at = ? WHERE id = ?')
          .bind(alloc.remainingAdvanceCreditPaise, now, studentId)
          .run();
      }

      await env.DB
        .prepare(`
          INSERT INTO fee_payments (
            id, invoice_id, student_id, amount_paise, payment_date, method, transaction_ref,
            receipt_number, notes, is_advance, is_demo, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `)
        .bind(
          paymentId,
          alloc.allocations[0]?.invoiceId ?? (body.invoiceId ? String(body.invoiceId) : null),
          studentId,
          amountPaise,
          payDate,
          String(body.method || 'cash'),
          String(body.transactionRef || ''),
          receiptNumber,
          String(body.notes || ''),
          alloc.remainingAdvanceCreditPaise > 0 ? 1 : 0,
          now,
        )
        .run();

      await logAudit(env.DB, 'RECORD_PAYMENT', 'payment', paymentId, `Recorded payment of ${formatRupeesFromPaise(amountPaise)} for ${student.fullName} (${receiptNumber})`);
      return jsonResponse(await getWorkspaceSnapshot(env.DB));
    }

    // 12. Settings
    if (url.pathname === '/api/settings' && method === 'PUT') {
      const body = (await request.json().catch(() => ({}))) as TuitionSettings;
      const saved = await saveSettings(env.DB, body);
      await logAudit(env.DB, 'UPDATE_SETTINGS', 'settings', 'default', 'Updated tuition settings');
      return jsonResponse(saved);
    }

    // Fallback: If no custom API route matched, forward to static assets
    return env.ASSETS.fetch(request);
  },

  // Free-tier Cron Trigger Handler:
  // 12:00 UTC (5:30 PM IST): Daily prep & fee reminder notification
  // 14:30 UTC (8:00 PM IST): End-of-session summary
  async scheduled(_controller: { cron: string; scheduledTime: number }, env: Env): Promise<void> {
    const istDate = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const dedupKey = `cron-prep:${istDate}`;
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO notifications (id, category, title, message, student_id, priority, read, dedup_key, scheduled_for, created_at)
         VALUES (?, 'daily_preparation', 'Evening Tuition Prep Ready', 'Open Tuitio to review today’s 6:00 PM–8:00 PM plan, expected students, and fee reminders.', NULL, 'normal', 0, ?, ?, ?)`,
      )
      .bind(`ntf-${istDate}`, dedupKey, `${istDate} 17:30`, now)
      .run();
  },
};
