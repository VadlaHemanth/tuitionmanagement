import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCarryForwardHomeworkDrafts,
  generateDailyTuitionPlan,
} from './schedulerEngine';
import { DEFAULT_FEE_CONFIG } from './feeEngine';
import type {
  AttendanceRecord,
  ExamItem,
  HomeworkItem,
  Student,
  TuitionSettings,
} from '../types';

const TEST_SETTINGS: TuitionSettings = {
  tuitionName: 'Tuitio Academy',
  teacherName: 'Priya Sharma',
  contactPhone: '9876500000',
  contactEmail: 'priya@example.com',
  address: 'Pune',
  sessionStart: '18:00',
  sessionEnd: '20:00',
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: [],
  academicYear: '2026-27',
  supportedBoards: ['SSC', 'CBSE', 'ICSE'],
  subjects: ['Mathematics', 'Science', 'English'],
  timezone: 'Asia/Kolkata',
  feeConfig: DEFAULT_FEE_CONFIG,
  reminders: {
    feeDaysBefore: 3,
    feeOnDueDate: true,
    feeDaysAfter: 3,
    feeOverdueRepeatDays: 7,
    dailyPrepTime: '17:30',
    arrivalAlertTime: '17:50',
    sessionStartTime: '18:00',
    wrapUpTime: '19:45',
    sessionEndTime: '20:00',
    dailyReportTime: '21:00',
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    browserNotificationsEnabled: false,
    feeMessageTemplate: 'Fee reminder {{studentName}} {{amount}}',
  },
  theme: 'light',
  setupCompleted: true,
};

function makeStudent(id: string, name: string, extras: Partial<Student> = {}): Student {
  return {
    id,
    studentCode: id.toUpperCase(),
    fullName: name,
    avatarColor: '#0284C7',
    classLevel: 7,
    board: 'CBSE',
    schoolName: 'NPS',
    admissionDate: '2026-06-01',
    parentName: 'Parent ' + name,
    parentPhone: '9876543210',
    subjects: ['Mathematics', 'Science'],
    strengths: [],
    weaknesses: [],
    academicPerformance: 75,
    preferredArrivalTime: '18:00',
    allocatedSlot: '18:00–20:00',
    expectedDurationMinutes: 90,
    regularDays: [0, 1, 2, 3, 4, 5, 6],
    feeDueDay: 5,
    creditBalancePaise: 0,
    notes: '',
    learningSpeed: 'steady',
    priority: 'normal',
    academicGoals: '',
    status: 'active',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...extras,
  };
}

test('parallel scheduling manages 5 simultaneous students within 120 min without false 150-min overbooking', () => {
  const students = [
    makeStudent('s1', 'Aarav'),
    makeStudent('s2', 'Ananya'),
    makeStudent('s3', 'Rohan'),
    makeStudent('s4', 'Diya'),
    makeStudent('s5', 'Kabir'),
  ];

  const plan = generateDailyTuitionPlan({
    date: '2026-11-21',
    settings: TEST_SETTINGS,
    students,
    attendance: [],
    homework: [],
    exams: [],
    invoices: [],
  });

  assert.equal(plan.totalSessionMinutes, 120);
  assert.equal(plan.isOverloaded, false);
  assert.equal(plan.studentPlans.length, 5);
  // Each student gets parallel independent work + targeted teacher time
  for (const sp of plan.studentPlans) {
    assert.ok(sp.independentMinutes >= 45);
    assert.ok(sp.recommendedTeacherMinutes <= 20);
  }
});

test('overload detection warns explicitly when teacher-exclusive blocks exceed 120-min window', () => {
  const students = [makeStudent('s1', 'Aarav')];
  const plan = generateDailyTuitionPlan({
    date: '2026-11-21',
    settings: TEST_SETTINGS,
    students,
    attendance: [],
    homework: [],
    exams: [],
    invoices: [],
    customBlockOverrides: {
      checkin: 15,
      group_teaching: 35,
      individual_rotation: 45,
      exam_prep: 30,
      doubt_check: 20,
      wrap_up: 15,
    },
  });

  assert.equal(plan.isOverloaded, true);
  assert.equal(plan.overloadMinutes, 40);
  assert.ok(plan.overloadWarning && plan.overloadWarning.includes('exceeds'));
});

test('exam tomorrow escalates student to #1 priority, absent student is excluded, and shared topic triggers group suggestion', () => {
  const s1 = makeStudent('s1', 'Priya', { weaknesses: ['Fractions'] });
  const s2 = makeStudent('s2', 'Arun', { weaknesses: ['Fractions'] });
  const s3 = makeStudent('s3', 'Absent Student');

  const attendance: AttendanceRecord[] = [
    { id: 'a3', studentId: 's3', date: '2026-11-21', status: 'absent', updatedAt: '2026-11-21T12:30:00Z' },
  ];

  const exams: ExamItem[] = [
    {
      id: 'ex1',
      studentId: 's1',
      subject: 'Science',
      examName: 'Unit Test 2',
      examType: 'unit_test',
      examDate: '2026-11-22', // tomorrow!
      syllabus: 'Light & Reflection',
      maxMarks: 40,
      obtainedMarks: null,
      importantChapters: ['Light'],
      preparationStatus: 65,
      revisionPlan: 'Revise ray diagrams',
      weakAreas: ['Mirror formula'],
      updatedAt: '2026-11-20T00:00:00Z',
    },
  ];

  const homework: HomeworkItem[] = [
    {
      id: 'hw1',
      studentId: 's1',
      subject: 'Mathematics',
      chapter: 'Ch 2',
      topic: 'Fractions',
      title: 'Ex 2.3 Q1-5',
      instructions: '',
      assignedDate: '2026-11-20',
      dueDate: '2026-11-21',
      estimatedMinutes: 20,
      priority: 'high',
      source: 'tuition',
      completionPct: 0,
      status: 'not_started',
      teacherVerified: false,
      needsHelp: true,
      remarks: '',
      updatedAt: '2026-11-20T00:00:00Z',
    },
    {
      id: 'hw2',
      studentId: 's2',
      subject: 'Mathematics',
      chapter: 'Ch 2',
      topic: 'Fractions',
      title: 'Ex 2.3 Q1-5',
      instructions: '',
      assignedDate: '2026-11-20',
      dueDate: '2026-11-21',
      estimatedMinutes: 20,
      priority: 'high',
      source: 'tuition',
      completionPct: 0,
      status: 'not_started',
      teacherVerified: false,
      needsHelp: true,
      remarks: '',
      updatedAt: '2026-11-20T00:00:00Z',
    },
  ];

  const plan = generateDailyTuitionPlan({
    date: '2026-11-21',
    settings: TEST_SETTINGS,
    students: [s1, s2, s3],
    attendance,
    homework,
    exams,
    invoices: [],
  });

  // Absent student excluded from active plan
  assert.equal(plan.studentPlans.some((p) => p.studentId === 's3'), false);
  // Priya (exam tomorrow) ranked #1
  assert.equal(plan.studentPlans[0].studentId, 's1');
  assert.ok(plan.studentPlans[0].reasons.some((r) => r.includes('exam tomorrow')));
  // Group teaching suggested for shared Fractions topic
  assert.equal(plan.groupSuggestions.length, 1);
  assert.equal(plan.groupSuggestions[0].studentIds.length, 2);
});

test('homework carry-forward copies incomplete work once without duplicates', () => {
  const hw: HomeworkItem[] = [
    {
      id: 'hw-1',
      studentId: 's1',
      subject: 'Mathematics',
      chapter: 'Ch 5',
      topic: 'Linear Equations',
      title: 'Ex 5.2 Q1-10',
      instructions: 'Show steps',
      assignedDate: '2026-11-20',
      dueDate: '2026-11-21',
      estimatedMinutes: 30,
      priority: 'normal',
      source: 'school',
      completionPct: 50,
      status: 'partial',
      teacherVerified: false,
      needsHelp: false,
      remarks: 'Did Q1-5',
      updatedAt: '2026-11-21T00:00:00Z',
    },
    {
      id: 'hw-done',
      studentId: 's1',
      subject: 'English',
      chapter: 'Ch 1',
      topic: 'Grammar',
      title: 'Worksheet',
      instructions: '',
      assignedDate: '2026-11-20',
      dueDate: '2026-11-21',
      estimatedMinutes: 15,
      priority: 'normal',
      source: 'school',
      completionPct: 100,
      status: 'completed',
      teacherVerified: true,
      needsHelp: false,
      remarks: '',
      updatedAt: '2026-11-21T00:00:00Z',
    },
  ];

  const drafts = buildCarryForwardHomeworkDrafts({
    homework: hw,
    fromDate: '2026-11-21',
    toDate: '2026-11-22',
  });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].carriedFromId, 'hw-1');
  assert.equal(drafts[0].estimatedMinutes, 15); // 50% remaining of 30 min

  // Running again after carried item is added creates zero duplicates
  const withCarried: HomeworkItem[] = [
    ...hw,
    { ...drafts[0], id: 'hw-cf-1', updatedAt: '2026-11-21T15:00:00Z' },
  ];
  const secondRun = buildCarryForwardHomeworkDrafts({
    homework: withCarried,
    fromDate: '2026-11-21',
    toDate: '2026-11-22',
  });
  assert.equal(secondRun.length, 0);
});
