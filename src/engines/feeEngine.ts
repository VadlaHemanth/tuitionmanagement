import type {
  BoardType,
  ClassLevel,
  DiscountRule,
  FeeInvoice,
  FeeRateConfig,
  ReminderSettings,
  Student,
} from '../types';
import {
  buildDueDateForMonth,
  daysInMonth,
  diffDaysBetweenDateStrs,
  formatRupeesFromPaise,
} from './istDate';

export const DEFAULT_FEE_CONFIG: FeeRateConfig = {
  classRatesPaise: {
    3: 50_000,  // ₹500
    4: 50_000,  // ₹500
    5: 50_000,  // ₹500
    6: 60_000,  // ₹600
    7: 70_000,  // ₹700
    8: 80_000,  // ₹800
    9: 90_000,  // ₹900
    10: 100_000, // ₹1,000
  },
  boardSurchargesPaise: {
    SSC: 0,
    CBSE: 20_000, // +₹200
    ICSE: 20_000, // +₹200
  },
  prorateFirstMonth: false,
  defaultDueDay: 5,
};

export interface FeeCalculationBreakdown {
  baseClassRatePaise: number;
  boardSurchargePaise: number;
  standardTotalPaise: number;
  overrideApplied: boolean;
  overrideReason: string | null;
  subtotalPaise: number;
  appliedDiscounts: {
    id: string;
    name: string;
    amountPaise: number;
  }[];
  totalDiscountPaise: number;
  prorationApplied: boolean;
  proratedAmountPaise: number | null;
  finalAmountPaise: number;
  steps: string[];
}

export function isDateWithinRange(targetDate: string, startDate?: string, endDate?: string): boolean {
  if (startDate && targetDate < startDate) return false;
  if (endDate && targetDate > endDate) return false;
  return true;
}

export function getStandardClassBoardFeePaise(
  classLevel: ClassLevel,
  board: BoardType,
  config: FeeRateConfig = DEFAULT_FEE_CONFIG,
): { baseClassRatePaise: number; boardSurchargePaise: number; totalPaise: number } {
  const baseClassRatePaise = config.classRatesPaise[classLevel] ?? 50_000;
  const boardSurchargePaise = config.boardSurchargesPaise[board] ?? 0;
  return {
    baseClassRatePaise,
    boardSurchargePaise,
    totalPaise: Math.max(0, baseClassRatePaise + boardSurchargePaise),
  };
}

export function calculateStudentMonthlyFee(params: {
  student: Pick<Student, 'id' | 'classLevel' | 'board' | 'feeOverride' | 'admissionDate'>;
  feeConfig: FeeRateConfig;
  discounts: DiscountRule[];
  asOfDate: string; // YYYY-MM-DD
  monthKey?: string; // YYYY-MM (used if checking first-month proration)
  applyProration?: boolean;
}): FeeCalculationBreakdown {
  const { student, feeConfig, discounts, asOfDate, monthKey, applyProration } = params;
  const std = getStandardClassBoardFeePaise(student.classLevel, student.board, feeConfig);
  const steps: string[] = [];

  let subtotalPaise = std.totalPaise;
  let overrideApplied = false;
  let overrideReason: string | null = null;

  const ov = student.feeOverride;
  if (ov && Number.isFinite(ov.amountPaise) && ov.amountPaise >= 0) {
    const activeOverride = !ov.isTemporary || isDateWithinRange(asOfDate, ov.startDate, ov.endDate);
    if (activeOverride) {
      overrideApplied = true;
      overrideReason = ov.reason || (ov.isTemporary ? 'Temporary custom fee' : 'Permanent custom fee');
      subtotalPaise = Math.max(0, Math.round(ov.amountPaise));
      steps.push(`Custom fee override (${overrideReason}): ${formatRupeesFromPaise(subtotalPaise)}`);
    }
  }

  if (!overrideApplied) {
    steps.push(`Class ${student.classLevel} base fee: ${formatRupeesFromPaise(std.baseClassRatePaise)}`);
    if (std.boardSurchargePaise > 0) {
      steps.push(`${student.board} board surcharge: +${formatRupeesFromPaise(std.boardSurchargePaise)}`);
    } else {
      steps.push(`${student.board} board surcharge: ₹0`);
    }
  }

  // Deduplicate discounts by id and scope match, ordered: fixed first, then percentage
  const seenIds = new Set<string>();
  const eligible = discounts.filter((d) => {
    if (!d.active || seenIds.has(d.id)) return false;
    seenIds.add(d.id);
    if (!isDateWithinRange(asOfDate, d.startDate, d.endDate)) return false;
    if (d.scope === 'student') return d.studentId === student.id;
    if (d.scope === 'class') return d.classLevel === student.classLevel;
    if (d.scope === 'board') return d.board === student.board;
    if (d.scope === 'global') return true;
    return false;
  });

  // Prevent accidental duplicate identical discounts (same scope + name + kind + value)
  const seenSignatures = new Set<string>();
  const uniqueDiscounts = eligible.filter((d) => {
    const sig = `${d.scope}:${d.name.trim().toLowerCase()}:${d.kind}:${d.value}`;
    if (seenSignatures.has(sig)) return false;
    seenSignatures.add(sig);
    return true;
  });

  let runningPaise = subtotalPaise;
  const appliedDiscounts: { id: string; name: string; amountPaise: number }[] = [];
  let totalDiscountPaise = 0;

  // Apply percentage discounts against subtotal, then fixed discounts, never going below 0
  const ordered = [
    ...uniqueDiscounts.filter((d) => d.kind === 'percentage'),
    ...uniqueDiscounts.filter((d) => d.kind === 'fixed'),
  ];

  for (const d of ordered) {
    if (runningPaise <= 0) break;
    let deduction = 0;
    if (d.kind === 'percentage') {
      const clampedPct = Math.max(0, Math.min(100, d.value));
      deduction = Math.round((runningPaise * clampedPct) / 100);
    } else {
      deduction = Math.max(0, Math.round(d.value));
    }
    const actualDeduction = Math.min(runningPaise, deduction);
    if (actualDeduction > 0) {
      runningPaise -= actualDeduction;
      totalDiscountPaise += actualDeduction;
      appliedDiscounts.push({ id: d.id, name: d.name, amountPaise: actualDeduction });
      const label = d.kind === 'percentage' ? `${d.name} (${d.value}%)` : d.name;
      steps.push(`Discount — ${label}: -${formatRupeesFromPaise(actualDeduction)}`);
    }
  }

  let finalAmountPaise = Math.max(0, runningPaise);
  let prorationApplied = false;
  let proratedAmountPaise: number | null = null;

  const shouldProrate = applyProration ?? feeConfig.prorateFirstMonth;
  if (shouldProrate && monthKey && student.admissionDate.startsWith(monthKey)) {
    const [y, m] = monthKey.split('-').map(Number);
    const totalDays = daysInMonth(y, m);
    const joinDay = Number(student.admissionDate.split('-')[2]);
    if (joinDay > 1 && joinDay <= totalDays) {
      const remainingDays = totalDays - joinDay + 1;
      // Round to nearest ₹10 (1000 paise) for clean Indian rupee collection
      const rawProrated = Math.round((finalAmountPaise * remainingDays) / totalDays);
      proratedAmountPaise = Math.max(0, Math.round(rawProrated / 1000) * 1000);
      prorationApplied = true;
      finalAmountPaise = proratedAmountPaise;
      steps.push(`First-month proration (${remainingDays}/${totalDays} days): ${formatRupeesFromPaise(finalAmountPaise)}`);
    }
  }

  steps.push(`Final payable monthly fee: ${formatRupeesFromPaise(finalAmountPaise)}`);

  return {
    baseClassRatePaise: std.baseClassRatePaise,
    boardSurchargePaise: std.boardSurchargePaise,
    standardTotalPaise: std.totalPaise,
    overrideApplied,
    overrideReason,
    subtotalPaise,
    appliedDiscounts,
    totalDiscountPaise,
    prorationApplied,
    proratedAmountPaise,
    finalAmountPaise,
    steps,
  };
}

export interface PromotionPreviewItem {
  studentId: string;
  studentName: string;
  currentClass: ClassLevel;
  nextClass: ClassLevel | 'graduated';
  board: BoardType;
  currentFeePaise: number;
  newClassFeePaise: number;
  hasCustomOverride: boolean;
  effectiveNextFeePaise: number;
  feeDeltaPaise: number;
  note: string;
}

export function previewStudentPromotion(params: {
  student: Student;
  feeConfig: FeeRateConfig;
  discounts: DiscountRule[];
  effectiveDate: string;
  overridePolicy: 'keep_override' | 'adopt_class_rate';
  targetBoard?: BoardType;
}): PromotionPreviewItem {
  const { student, feeConfig, discounts, effectiveDate, overridePolicy, targetBoard } = params;
  const currentCalc = calculateStudentMonthlyFee({
    student,
    feeConfig,
    discounts,
    asOfDate: effectiveDate,
    applyProration: false,
  });

  const nextBoard = targetBoard ?? student.board;

  if (student.classLevel >= 10) {
    return {
      studentId: student.id,
      studentName: student.fullName,
      currentClass: student.classLevel,
      nextClass: 'graduated',
      board: nextBoard,
      currentFeePaise: currentCalc.finalAmountPaise,
      newClassFeePaise: 0,
      hasCustomOverride: Boolean(student.feeOverride),
      effectiveNextFeePaise: 0,
      feeDeltaPaise: -currentCalc.finalAmountPaise,
      note: 'Graduates after Class 10; historical invoices and records preserved.',
    };
  }

  const nextClass = (student.classLevel + 1) as ClassLevel;
  const standardNext = calculateStudentMonthlyFee({
    student: {
      id: student.id,
      classLevel: nextClass,
      board: nextBoard,
      feeOverride: null,
      admissionDate: student.admissionDate,
    },
    feeConfig,
    discounts,
    asOfDate: effectiveDate,
    applyProration: false,
  });

  const hasCustomOverride = Boolean(student.feeOverride);
  const nextCalc = calculateStudentMonthlyFee({
    student: {
      id: student.id,
      classLevel: nextClass,
      board: nextBoard,
      feeOverride: overridePolicy === 'keep_override' ? student.feeOverride : null,
      admissionDate: student.admissionDate,
    },
    feeConfig,
    discounts,
    asOfDate: effectiveDate,
    applyProration: false,
  });

  const delta = nextCalc.finalAmountPaise - currentCalc.finalAmountPaise;
  let note = 'Same monthly rate applies to the next class.';
  if (hasCustomOverride && overridePolicy === 'keep_override') {
    note = 'Custom fee override preserved for future billing.';
  } else if (delta > 0) {
    note = `Future monthly fee adjusts by +${formatRupeesFromPaise(delta)} (historical invoices unchanged).`;
  } else if (delta < 0) {
    note = `Future monthly fee adjusts by ${formatRupeesFromPaise(delta)} (historical invoices unchanged).`;
  }

  return {
    studentId: student.id,
    studentName: student.fullName,
    currentClass: student.classLevel,
    nextClass,
    board: nextBoard,
    currentFeePaise: currentCalc.finalAmountPaise,
    newClassFeePaise: standardNext.finalAmountPaise,
    hasCustomOverride,
    effectiveNextFeePaise: nextCalc.finalAmountPaise,
    feeDeltaPaise: delta,
    note,
  };
}

export function computeInvoiceStatus(
  totalAmountPaise: number,
  paidAmountPaise: number,
  dueDate: string,
  todayDate: string,
  waived = false,
): FeeInvoice['status'] {
  if (waived) return 'waived';
  if (totalAmountPaise === 0 || paidAmountPaise >= totalAmountPaise) return 'paid';
  if (paidAmountPaise > 0) {
    return todayDate > dueDate ? 'overdue' : 'partial';
  }
  return todayDate > dueDate ? 'overdue' : 'unpaid';
}

export function allocatePaymentToInvoices(params: {
  invoices: FeeInvoice[]; // invoices for a single student
  paymentAmountPaise: number;
  todayDate: string;
  targetInvoiceId?: string | null;
}): {
  allocations: { invoiceId: string; appliedPaise: number; newPaidPaise: number; newStatus: FeeInvoice['status'] }[];
  remainingAdvanceCreditPaise: number;
} {
  const { invoices, paymentAmountPaise, todayDate, targetInvoiceId } = params;
  let remaining = Math.max(0, Math.round(paymentAmountPaise));
  const allocations: {
    invoiceId: string;
    appliedPaise: number;
    newPaidPaise: number;
    newStatus: FeeInvoice['status'];
  }[] = [];

  // Sort oldest unpaid/overdue first, but put explicitly targeted invoice first
  const candidates = invoices
    .filter((inv) => inv.status !== 'paid' && inv.status !== 'waived' && inv.totalAmountPaise > inv.paidAmountPaise)
    .sort((a, b) => {
      if (targetInvoiceId && a.id === targetInvoiceId) return -1;
      if (targetInvoiceId && b.id === targetInvoiceId) return 1;
      return a.monthKey.localeCompare(b.monthKey);
    });

  for (const inv of candidates) {
    if (remaining <= 0) break;
    const balance = inv.totalAmountPaise - inv.paidAmountPaise;
    const applied = Math.min(balance, remaining);
    const newPaid = inv.paidAmountPaise + applied;
    allocations.push({
      invoiceId: inv.id,
      appliedPaise: applied,
      newPaidPaise: newPaid,
      newStatus: computeInvoiceStatus(inv.totalAmountPaise, newPaid, inv.dueDate, todayDate, false),
    });
    remaining -= applied;
  }

  return {
    allocations,
    remainingAdvanceCreditPaise: remaining,
  };
}

export interface FeeReminderCandidate {
  studentId: string;
  studentName: string;
  parentName: string;
  parentPhone: string;
  invoiceId: string;
  monthKey: string;
  dueDate: string;
  balancePaise: number;
  unpaidMonthCount: number;
  daysFromDue: number; // negative = days before due, 0 = due today, positive = days overdue
  reason: string;
  urgency: 'urgent' | 'high' | 'normal';
  dedupKey: string;
  suggestedMessage: string;
}

export function evaluateFeeReminders(params: {
  students: Student[];
  invoices: FeeInvoice[];
  todayDate: string;
  reminderSettings: ReminderSettings;
  tuitionName: string;
}): FeeReminderCandidate[] {
  const { students, invoices, todayDate, reminderSettings, tuitionName } = params;
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const results: FeeReminderCandidate[] = [];

  // Group unpaid invoices by student
  const unpaidByStudent = new Map<string, FeeInvoice[]>();
  for (const inv of invoices) {
    if (inv.status === 'paid' || inv.status === 'waived') continue;
    if (inv.totalAmountPaise <= inv.paidAmountPaise) continue;
    const list = unpaidByStudent.get(inv.studentId) ?? [];
    list.push(inv);
    unpaidByStudent.set(inv.studentId, list);
  }

  for (const [studentId, studentInvoices] of unpaidByStudent.entries()) {
    const student = studentMap.get(studentId);
    if (!student || student.status === 'discontinued') continue;

    studentInvoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const oldest = studentInvoices[0];
    const totalBalancePaise = studentInvoices.reduce(
      (sum, inv) => sum + Math.max(0, inv.totalAmountPaise - inv.paidAmountPaise),
      0,
    );

    const daysFromDue = diffDaysBetweenDateStrs(oldest.dueDate, todayDate);
    let reason: string | null = null;
    let urgency: 'urgent' | 'high' | 'normal' = 'normal';
    let triggerTag = '';

    if (daysFromDue === -reminderSettings.feeDaysBefore) {
      reason = `Fee due in ${reminderSettings.feeDaysBefore} days`;
      urgency = 'normal';
      triggerTag = `before-${reminderSettings.feeDaysBefore}`;
    } else if (daysFromDue < 0 && daysFromDue > -reminderSettings.feeDaysBefore) {
      reason = `Fee due in ${Math.abs(daysFromDue)} day${Math.abs(daysFromDue) === 1 ? '' : 's'}`;
      urgency = 'normal';
      triggerTag = `approaching-${Math.abs(daysFromDue)}`;
    } else if (daysFromDue === 0 && reminderSettings.feeOnDueDate) {
      reason = 'Fee due today';
      urgency = 'high';
      triggerTag = 'due-today';
    } else if (daysFromDue > 0) {
      const isPartial = oldest.paidAmountPaise > 0;
      const isMultiple = studentInvoices.length > 1;
      if (isMultiple) {
        reason = `${studentInvoices.length} unpaid months · Overdue by ${daysFromDue}d`;
        urgency = 'urgent';
      } else if (isPartial) {
        reason = `Partial balance remaining · Overdue by ${daysFromDue}d`;
        urgency = 'urgent';
      } else {
        reason = `Fee overdue by ${daysFromDue} day${daysFromDue === 1 ? '' : 's'}`;
        urgency = daysFromDue >= reminderSettings.feeDaysAfter ? 'urgent' : 'high';
      }
      const bucket = Math.floor(daysFromDue / Math.max(1, reminderSettings.feeOverdueRepeatDays));
      triggerTag = `overdue-bucket-${bucket}`;
    }

    if (reason) {
      const formattedAmount = formatRupeesFromPaise(totalBalancePaise);
      const template = reminderSettings.feeMessageTemplate ||
        'Namaste {{parentName}}, gentle reminder from {{tuitionName}} that tuition fee of {{amount}} for {{studentName}} ({{month}}) is due on {{dueDate}}. Thank you!';
      const suggestedMessage = template
        .replace(/\{\{parentName\}\}/g, student.parentName)
        .replace(/\{\{studentName\}\}/g, student.fullName)
        .replace(/\{\{amount\}\}/g, formattedAmount)
        .replace(/\{\{month\}\}/g, oldest.monthKey)
        .replace(/\{\{dueDate\}\}/g, oldest.dueDate)
        .replace(/\{\{tuitionName\}\}/g, tuitionName);

      results.push({
        studentId: student.id,
        studentName: student.fullName,
        parentName: student.parentName,
        parentPhone: student.parentPhone,
        invoiceId: oldest.id,
        monthKey: oldest.monthKey,
        dueDate: oldest.dueDate,
        balancePaise: totalBalancePaise,
        unpaidMonthCount: studentInvoices.length,
        daysFromDue,
        reason,
        urgency,
        dedupKey: `fee:${student.id}:${oldest.monthKey}:${triggerTag}`,
        suggestedMessage,
      });
    }
  }

  return results.sort((a, b) => b.daysFromDue - a.daysFromDue);
}

export function buildMonthlyInvoiceDraft(params: {
  student: Student;
  monthKey: string;
  feeConfig: FeeRateConfig;
  discounts: DiscountRule[];
  existingInvoices: FeeInvoice[];
  todayDate: string;
}): Omit<FeeInvoice, 'id' | 'createdAt' | 'updatedAt'> | null {
  const { student, monthKey, feeConfig, discounts, existingInvoices, todayDate } = params;
  if (student.status !== 'active') return null;

  // Prevent duplicate monthly bills
  const alreadyExists = existingInvoices.some(
    (inv) => inv.studentId === student.id && inv.monthKey === monthKey,
  );
  if (alreadyExists) return null;

  const dueDate = buildDueDateForMonth(monthKey, student.feeDueDay || feeConfig.defaultDueDay);
  const calc = calculateStudentMonthlyFee({
    student,
    feeConfig,
    discounts,
    asOfDate: dueDate,
    monthKey,
    applyProration: feeConfig.prorateFirstMonth,
  });

  // Automatically apply student advance credit if available
  const appliedCredit = Math.min(Math.max(0, student.creditBalancePaise), calc.finalAmountPaise);
  const status = computeInvoiceStatus(calc.finalAmountPaise, appliedCredit, dueDate, todayDate, false);

  return {
    studentId: student.id,
    monthKey,
    classLevelSnapshot: student.classLevel,
    boardSnapshot: student.board,
    baseAmountPaise: calc.baseClassRatePaise,
    boardSurchargePaise: calc.boardSurchargePaise,
    overrideApplied: calc.overrideApplied,
    discountPaise: calc.totalDiscountPaise,
    discountSummary: calc.appliedDiscounts.map((d) => d.name).join(', '),
    totalAmountPaise: calc.finalAmountPaise,
    paidAmountPaise: appliedCredit,
    dueDate,
    status,
    notes: appliedCredit > 0 ? `Auto-applied ${formatRupeesFromPaise(appliedCredit)} advance credit` : '',
    isDemo: student.isDemo,
  };
}
