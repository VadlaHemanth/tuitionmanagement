import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FEE_CONFIG,
  allocatePaymentToInvoices,
  buildMonthlyInvoiceDraft,
  calculateStudentMonthlyFee,
  evaluateFeeReminders,
  getStandardClassBoardFeePaise,
  previewStudentPromotion,
} from './feeEngine';
import { buildDueDateForMonth, formatIstDate } from './istDate';
import type { DiscountRule, FeeInvoice, ReminderSettings, Student } from '../types';

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: 'stu-1',
    studentCode: 'TUI-001',
    fullName: 'Rohan Kulkarni',
    avatarColor: '#0284C7',
    classLevel: 7,
    board: 'CBSE',
    schoolName: 'Delhi Public School',
    admissionDate: '2026-06-01',
    parentName: 'Suresh Kulkarni',
    parentPhone: '9876543210',
    subjects: ['Mathematics', 'Science', 'English'],
    strengths: ['Mental Math'],
    weaknesses: ['Fractions'],
    academicPerformance: 78,
    preferredArrivalTime: '18:00',
    allocatedSlot: '18:00–19:30',
    expectedDurationMinutes: 90,
    regularDays: [1, 2, 3, 4, 5, 6],
    feeDueDay: 5,
    feeOverride: null,
    creditBalancePaise: 0,
    notes: '',
    learningSpeed: 'steady',
    priority: 'normal',
    academicGoals: 'Score 90% in Maths',
    status: 'active',
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-06-01T10:00:00Z',
    ...overrides,
  };
}

const DEFAULT_REMINDERS: ReminderSettings = {
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
  feeMessageTemplate: 'Reminder for {{studentName}}: {{amount}} due on {{dueDate}}.',
};

test('default class-wise SSC, CBSE, and ICSE fee matrix matches specification exactly', () => {
  assert.equal(getStandardClassBoardFeePaise(3, 'SSC').totalPaise, 50_000);
  assert.equal(getStandardClassBoardFeePaise(4, 'SSC').totalPaise, 50_000);
  assert.equal(getStandardClassBoardFeePaise(5, 'SSC').totalPaise, 50_000);
  assert.equal(getStandardClassBoardFeePaise(6, 'SSC').totalPaise, 60_000);
  assert.equal(getStandardClassBoardFeePaise(7, 'SSC').totalPaise, 70_000);
  assert.equal(getStandardClassBoardFeePaise(8, 'SSC').totalPaise, 80_000);
  assert.equal(getStandardClassBoardFeePaise(9, 'SSC').totalPaise, 90_000);
  assert.equal(getStandardClassBoardFeePaise(10, 'SSC').totalPaise, 100_000);

  // +₹200 surcharge for CBSE and ICSE
  assert.equal(getStandardClassBoardFeePaise(3, 'CBSE').totalPaise, 70_000);
  assert.equal(getStandardClassBoardFeePaise(5, 'ICSE').totalPaise, 70_000);
  assert.equal(getStandardClassBoardFeePaise(7, 'CBSE').totalPaise, 90_000);
  assert.equal(getStandardClassBoardFeePaise(10, 'ICSE').totalPaise, 120_000);
});

test('global fee edits, individual overrides, fixed/percentage discounts, expiration, and non-negative floor', () => {
  const stu = makeStudent({ classLevel: 7, board: 'CBSE' });
  const discounts: DiscountRule[] = [
    {
      id: 'd1',
      name: 'Sibling Discount',
      kind: 'percentage',
      value: 10,
      scope: 'student',
      studentId: 'stu-1',
      active: true,
      createdAt: '2026-06-01T00:00:00Z',
    },
    {
      id: 'd2',
      name: 'Festive Fixed Off',
      kind: 'fixed',
      value: 10_000, // ₹100
      scope: 'global',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      active: true,
      createdAt: '2026-10-01T00:00:00Z',
    },
    // Accidental duplicate should be deduplicated
    {
      id: 'd3',
      name: 'Sibling Discount',
      kind: 'percentage',
      value: 10,
      scope: 'student',
      studentId: 'stu-1',
      active: true,
      createdAt: '2026-06-02T00:00:00Z',
    },
  ];

  // October: ₹900 -> -10% (₹90) = ₹810 -> -₹100 = ₹710
  const oct = calculateStudentMonthlyFee({
    student: stu,
    feeConfig: DEFAULT_FEE_CONFIG,
    discounts,
    asOfDate: '2026-10-15',
  });
  assert.equal(oct.finalAmountPaise, 71_000);
  assert.equal(oct.appliedDiscounts.length, 2);

  // November: festive discount expired -> ₹900 -> -10% = ₹810
  const nov = calculateStudentMonthlyFee({
    student: stu,
    feeConfig: DEFAULT_FEE_CONFIG,
    discounts,
    asOfDate: '2026-11-15',
  });
  assert.equal(nov.finalAmountPaise, 81_000);

  // Huge discount never produces negative fee
  const hugeDiscount: DiscountRule[] = [
    {
      id: 'd-huge',
      name: 'Scholarship',
      kind: 'fixed',
      value: 500_000,
      scope: 'student',
      studentId: 'stu-1',
      active: true,
      createdAt: '2026-06-01T00:00:00Z',
    },
  ];
  const zeroFloor = calculateStudentMonthlyFee({
    student: stu,
    feeConfig: DEFAULT_FEE_CONFIG,
    discounts: hugeDiscount,
    asOfDate: '2026-11-15',
  });
  assert.equal(zeroFloor.finalAmountPaise, 0);

  // Temporary override applies only inside date window
  const stuTempOv = makeStudent({
    classLevel: 7,
    board: 'CBSE',
    feeOverride: {
      amountPaise: 65_000,
      isTemporary: true,
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      reason: 'Exam month concession',
    },
  });
  assert.equal(
    calculateStudentMonthlyFee({ student: stuTempOv, feeConfig: DEFAULT_FEE_CONFIG, discounts: [], asOfDate: '2026-11-10' }).finalAmountPaise,
    65_000,
  );
  assert.equal(
    calculateStudentMonthlyFee({ student: stuTempOv, feeConfig: DEFAULT_FEE_CONFIG, discounts: [], asOfDate: '2026-12-05' }).finalAmountPaise,
    90_000,
  );
});

test('automatic fee recalculation on class promotion preserves flat tiers and respects override policy', () => {
  // Class 5 SSC -> Class 6 SSC: ₹500 -> ₹600
  const p1 = previewStudentPromotion({
    student: makeStudent({ classLevel: 5, board: 'SSC' }),
    feeConfig: DEFAULT_FEE_CONFIG,
    discounts: [],
    effectiveDate: '2027-04-01',
    overridePolicy: 'adopt_class_rate',
  });
  assert.equal(p1.currentFeePaise, 50_000);
  assert.equal(p1.effectiveNextFeePaise, 60_000);

  // Class 7 CBSE -> Class 8 CBSE: ₹900 -> ₹1,000
  const p2 = previewStudentPromotion({
    student: makeStudent({ classLevel: 7, board: 'CBSE' }),
    feeConfig: DEFAULT_FEE_CONFIG,
    discounts: [],
    effectiveDate: '2027-04-01',
    overridePolicy: 'adopt_class_rate',
  });
  assert.equal(p2.currentFeePaise, 90_000);
  assert.equal(p2.effectiveNextFeePaise, 100_000);

  // Class 4 ICSE -> Class 5 ICSE: Remains ₹700 (no forced increase!)
  const p3 = previewStudentPromotion({
    student: makeStudent({ classLevel: 4, board: 'ICSE' }),
    feeConfig: DEFAULT_FEE_CONFIG,
    discounts: [],
    effectiveDate: '2027-04-01',
    overridePolicy: 'adopt_class_rate',
  });
  assert.equal(p3.currentFeePaise, 70_000);
  assert.equal(p3.effectiveNextFeePaise, 70_000);
  assert.equal(p3.feeDeltaPaise, 0);

  // Student with custom override chooses keep_override vs adopt_class_rate
  const special = makeStudent({
    classLevel: 6,
    board: 'SSC',
    feeOverride: { amountPaise: 45_000, isTemporary: false, reason: 'Special arrangement' },
  });
  const keep = previewStudentPromotion({
    student: special,
    feeConfig: DEFAULT_FEE_CONFIG,
    discounts: [],
    effectiveDate: '2027-04-01',
    overridePolicy: 'keep_override',
  });
  assert.equal(keep.effectiveNextFeePaise, 45_000);
  const adopt = previewStudentPromotion({
    student: special,
    feeConfig: DEFAULT_FEE_CONFIG,
    discounts: [],
    effectiveDate: '2027-04-01',
    overridePolicy: 'adopt_class_rate',
  });
  assert.equal(adopt.effectiveNextFeePaise, 70_000);
});

test('monthly invoice generation prevents duplicates, handles partial & advance payments, and evaluates fee reminders', () => {
  const stu = makeStudent({ classLevel: 7, board: 'CBSE', creditBalancePaise: 20_000 });
  const draft1 = buildMonthlyInvoiceDraft({
    student: stu,
    monthKey: '2026-11',
    feeConfig: DEFAULT_FEE_CONFIG,
    discounts: [],
    existingInvoices: [],
    todayDate: '2026-11-01',
  });
  assert.ok(draft1);
  assert.equal(draft1.totalAmountPaise, 90_000);
  assert.equal(draft1.paidAmountPaise, 20_000); // auto-applied credit
  assert.equal(draft1.status, 'partial');

  const existing: FeeInvoice = {
    ...draft1,
    id: 'inv-1',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };

  // Duplicate invoice for same month must return null
  const dup = buildMonthlyInvoiceDraft({
    student: stu,
    monthKey: '2026-11',
    feeConfig: DEFAULT_FEE_CONFIG,
    discounts: [],
    existingInvoices: [existing],
    todayDate: '2026-11-02',
  });
  assert.equal(dup, null);

  // Payment larger than remaining balance (₹700 balance, pays ₹1,000 -> ₹300 advance credit)
  const alloc = allocatePaymentToInvoices({
    invoices: [existing],
    paymentAmountPaise: 100_000,
    todayDate: '2026-11-04',
  });
  assert.equal(alloc.allocations.length, 1);
  assert.equal(alloc.allocations[0].appliedPaise, 70_000);
  assert.equal(alloc.allocations[0].newStatus, 'paid');
  assert.equal(alloc.remainingAdvanceCreditPaise, 30_000);

  // Fee reminders evaluate due-in-3-days and overdue cleanly
  const remindersBefore = evaluateFeeReminders({
    students: [stu],
    invoices: [existing],
    todayDate: '2026-11-02', // dueDate is 2026-11-05 -> 3 days before
    reminderSettings: DEFAULT_REMINDERS,
    tuitionName: 'Tuitio',
  });
  assert.equal(remindersBefore.length, 1);
  assert.match(remindersBefore[0].reason, /3 days/);

  const remindersOverdue = evaluateFeeReminders({
    students: [stu],
    invoices: [existing],
    todayDate: '2026-11-10', // 5 days overdue
    reminderSettings: DEFAULT_REMINDERS,
    tuitionName: 'Tuitio',
  });
  assert.equal(remindersOverdue.length, 1);
  assert.equal(remindersOverdue[0].urgency, 'urgent');
});

test('month-end due date clamping and IST date conversion handle edge cases cleanly', () => {
  assert.equal(buildDueDateForMonth('2026-02', 31), '2026-02-28');
  assert.equal(buildDueDateForMonth('2028-02', 31), '2028-02-29'); // leap year
  assert.equal(buildDueDateForMonth('2026-12', 31), '2026-12-31');

  // 2026-11-21T19:00:00Z is 2026-11-22 00:30 IST (next day in India!)
  const utcLateEvening = new Date('2026-11-21T19:00:00Z');
  assert.equal(formatIstDate(utcLateEvening), '2026-11-22');
});
