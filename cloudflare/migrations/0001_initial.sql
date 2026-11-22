-- Tuitio Smart Tuition Management — Cloudflare D1 / SQLite Schema
-- Monetary columns use INTEGER paise (1 INR = 100 paise) for exact financial math.
-- Timestamps stored in UTC ISO-8601; local schedule/attendance/due dates in YYYY-MM-DD (Asia/Kolkata).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  student_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  class_level INTEGER NOT NULL CHECK (class_level BETWEEN 3 AND 10),
  board TEXT NOT NULL CHECK (board IN ('SSC', 'CBSE', 'ICSE')),
  school_name TEXT NOT NULL DEFAULT '',
  admission_date TEXT NOT NULL,
  date_of_birth TEXT,
  student_phone TEXT,
  parent_name TEXT NOT NULL,
  parent_phone TEXT NOT NULL,
  emergency_contact TEXT,
  address TEXT,
  subjects_json TEXT NOT NULL DEFAULT '[]',
  strengths_json TEXT NOT NULL DEFAULT '[]',
  weaknesses_json TEXT NOT NULL DEFAULT '[]',
  academic_performance INTEGER NOT NULL DEFAULT 75,
  preferred_arrival_time TEXT NOT NULL DEFAULT '18:00',
  allocated_slot TEXT NOT NULL DEFAULT '18:00–20:00',
  expected_duration_minutes INTEGER NOT NULL DEFAULT 90,
  regular_days_json TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
  fee_due_day INTEGER NOT NULL DEFAULT 5 CHECK (fee_due_day BETWEEN 1 AND 28),
  fee_override_json TEXT,
  credit_balance_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  learning_speed TEXT NOT NULL DEFAULT 'steady',
  priority TEXT NOT NULL DEFAULT 'normal',
  academic_goals TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','inactive','discontinued','graduated')),
  discontinued_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_class_board ON students(class_level, board);

CREATE TABLE IF NOT EXISTS discounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed','percentage')),
  value INTEGER NOT NULL CHECK (value >= 0),
  scope TEXT NOT NULL CHECK (scope IN ('student','class','board','global')),
  student_id TEXT,
  class_level INTEGER,
  board TEXT,
  start_date TEXT,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unmarked','present','absent','late','excused')),
  actual_arrival_time TEXT,
  departure_time TEXT,
  note TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(student_id, date),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);

CREATE TABLE IF NOT EXISTS homework (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  assigned_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL DEFAULT 20,
  priority TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL DEFAULT 'tuition',
  completion_pct INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_started',
  completed_date TEXT,
  teacher_verified INTEGER NOT NULL DEFAULT 0,
  needs_help INTEGER NOT NULL DEFAULT 0,
  remarks TEXT NOT NULL DEFAULT '',
  carried_from_id TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_homework_student_due ON homework(student_id, due_date);

CREATE TABLE IF NOT EXISTS homework_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  estimated_minutes INTEGER NOT NULL DEFAULT 20,
  source TEXT NOT NULL DEFAULT 'tuition',
  class_level INTEGER
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  exam_name TEXT NOT NULL,
  exam_type TEXT NOT NULL DEFAULT 'unit_test',
  exam_date TEXT NOT NULL,
  syllabus TEXT NOT NULL DEFAULT '',
  max_marks INTEGER NOT NULL DEFAULT 50,
  obtained_marks INTEGER,
  important_chapters_json TEXT NOT NULL DEFAULT '[]',
  preparation_status INTEGER NOT NULL DEFAULT 0,
  revision_plan TEXT NOT NULL DEFAULT '',
  weak_areas_json TEXT NOT NULL DEFAULT '[]',
  is_demo INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exams_date ON exams(exam_date);

CREATE TABLE IF NOT EXISTS fee_invoices (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  month_key TEXT NOT NULL,
  class_level_snapshot INTEGER NOT NULL,
  board_snapshot TEXT NOT NULL,
  base_amount_paise INTEGER NOT NULL,
  board_surcharge_paise INTEGER NOT NULL,
  override_applied INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  discount_summary TEXT NOT NULL DEFAULT '',
  total_amount_paise INTEGER NOT NULL,
  paid_amount_paise INTEGER NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('paid','unpaid','partial','overdue','waived')),
  notes TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(student_id, month_key),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoices_month ON fee_invoices(month_key);

CREATE TABLE IF NOT EXISTS fee_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT,
  student_id TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  payment_date TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','upi','bank_transfer','other')),
  transaction_ref TEXT NOT NULL DEFAULT '',
  receipt_number TEXT NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  is_advance INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_id) REFERENCES fee_invoices(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS daily_progress (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  date TEXT NOT NULL,
  subjects_covered_json TEXT NOT NULL DEFAULT '[]',
  topics_studied TEXT NOT NULL DEFAULT '',
  homework_completed_count INTEGER NOT NULL DEFAULT 0,
  homework_remaining_count INTEGER NOT NULL DEFAULT 0,
  doubts_cleared TEXT NOT NULL DEFAULT '',
  teacher_comment TEXT NOT NULL DEFAULT '',
  improvement_areas TEXT NOT NULL DEFAULT '',
  next_session_tasks TEXT NOT NULL DEFAULT '',
  completion_pct INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(student_id, date),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  student_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  read INTEGER NOT NULL DEFAULT 0,
  dedup_key TEXT NOT NULL UNIQUE,
  scheduled_for TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
