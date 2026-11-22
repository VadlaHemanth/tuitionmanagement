import type {
  AttendanceRecord,
  DailyPlanResult,
  ExamItem,
  FeeInvoice,
  HomeworkItem,
  PriorityLevel,
  ScheduleBlock,
  Student,
  StudentAttentionPlan,
  TuitionSettings,
} from '../types';
import {
  addDaysToDateStr,
  diffDaysBetweenDateStrs,
  getDayOfWeekFromDateStr,
  parseTimeToMinutes,
} from './istDate';
import { evaluateFeeReminders } from './feeEngine';

export function isStudentExpectedOnDate(student: Student, dateStr: string, holidays: string[]): boolean {
  if (student.status !== 'active') return false;
  if (holidays.includes(dateStr)) return false;
  const dow = getDayOfWeekFromDateStr(dateStr);
  return student.regularDays.includes(dow);
}

export function generateDailyTuitionPlan(params: {
  date: string; // YYYY-MM-DD (IST)
  settings: TuitionSettings;
  students: Student[];
  attendance: AttendanceRecord[];
  homework: HomeworkItem[];
  exams: ExamItem[];
  invoices: FeeInvoice[];
  customBlockOverrides?: Partial<Record<ScheduleBlock['mode'], number>>;
}): DailyPlanResult {
  const { date, settings, students, attendance, homework, exams, invoices, customBlockOverrides } = params;
  const sessionStartMin = parseTimeToMinutes(settings.sessionStart);
  const sessionEndMin = parseTimeToMinutes(settings.sessionEnd);
  const totalSessionMinutes = Math.max(30, sessionEndMin - sessionStartMin);

  const attendanceTodayMap = new Map<string, AttendanceRecord>();
  for (const a of attendance) {
    if (a.date === date) attendanceTodayMap.set(a.studentId, a);
  }

  // Expected students today (or anyone explicitly marked present/late today)
  const activeToday = students.filter((s) => {
    const rec = attendanceTodayMap.get(s.id);
    if (rec && (rec.status === 'present' || rec.status === 'late')) return true;
    return isStudentExpectedOnDate(s, date, settings.holidays);
  });

  // Exclude confirmed absent/excused students from active teacher slots (Rule D)
  const participatingStudents = activeToday.filter((s) => {
    const rec = attendanceTodayMap.get(s.id);
    return !rec || (rec.status !== 'absent' && rec.status !== 'excused');
  });

  const studentPlans: StudentAttentionPlan[] = [];
  const topicBuckets = new Map<string, { subject: string; topic: string; students: Student[] }>();

  for (const s of participatingStudents) {
    const rec = attendanceTodayMap.get(s.id);
    const attStatus = rec?.status ?? 'unmarked';
    const effectiveArrival = rec?.actualArrivalTime || s.preferredArrivalTime || settings.sessionStart;
    const arrivalMin = Math.max(sessionStartMin, parseTimeToMinutes(effectiveArrival));
    const availableWindowMin = Math.max(15, sessionEndMin - arrivalMin);

    const pendingHw = homework.filter(
      (h) =>
        h.studentId === s.id &&
        h.status !== 'completed' &&
        h.status !== 'verified',
    );

    const upcomingExams = exams
      .filter((e) => e.studentId === s.id && e.obtainedMarks == null)
      .map((e) => ({ exam: e, daysUntil: diffDaysBetweenDateStrs(date, e.examDate) }))
      .filter((x) => x.daysUntil >= 0 && x.daysUntil <= 10)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    let urgencyScore = 10;
    const reasons: string[] = [];
    const topTasks: string[] = [];

    if (s.priority === 'high') {
      urgencyScore += 18;
      reasons.push('High-priority student');
    }
    if (s.learningSpeed === 'needs_support') {
      urgencyScore += 16;
      reasons.push('Needs guided step-by-step support');
    }
    if (attStatus === 'late' || arrivalMin > sessionStartMin + 10) {
      reasons.push(`Arrives at ${effectiveArrival} (adjusted window: ${availableWindowMin} min)`);
    }

    // Rule A: Exam urgency escalation
    const nearestExam = upcomingExams[0] ?? null;
    if (nearestExam) {
      if (nearestExam.daysUntil === 0) {
        urgencyScore += 55;
        reasons.push(`${nearestExam.exam.subject} exam TODAY`);
        topTasks.push(`Quick oral drill: ${nearestExam.exam.examName} (${nearestExam.exam.subject})`);
      } else if (nearestExam.daysUntil === 1) {
        urgencyScore += 48;
        reasons.push(`${nearestExam.exam.subject} exam tomorrow — top priority revision`);
        topTasks.push(`20-min revision: ${nearestExam.exam.subject} (${nearestExam.exam.examName})`);
      } else if (nearestExam.daysUntil <= 3) {
        urgencyScore += 30;
        reasons.push(`${nearestExam.exam.subject} exam in ${nearestExam.daysUntil} days`);
        topTasks.push(`Revision block: ${nearestExam.exam.subject} — ${nearestExam.exam.importantChapters[0] || nearestExam.exam.syllabus}`);
      } else if (nearestExam.daysUntil <= 7) {
        urgencyScore += 14;
        reasons.push(`${nearestExam.exam.subject} exam in ${nearestExam.daysUntil} days (paced daily revision)`);
      }
    }

    // Homework urgency & help needs
    for (const h of pendingHw) {
      const daysDue = diffDaysBetweenDateStrs(date, h.dueDate);
      if (h.needsHelp) {
        urgencyScore += 22;
        reasons.push(`Needs help on ${h.subject}: ${h.topic}`);
      }
      if (daysDue <= 0) {
        urgencyScore += 20;
        reasons.push(`${h.subject} homework due today/overdue`);
      } else if (daysDue === 1) {
        urgencyScore += 14;
      }
      if (h.status === 'carried_forward') {
        urgencyScore += 10;
        reasons.push(`Carried forward: ${h.subject}`);
      }
      if (topTasks.length < 3) {
        topTasks.push(`${h.subject}: ${h.title}`);
      }

      // Collect shared topics for Rule G (group teaching suggestions)
      const key = `${h.subject.toLowerCase()}::${h.topic.trim().toLowerCase()}`;
      if (h.needsHelp || h.priority === 'urgent' || h.priority === 'high') {
        const bucket = topicBuckets.get(key) ?? { subject: h.subject, topic: h.topic, students: [] };
        if (!bucket.students.some((st) => st.id === s.id)) {
          bucket.students.push(s);
        }
        topicBuckets.set(key, bucket);
      }
    }

    // Teacher-exclusive attention minutes vs independent work minutes (parallel model!)
    // Students work mostly independently while teacher rotates for targeted 8–18 min interventions.
    let teacherMin = 8;
    if (nearestExam && nearestExam.daysUntil <= 1) teacherMin += 8;
    else if (nearestExam && nearestExam.daysUntil <= 3) teacherMin += 4;
    if (pendingHw.some((h) => h.needsHelp)) teacherMin += 6;
    if (s.learningSpeed === 'needs_support') teacherMin += 4;
    if (s.learningSpeed === 'fast' && !nearestExam) teacherMin = Math.max(6, teacherMin - 3);
    teacherMin = Math.min(teacherMin, Math.min(25, Math.floor(availableWindowMin * 0.45)));

    const independentMin = Math.max(15, Math.min(s.expectedDurationMinutes, availableWindowMin) - teacherMin);

    if (reasons.length === 0) {
      reasons.push('Regular syllabus practice & homework verification');
    }

    studentPlans.push({
      studentId: s.id,
      studentName: s.fullName,
      classLevel: s.classLevel,
      board: s.board,
      attendanceStatus: attStatus,
      arrivalTime: effectiveArrival,
      urgencyScore,
      reasons: Array.from(new Set(reasons)).slice(0, 3),
      recommendedTeacherMinutes: teacherMin,
      independentMinutes: independentMin,
      topTasks: topTasks.length > 0 ? topTasks : [`${s.subjects[0] ?? 'Core'} daily practice`],
      upcomingExam: nearestExam
        ? {
            subject: nearestExam.exam.subject,
            examName: nearestExam.exam.examName,
            daysUntil: nearestExam.daysUntil,
          }
        : null,
    });
  }

  studentPlans.sort((a, b) => b.urgencyScore - a.urgencyScore);

  // Rule G: Group teaching detection when 2+ students share a topic or weak subject
  const groupSuggestions: DailyPlanResult['groupSuggestions'] = [];
  for (const bucket of topicBuckets.values()) {
    if (bucket.students.length >= 2) {
      groupSuggestions.push({
        subject: bucket.subject,
        topic: bucket.topic,
        studentIds: bucket.students.map((st) => st.id),
        studentNames: bucket.students.map((st) => st.fullName),
        reason: `${bucket.students.length} students need help with ${bucket.subject} (${bucket.topic}) — teach together to save ${Math.max(8, (bucket.students.length - 1) * 8)} min of teacher time.`,
      });
    }
  }

  // Also check shared weak subjects among same/adjacent classes if no homework topic matched
  if (groupSuggestions.length === 0 && participatingStudents.length >= 2) {
    const weakMap = new Map<string, Student[]>();
    for (const s of participatingStudents) {
      for (const w of s.weaknesses) {
        const k = w.trim().toLowerCase();
        if (!k) continue;
        const arr = weakMap.get(k) ?? [];
        arr.push(s);
        weakMap.set(k, arr);
      }
    }
    for (const [topic, list] of weakMap.entries()) {
      if (list.length >= 2) {
        groupSuggestions.push({
          subject: list[0].subjects[0] ?? 'Core',
          topic: topic.charAt(0).toUpperCase() + topic.slice(1),
          studentIds: list.map((x) => x.id),
          studentNames: list.map((x) => x.fullName),
          reason: `${list.length} students share "${topic}" as a weak area — combine into a 15-min mini-group explanation.`,
        });
      }
    }
  }

  // Construct parallel 6:00 PM – 8:00 PM blocks (editable durations)
  const checkinDur = customBlockOverrides?.checkin ?? 10;
  const groupDur = customBlockOverrides?.group_teaching ?? (groupSuggestions.length > 0 ? 20 : 15);
  const rotationDur = customBlockOverrides?.individual_rotation ?? 30;
  const examDur = customBlockOverrides?.exam_prep ?? (studentPlans.some((p) => p.upcomingExam && p.upcomingExam.daysUntil <= 3) ? 25 : 20);
  const doubtDur = customBlockOverrides?.doubt_check ?? 20;
  const wrapDur = customBlockOverrides?.wrap_up ?? 15;

  const examFocusIds = studentPlans
    .filter((p) => p.upcomingExam && p.upcomingExam.daysUntil <= 7)
    .map((p) => p.studentId);
  const topNeedsIds = studentPlans.slice(0, 4).map((p) => p.studentId);
  const groupFocusIds = groupSuggestions[0]?.studentIds ?? studentPlans.slice(0, 2).map((p) => p.studentId);
  const allIds = studentPlans.map((p) => p.studentId);

  const rawBlocks: Omit<ScheduleBlock, 'startMinute' | 'endMinute'>[] = [
    {
      id: 'blk-checkin',
      title: 'Attendance & Homework Check-In',
      mode: 'checkin',
      teacherActivity: 'Mark arrivals via swipe attendance, check yesterday’s carried-forward work, and confirm today’s targets.',
      studentActivity: 'Students settle in, open notebooks, and begin warm-up independent homework immediately.',
      teacherExclusiveMinutes: checkinDur,
      focusStudentIds: allIds,
      parallelStudentIds: allIds,
      reason: 'Establishes momentum in the first 10 minutes without wasting teaching time.',
    },
    {
      id: 'blk-group',
      title: groupSuggestions[0]
        ? `Concept Explanation: ${groupSuggestions[0].subject} (${groupSuggestions[0].topic})`
        : 'Difficult Concepts & Guided Explanation',
      mode: 'group_teaching',
      teacherActivity: groupSuggestions[0]
        ? `Teach ${groupSuggestions[0].topic} jointly to ${groupSuggestions[0].studentNames.join(', ')}.`
        : 'Explain high-difficulty chapters on whiteboard for students needing concept clarity.',
      studentActivity: 'Other students continue independent school & tuition worksheets.',
      teacherExclusiveMinutes: groupDur,
      focusStudentIds: groupFocusIds,
      parallelStudentIds: allIds.filter((id) => !groupFocusIds.includes(id)),
      reason: groupSuggestions[0]?.reason ?? 'Front-loads complex concepts while attention is freshest.',
    },
    {
      id: 'blk-rotation',
      title: 'Individual Doubt-Clearing Rotation',
      mode: 'individual_rotation',
      teacherActivity: `Rotate 6–10 min focused support across priority students (${studentPlans.slice(0, 3).map((s) => s.studentName).join(', ') || 'active batch'}).`,
      studentActivity: 'Non-active students solve assigned textbook exercises independently.',
      teacherExclusiveMinutes: rotationDur,
      focusStudentIds: topNeedsIds,
      parallelStudentIds: allIds.filter((id) => !topNeedsIds.includes(id)),
      reason: 'Balances simultaneous multi-class learners so everyone progresses in parallel.',
    },
    {
      id: 'blk-exam',
      title: examFocusIds.length > 0 ? 'Exam Preparation & Oral Questioning' : 'Practice Drill & Concept Check',
      mode: 'exam_prep',
      teacherActivity: examFocusIds.length > 0
        ? `Conduct rapid oral questioning & mock drills for upcoming exams (${studentPlans.filter((p) => examFocusIds.includes(p.studentId)).map((p) => `${p.studentName}: ${p.upcomingExam?.subject}`).join('; ')}).`
        : 'Spot-check understanding with quick verbal questions and sample sums.',
      studentActivity: 'Written practice, formula recall, and silent revision.',
      teacherExclusiveMinutes: examDur,
      focusStudentIds: examFocusIds.length > 0 ? examFocusIds : topNeedsIds,
      parallelStudentIds: allIds.filter((id) => !(examFocusIds.length > 0 ? examFocusIds : topNeedsIds).includes(id)),
      reason: examFocusIds.length > 0 ? 'Rule A: Escalates exams within 1–7 days automatically.' : 'Reinforces retention before verification.',
    },
    {
      id: 'blk-doubt',
      title: 'Completion Verification & Final Doubts',
      mode: 'doubt_check',
      teacherActivity: 'Verify completed homework, clear remaining sticky doubts, and flag partial work.',
      studentActivity: 'Finish priority assignments and correct marked errors.',
      teacherExclusiveMinutes: doubtDur,
      focusStudentIds: allIds,
      parallelStudentIds: allIds,
      reason: 'Ensures work is verified on the spot rather than piling up.',
    },
    {
      id: 'blk-wrap',
      title: 'Daily Review & Tomorrow’s Homework',
      mode: 'wrap_up',
      teacherActivity: 'Log daily progress, carry forward unfinished work cleanly, and note tomorrow’s tasks.',
      studentActivity: 'Pack bags, record next session’s targets in diary.',
      teacherExclusiveMinutes: wrapDur,
      focusStudentIds: allIds,
      parallelStudentIds: allIds,
      reason: 'Leaves a clean handoff for tomorrow’s 5:30 PM prep summary.',
    },
  ];

  // Calculate timeline and detect overload honestly (never silently overbook!)
  let cursor = sessionStartMin;
  const blocks: ScheduleBlock[] = rawBlocks.map((b) => {
    const startMinute = cursor;
    const endMinute = cursor + b.teacherExclusiveMinutes;
    cursor = endMinute;
    return { ...b, startMinute, endMinute };
  });

  const plannedTeacherExclusiveMinutes = blocks.reduce((acc, b) => acc + b.teacherExclusiveMinutes, 0);
  // Also check sum of individual rotation needs vs rotation + exam + doubt + group pool (accounting for group savings)
  const rawIndividualDemand = studentPlans.reduce((acc, s) => acc + s.recommendedTeacherMinutes, 0);
  const groupSavings = groupSuggestions.reduce((acc, g) => acc + Math.max(0, (g.studentIds.length - 1) * 7), 0);
  const effectiveDemand = Math.max(0, rawIndividualDemand - groupSavings) + checkinDur + wrapDur;

  const effectiveTotalExclusive = Math.max(plannedTeacherExclusiveMinutes, effectiveDemand);
  const overloadMinutes = Math.max(0, effectiveTotalExclusive - totalSessionMinutes);
  const isOverloaded = overloadMinutes > 0;
  const bufferMinutes = Math.max(0, totalSessionMinutes - plannedTeacherExclusiveMinutes);

  let overloadWarning: string | null = null;
  if (isOverloaded) {
    overloadWarning = `Planned teacher-exclusive work (${effectiveTotalExclusive} min) exceeds your ${totalSessionMinutes}-minute tuition window by ${overloadMinutes} min. Consider grouping shared topics, shifting low-priority homework to independent work, or trimming block durations.`;
  }

  // Generate Next Best Actions (Rules A, B, C, G, H)
  const nextBestActions: DailyPlanResult['nextBestActions'] = [];

  // Rule A: Exam tomorrow/today
  for (const sp of studentPlans) {
    if (sp.upcomingExam && sp.upcomingExam.daysUntil <= 2) {
      nextBestActions.push({
        id: `nba-exam-${sp.studentId}`,
        title: `Ask ${sp.studentName} about ${sp.upcomingExam.daysUntil === 0 ? 'today’s' : sp.upcomingExam.daysUntil === 1 ? 'tomorrow’s' : 'upcoming'} ${sp.upcomingExam.subject} exam`,
        detail: `${sp.upcomingExam.examName} · Class ${sp.classLevel} ${sp.board}`,
        studentId: sp.studentId,
        category: 'exam',
        priority: 'urgent',
        reason: `Exam is ${sp.upcomingExam.daysUntil === 0 ? 'today' : `in ${sp.upcomingExam.daysUntil} day(s)`}.`,
      });
    }
  }

  // Rule G: Group teaching opportunity
  if (groupSuggestions[0]) {
    nextBestActions.push({
      id: `nba-group-0`,
      title: `Run a 15-min group explanation on ${groupSuggestions[0].topic}`,
      detail: `${groupSuggestions[0].studentNames.join(', ')} (${groupSuggestions[0].subject})`,
      category: 'group',
      priority: 'high',
      reason: groupSuggestions[0].reason,
    });
  }

  // Homework needing help or due today
  for (const h of homework) {
    if (h.status === 'completed' || h.status === 'verified') continue;
    const student = participatingStudents.find((s) => s.id === h.studentId);
    if (!student) continue;
    const daysDue = diffDaysBetweenDateStrs(date, h.dueDate);
    if (h.needsHelp) {
      nextBestActions.push({
        id: `nba-help-${h.id}`,
        title: `Help ${student.fullName} with ${h.subject} — ${h.topic}`,
        detail: `${h.title} (${h.estimatedMinutes} min est.)`,
        studentId: student.id,
        category: 'doubt',
        priority: 'high',
        reason: 'Flagged as Needs Help.',
      });
    } else if (daysDue <= 0) {
      nextBestActions.push({
        id: `nba-hw-${h.id}`,
        title: `Check ${student.fullName}’s ${h.subject} homework`,
        detail: `${h.title} · Due ${h.dueDate}`,
        studentId: student.id,
        category: 'homework',
        priority: 'high',
        reason: daysDue < 0 ? `Overdue by ${Math.abs(daysDue)} day(s).` : 'Due today.',
      });
    }
  }

  // Rule C: Fee reminders
  const feeReminders = evaluateFeeReminders({
    students,
    invoices,
    todayDate: date,
    reminderSettings: settings.reminders,
    tuitionName: settings.tuitionName,
  });
  for (const rem of feeReminders.slice(0, 2)) {
    nextBestActions.push({
      id: `nba-fee-${rem.studentId}`,
      title: `Remind ${rem.parentName} about ${rem.studentName}’s fee`,
      detail: `${rem.reason} · Balance due`,
      studentId: rem.studentId,
      category: 'fee',
      priority: rem.urgency,
      reason: rem.reason,
    });
  }

  // Rule H: Repeated absences (3+ absences in last 14 days)
  const fourteenDaysAgo = addDaysToDateStr(date, -14);
  for (const s of students.filter((st) => st.status === 'active')) {
    const recentAbsences = attendance.filter(
      (a) => a.studentId === s.id && a.status === 'absent' && a.date >= fourteenDaysAgo && a.date <= date,
    ).length;
    if (recentAbsences >= 3) {
      nextBestActions.push({
        id: `nba-absent-${s.id}`,
        title: `Follow up on ${s.fullName}’s attendance`,
        detail: `${recentAbsences} absences in the last 14 days · Guardian: ${s.parentName}`,
        studentId: s.id,
        category: 'attendance',
        priority: 'normal',
        reason: 'Rule H: Frequent absence pattern detected.',
      });
    }
  }

  const priorityRank: Record<PriorityLevel, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  nextBestActions.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);

  return {
    date,
    sessionStart: settings.sessionStart,
    sessionEnd: settings.sessionEnd,
    totalSessionMinutes,
    plannedTeacherExclusiveMinutes,
    bufferMinutes,
    isOverloaded,
    overloadMinutes,
    overloadWarning,
    blocks,
    studentPlans,
    groupSuggestions,
    nextBestActions: nextBestActions.slice(0, 8),
  };
}

export function buildCarryForwardHomeworkDrafts(params: {
  homework: HomeworkItem[];
  fromDate: string; // e.g. yesterday or today
  toDate: string;   // e.g. tomorrow
}): Omit<HomeworkItem, 'id' | 'updatedAt'>[] {
  const { homework, fromDate, toDate } = params;

  // Existing carriedFromIds to guarantee zero accidental duplicates
  const alreadyCarriedIds = new Set(
    homework.filter((h) => h.carriedFromId).map((h) => h.carriedFromId as string),
  );

  const drafts: Omit<HomeworkItem, 'id' | 'updatedAt'>[] = [];
  for (const item of homework) {
    if (item.status === 'completed' || item.status === 'verified') continue;
    if (item.dueDate > fromDate) continue;
    if (alreadyCarriedIds.has(item.id)) continue;

    // Avoid duplicating identical active title/subject/student already due on toDate
    const sameAlreadyPlanned = homework.some(
      (other) =>
        other.id !== item.id &&
        other.studentId === item.studentId &&
        other.subject === item.subject &&
        other.title === item.title &&
        other.dueDate === toDate &&
        other.status !== 'completed' &&
        other.status !== 'verified',
    );
    if (sameAlreadyPlanned) continue;

    const remainingPct = Math.max(10, 100 - item.completionPct);
    const remainingMinutes = Math.max(10, Math.round((item.estimatedMinutes * remainingPct) / 100));

    drafts.push({
      studentId: item.studentId,
      subject: item.subject,
      chapter: item.chapter,
      topic: item.topic,
      title: item.title,
      instructions: item.instructions,
      assignedDate: fromDate,
      dueDate: toDate,
      estimatedMinutes: remainingMinutes,
      priority: item.priority === 'low' ? 'normal' : 'high',
      source: item.source,
      completionPct: item.completionPct,
      status: 'carried_forward',
      completedDate: null,
      teacherVerified: false,
      needsHelp: item.needsHelp,
      remarks: item.remarks ? `Carried forward: ${item.remarks}` : `Carried forward from ${item.dueDate}`,
      carriedFromId: item.id,
      isDemo: item.isDemo,
    });
  }

  return drafts;
}
