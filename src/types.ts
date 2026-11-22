export type BoardType = 'SSC' | 'CBSE' | 'ICSE';

export type ClassLevel = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type StudentStatus = 'active' | 'paused' | 'inactive' | 'discontinued' | 'graduated';

export type LearningSpeed = 'fast' | 'steady' | 'needs_support';

export type StudentPriority = 'high' | 'normal' | 'low';

export type AttendanceStatus = 'unmarked' | 'present' | 'absent' | 'late' | 'excused';

export type HomeworkStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'verified'
  | 'partial'
  | 'overdue'
  | 'carried_forward';

export type HomeworkSource = 'school' | 'tuition';

export type PriorityLevel = 'urgent' | 'high' | 'normal' | 'low';

export type InvoiceStatus = 'paid' | 'unpaid' | 'partial' | 'overdue' | 'waived';

export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'other';

export type ExamType = 'school_exam' | 'unit_test' | 'weekly_test' | 'revision_test' | 'tuition_test';

export type DiscountKind = 'fixed' | 'percentage';

export type DiscountScope = 'student' | 'class' | 'board' | 'global';

export type NotificationCategory =
  | 'tuition_arrival'
  | 'student_absence'
  | 'homework_deadline'
  | 'homework_incomplete'
  | 'upcoming_exam'
  | 'revision_session'
  | 'fee_due'
  | 'fee_overdue'
  | 'student_promotion'
  | 'learning_goal'
  | 'daily_preparation'
  | 'end_of_day_report';

export interface FeeRateConfig {
  classRatesPaise: Record<ClassLevel, number>;
  boardSurchargesPaise: Record<BoardType, number>;
  prorateFirstMonth: boolean;
  defaultDueDay: number;
}

export interface StudentFeeOverride {
  amountPaise: number;
  isTemporary: boolean;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  reason?: string;
}

export interface DiscountRule {
  id: string;
  name: string;
  kind: DiscountKind;
  value: number; // paise if fixed, 0-100 if percentage
  scope: DiscountScope;
  studentId?: string;
  classLevel?: ClassLevel;
  board?: BoardType;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD (undefined = permanent)
  active: boolean;
  createdAt: string;
}

export interface Student {
  id: string;
  studentCode: string;
  fullName: string;
  avatarColor: string;
  classLevel: ClassLevel;
  board: BoardType;
  schoolName: string;
  admissionDate: string; // YYYY-MM-DD
  dateOfBirth?: string;
  studentPhone?: string;
  parentName: string;
  parentPhone: string;
  emergencyContact?: string;
  address?: string;
  subjects: string[];
  strengths: string[];
  weaknesses: string[];
  academicPerformance: number; // 0-100
  preferredArrivalTime: string; // HH:mm e.g. "18:00"
  allocatedSlot: string; // e.g. "18:00–19:30"
  expectedDurationMinutes: number;
  regularDays: number[]; // 0=Sun..6=Sat
  feeDueDay: number; // 1-28
  feeOverride?: StudentFeeOverride | null;
  creditBalancePaise: number;
  notes: string;
  learningSpeed: LearningSpeed;
  priority: StudentPriority;
  academicGoals: string;
  status: StudentStatus;
  discontinuedAt?: string | null;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD (IST)
  status: AttendanceStatus;
  actualArrivalTime?: string | null; // HH:mm
  departureTime?: string | null;
  note?: string;
  isDemo?: boolean;
  updatedAt: string;
}

export interface HomeworkItem {
  id: string;
  studentId: string;
  subject: string;
  chapter: string;
  topic: string;
  title: string;
  instructions: string;
  assignedDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  estimatedMinutes: number;
  priority: PriorityLevel;
  source: HomeworkSource;
  completionPct: number; // 0-100
  status: HomeworkStatus;
  completedDate?: string | null;
  teacherVerified: boolean;
  needsHelp: boolean;
  remarks: string;
  carriedFromId?: string | null;
  isDemo?: boolean;
  updatedAt: string;
}

export interface HomeworkTemplate {
  id: string;
  title: string;
  subject: string;
  chapter: string;
  topic: string;
  instructions: string;
  estimatedMinutes: number;
  source: HomeworkSource;
  classLevel?: ClassLevel | null;
}

export interface ExamItem {
  id: string;
  studentId: string;
  subject: string;
  examName: string;
  examType: ExamType;
  examDate: string; // YYYY-MM-DD
  syllabus: string;
  maxMarks: number;
  obtainedMarks?: number | null;
  importantChapters: string[];
  preparationStatus: number; // 0-100
  revisionPlan: string;
  weakAreas: string[];
  isDemo?: boolean;
  updatedAt: string;
}

export interface FeeInvoice {
  id: string;
  studentId: string;
  monthKey: string; // YYYY-MM
  classLevelSnapshot: ClassLevel;
  boardSnapshot: BoardType;
  baseAmountPaise: number;
  boardSurchargePaise: number;
  overrideApplied: boolean;
  discountPaise: number;
  discountSummary: string;
  totalAmountPaise: number;
  paidAmountPaise: number;
  dueDate: string; // YYYY-MM-DD
  status: InvoiceStatus;
  notes?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FeePayment {
  id: string;
  invoiceId?: string | null;
  studentId: string;
  amountPaise: number;
  paymentDate: string; // YYYY-MM-DD
  method: PaymentMethod;
  transactionRef: string;
  receiptNumber: string;
  notes: string;
  isAdvance: boolean;
  isDemo?: boolean;
  createdAt: string;
}

export interface DailyProgressLog {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  subjectsCovered: string[];
  topicsStudied: string;
  homeworkCompletedCount: number;
  homeworkRemainingCount: number;
  doubtsCleared: string;
  teacherComment: string;
  improvementAreas: string;
  nextSessionTasks: string;
  completionPct: number;
  isDemo?: boolean;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  studentId?: string | null;
  priority: PriorityLevel;
  read: boolean;
  dedupKey: string;
  scheduledFor?: string;
  createdAt: string;
}

export interface ReminderSettings {
  feeDaysBefore: number;
  feeOnDueDate: boolean;
  feeDaysAfter: number;
  feeOverdueRepeatDays: number;
  dailyPrepTime: string; // "17:30"
  arrivalAlertTime: string; // "17:50"
  sessionStartTime: string; // "18:00"
  wrapUpTime: string; // "19:45"
  sessionEndTime: string; // "20:00"
  dailyReportTime: string; // "21:00"
  quietHoursStart: string; // "22:00"
  quietHoursEnd: string; // "07:00"
  browserNotificationsEnabled: boolean;
  feeMessageTemplate: string;
}

export interface TuitionSettings {
  tuitionName: string;
  teacherName: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  sessionStart: string; // "18:00"
  sessionEnd: string; // "20:00"
  workingDays: number[]; // [1,2,3,4,5,6] Mon-Sat
  holidays: string[]; // YYYY-MM-DD[]
  academicYear: string; // "2026-27"
  supportedBoards: BoardType[];
  subjects: string[];
  timezone: string; // "Asia/Kolkata"
  feeConfig: FeeRateConfig;
  reminders: ReminderSettings;
  theme: 'light' | 'dark' | 'system';
  setupCompleted: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export interface ScheduleBlock {
  id: string;
  startMinute: number; // minutes from midnight, e.g. 1080 = 18:00
  endMinute: number;
  title: string;
  mode: 'checkin' | 'group_teaching' | 'individual_rotation' | 'exam_prep' | 'doubt_check' | 'wrap_up';
  teacherActivity: string;
  studentActivity: string;
  teacherExclusiveMinutes: number;
  focusStudentIds: string[];
  parallelStudentIds: string[];
  reason: string;
}

export interface StudentAttentionPlan {
  studentId: string;
  studentName: string;
  classLevel: ClassLevel;
  board: BoardType;
  attendanceStatus: AttendanceStatus;
  arrivalTime: string;
  urgencyScore: number;
  reasons: string[];
  recommendedTeacherMinutes: number;
  independentMinutes: number;
  topTasks: string[];
  upcomingExam?: {
    subject: string;
    examName: string;
    daysUntil: number;
  } | null;
}

export interface DailyPlanResult {
  date: string;
  sessionStart: string;
  sessionEnd: string;
  totalSessionMinutes: number;
  plannedTeacherExclusiveMinutes: number;
  bufferMinutes: number;
  isOverloaded: boolean;
  overloadMinutes: number;
  overloadWarning: string | null;
  blocks: ScheduleBlock[];
  studentPlans: StudentAttentionPlan[];
  groupSuggestions: {
    subject: string;
    topic: string;
    studentIds: string[];
    studentNames: string[];
    reason: string;
  }[];
  nextBestActions: {
    id: string;
    title: string;
    detail: string;
    studentId?: string;
    category: 'exam' | 'homework' | 'doubt' | 'fee' | 'attendance' | 'group';
    priority: PriorityLevel;
    reason: string;
  }[];
}

export interface WorkspaceSnapshot {
  settings: TuitionSettings;
  students: Student[];
  discounts: DiscountRule[];
  attendance: AttendanceRecord[];
  homework: HomeworkItem[];
  templates: HomeworkTemplate[];
  exams: ExamItem[];
  invoices: FeeInvoice[];
  payments: FeePayment[];
  progressLogs: DailyProgressLog[];
  notifications: NotificationItem[];
  auditLogs: AuditLogEntry[];
  todayIst: string;
  currentMonthIst: string;
  hasDemoData: boolean;
}
