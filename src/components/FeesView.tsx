import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  IndianRupee,
  Percent,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type {
  BoardType,
  ClassLevel,
  DiscountKind,
  DiscountScope,
  FeeInvoice,
  FeePayment,
  PaymentMethod,
  WorkspaceSnapshot,
} from '../types';
import { evaluateFeeReminders } from '../engines/feeEngine';
import { formatRupeesFromPaise, getMonthLabel } from '../engines/istDate';
import { buildWhatsAppShareUrl, downloadCsv } from '../lib/api';

interface FeesViewProps {
  workspace: WorkspaceSnapshot;
  initialPaymentStudentId: string | null;
  onClearInitialPaymentStudent: () => void;
  onGenerateMonth: (monthKey: string) => Promise<number>;
  onRecordPayment: (payload: {
    studentId: string;
    invoiceId?: string | null;
    amountPaise: number;
    method: PaymentMethod;
    transactionRef: string;
    notes: string;
    idempotencyKey: string;
  }) => Promise<{ receiptNumber?: string }>;
  onWaiveInvoice: (invoiceId: string, waived: boolean) => Promise<void>;
  onCreateDiscount: (payload: Record<string, unknown>) => Promise<void>;
  onDeleteDiscount: (id: string) => Promise<void>;
}

type FeesSubTab = 'collection' | 'reminders' | 'discounts' | 'history';

export const FeesView: React.FC<FeesViewProps> = ({
  workspace,
  initialPaymentStudentId,
  onClearInitialPaymentStudent,
  onGenerateMonth,
  onRecordPayment,
  onWaiveInvoice,
  onCreateDiscount,
  onDeleteDiscount,
}) => {
  const [tab, setTab] = useState<FeesSubTab>('collection');
  const [selectedMonth, setSelectedMonth] = useState(workspace.currentMonthIst);
  const [statusFilter, setStatusFilter] = useState<'all' | FeeInvoice['status']>('all');
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Payment modal state
  const [paymentModalStudentId, setPaymentModalStudentId] = useState<string | null>(initialPaymentStudentId);
  const [paymentModalInvoiceId, setPaymentModalInvoiceId] = useState<string | null>(null);
  const [receiptPayment, setReceiptPayment] = useState<FeePayment | null>(null);

  // Discount modal state
  const [showDiscountModal, setShowDiscountModal] = useState(false);

  const studentMap = useMemo(
    () => new Map(workspace.students.map((s) => [s.id, s])),
    [workspace.students],
  );

  const availableMonths = useMemo(() => {
    const set = new Set<string>([workspace.currentMonthIst]);
    for (const inv of workspace.invoices) set.add(inv.monthKey);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [workspace.invoices, workspace.currentMonthIst]);

  const monthInvoices = useMemo(() => {
    return workspace.invoices.filter((inv) => {
      if (inv.monthKey !== selectedMonth) return false;
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      return true;
    });
  }, [workspace.invoices, selectedMonth, statusFilter]);

  const summary = useMemo(() => {
    const list = workspace.invoices.filter((i) => i.monthKey === selectedMonth && i.status !== 'waived');
    const expected = list.reduce((s, i) => s + i.totalAmountPaise, 0);
    const collected = list.reduce((s, i) => s + i.paidAmountPaise, 0);
    const outstanding = Math.max(0, expected - collected);
    const overdue = list
      .filter((i) => i.status === 'overdue')
      .reduce((s, i) => s + Math.max(0, i.totalAmountPaise - i.paidAmountPaise), 0);
    const pct = expected > 0 ? Math.round((collected / expected) * 100) : 100;
    return { expected, collected, outstanding, overdue, pct };
  }, [workspace.invoices, selectedMonth]);

  const feeReminders = useMemo(
    () =>
      evaluateFeeReminders({
        students: workspace.students,
        invoices: workspace.invoices,
        todayDate: workspace.todayIst,
        reminderSettings: workspace.settings.reminders,
        tuitionName: workspace.settings.tuitionName,
      }),
    [workspace],
  );

  const handleExportCsv = () => {
    downloadCsv(
      `tuitio-fees-${selectedMonth}.csv`,
      ['Month', 'Student', 'Class', 'Board', 'Total (INR)', 'Paid (INR)', 'Balance (INR)', 'Due Date', 'Status'],
      monthInvoices.map((inv) => {
        const stu = studentMap.get(inv.studentId);
        return [
          inv.monthKey,
          stu?.fullName ?? inv.studentId,
          `Class ${inv.classLevelSnapshot}`,
          inv.boardSnapshot,
          (inv.totalAmountPaise / 100).toFixed(2),
          (inv.paidAmountPaise / 100).toFixed(2),
          (Math.max(0, inv.totalAmountPaise - inv.paidAmountPaise) / 100).toFixed(2),
          inv.dueDate,
          inv.status,
        ];
      }),
    );
  };

  const copyMessage = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 dark:text-white">Fees & Payments</h1>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
            Exact paise accounting · Auto monthly billing · Partial & advance payments · Printable receipts
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              const created = await onGenerateMonth(selectedMonth);
              setGenMessage(
                created > 0
                  ? `Generated ${created} monthly invoice${created === 1 ? '' : 's'} for ${getMonthLabel(selectedMonth)}.`
                  : `All active students already have invoices for ${getMonthLabel(selectedMonth)} (zero duplicates).`,
              );
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold border border-sky-200 dark:border-white/20 bg-white/80 dark:bg-neutral-950 text-slate-800 dark:text-white whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Generate {getMonthLabel(selectedMonth)} Bills</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPaymentModalInvoiceId(null);
              setPaymentModalStudentId(workspace.students.find((s) => s.status === 'active')?.id ?? null);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black whitespace-nowrap"
          >
            <IndianRupee className="w-4 h-4" />
            <span>Record Payment</span>
          </button>
        </div>
      </div>

      {genMessage && (
        <div className="liquid-glass rounded-2xl px-4 py-3 flex items-center justify-between text-xs text-slate-800 dark:text-white">
          <span>{genMessage}</span>
          <button type="button" onClick={() => setGenMessage(null)} aria-label="Dismiss message">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Monthly Financial KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="liquid-glass rounded-2xl p-4 sm:p-5">
          <p className="text-xs text-slate-500 dark:text-neutral-400">Expected ({getMonthLabel(selectedMonth)})</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-slate-950 dark:text-white mt-1">
            {formatRupeesFromPaise(summary.expected)}
          </p>
        </div>
        <div className="liquid-glass rounded-2xl p-4 sm:p-5">
          <p className="text-xs text-slate-500 dark:text-neutral-400">Collected ({summary.pct}%)</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-emerald-700 dark:text-white mt-1">
            {formatRupeesFromPaise(summary.collected)}
          </p>
        </div>
        <div className="liquid-glass rounded-2xl p-4 sm:p-5">
          <p className="text-xs text-slate-500 dark:text-neutral-400">Remaining Receivables</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-slate-950 dark:text-white mt-1">
            {formatRupeesFromPaise(summary.outstanding)}
          </p>
        </div>
        <div className="liquid-glass rounded-2xl p-4 sm:p-5">
          <p className="text-xs text-slate-500 dark:text-neutral-400">Overdue Balance</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-rose-700 dark:text-white mt-1">
            {formatRupeesFromPaise(summary.overdue)}
          </p>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center p-1 rounded-xl liquid-glass gap-1 overflow-x-auto">
          {(
            [
              ['collection', 'Monthly Bills'],
              ['reminders', `Who Needs to Pay (${feeReminders.length})`],
              ['discounts', `Discounts (${workspace.discounts.length})`],
              ['history', `Receipts (${workspace.payments.length})`],
            ] as [FeesSubTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                tab === id
                  ? 'bg-sky-600 text-white dark:bg-white dark:text-black'
                  : 'text-slate-600 dark:text-neutral-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'collection' && (
          <div className="flex items-center gap-2">
            <select
              aria-label="Billing month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 rounded-xl liquid-glass text-xs font-mono text-slate-900 dark:text-white"
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>{getMonthLabel(m)}</option>
              ))}
            </select>
            <select
              aria-label="Filter invoice status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="px-3 py-2 rounded-xl liquid-glass text-xs text-slate-900 dark:text-white"
            >
              <option value="all">All Statuses</option>
              <option value="overdue">Overdue</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="waived">Waived</option>
            </select>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl liquid-glass text-xs font-medium text-slate-700 dark:text-neutral-200 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        )}
      </div>

      {/* TAB 1: MONTHLY BILLS */}
      {tab === 'collection' && (
        <div className="liquid-glass rounded-3xl p-4 sm:p-6 overflow-x-auto">
          {monthInvoices.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm text-slate-600 dark:text-neutral-400">
                No invoices found for {getMonthLabel(selectedMonth)}.
              </p>
              <button
                type="button"
                onClick={() => onGenerateMonth(selectedMonth)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
              >
                Generate Invoices Now
              </button>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-sky-100 dark:border-white/15 text-xs text-slate-500 dark:text-neutral-400">
                  <th className="py-2.5 pr-4 font-medium">Student</th>
                  <th className="py-2.5 px-3 font-medium">Due Date</th>
                  <th className="py-2.5 px-3 text-right font-medium">Bill Amount</th>
                  <th className="py-2.5 px-3 text-right font-medium">Paid</th>
                  <th className="py-2.5 px-3 text-right font-medium">Balance</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-100/70 dark:divide-white/10">
                {monthInvoices.map((inv) => {
                  const stu = studentMap.get(inv.studentId);
                  const balance = Math.max(0, inv.totalAmountPaise - inv.paidAmountPaise);
                  return (
                    <tr key={inv.id} className="hover:bg-sky-50/50 dark:hover:bg-white/5">
                      <td className="py-3 pr-4">
                        <p className="font-semibold text-slate-900 dark:text-white">{stu?.fullName ?? 'Student'}</p>
                        <p className="text-xs text-slate-500 dark:text-neutral-400">
                          Class {inv.classLevelSnapshot} · {inv.boardSnapshot}
                          {inv.discountSummary ? ` · ${inv.discountSummary}` : ''}
                        </p>
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-xs text-slate-600 dark:text-neutral-400 whitespace-nowrap">
                        {inv.dueDate}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs font-medium text-slate-900 dark:text-white">
                        {formatRupeesFromPaise(inv.totalAmountPaise)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-emerald-700 dark:text-neutral-300">
                        {formatRupeesFromPaise(inv.paidAmountPaise)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs font-semibold text-slate-950 dark:text-white">
                        {formatRupeesFromPaise(balance)}
                      </td>
                      <td className="py-3 px-3 text-xs capitalize whitespace-nowrap">
                        <span
                          className={
                            inv.status === 'paid'
                              ? 'text-emerald-700 dark:text-white font-semibold'
                              : inv.status === 'overdue'
                                ? 'text-rose-700 dark:text-white font-semibold'
                                : 'text-slate-600 dark:text-neutral-400'
                          }
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {balance > 0 && inv.status !== 'waived' && (
                            <button
                              type="button"
                              onClick={() => {
                                setPaymentModalInvoiceId(inv.id);
                                setPaymentModalStudentId(inv.studentId);
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
                            >
                              Collect
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onWaiveInvoice(inv.id, inv.status !== 'waived')}
                            className="text-xs text-slate-500 hover:text-slate-900 dark:text-neutral-400 dark:hover:text-white"
                          >
                            {inv.status === 'waived' ? 'Unwaive' : 'Waive'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* TAB 2: WHO NEEDS TO PAY REMINDERS */}
      {tab === 'reminders' && (
        <div className="space-y-3">
          {feeReminders.length === 0 ? (
            <div className="liquid-glass rounded-3xl p-8 text-center text-sm text-slate-600 dark:text-neutral-400">
              No overdue or upcoming fee reminders today. All parents are up to date.
            </div>
          ) : (
            feeReminders.map((rem) => (
              <div key={rem.dedupKey} className="liquid-glass rounded-3xl p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-950 dark:text-white">
                      {rem.studentName} · <span className="font-mono">{formatRupeesFromPaise(rem.balancePaise)}</span>
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-neutral-400">
                      {rem.reason} · Guardian: {rem.parentName} ({rem.parentPhone}) · Due {rem.dueDate}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyMessage(rem.dedupKey, rem.suggestedMessage)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-sky-200 dark:border-white/20 text-slate-800 dark:text-white"
                    >
                      {copiedId === rem.dedupKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedId === rem.dedupKey ? 'Copied' : 'Copy Message'}</span>
                    </button>
                    <a
                      href={buildWhatsAppShareUrl(rem.parentPhone, rem.suggestedMessage)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-sky-200 dark:border-white/20 text-slate-800 dark:text-white hover:bg-sky-50 dark:hover:bg-white/10"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open in WhatsApp</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentModalInvoiceId(rem.invoiceId);
                        setPaymentModalStudentId(rem.studentId);
                      }}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
                    >
                      Record Paid
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-600 dark:text-neutral-400 bg-sky-50/70 dark:bg-neutral-900 rounded-xl p-3">
                  “{rem.suggestedMessage}”
                </p>
              </div>
            ))
          )}
          <p className="text-[11px] text-slate-500 dark:text-neutral-500">
            Note: WhatsApp sharing opens your device’s WhatsApp app with a prefilled polite message for manual one-tap sending (free, requires no paid WhatsApp Business API).
          </p>
        </div>
      )}

      {/* TAB 3: DISCOUNTS */}
      {tab === 'discounts' && (
        <div className="liquid-glass rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-950 dark:text-white">Active Discount Rules</h2>
              <p className="text-xs text-slate-500 dark:text-neutral-400">
                Supports fixed-rupee or percentage discounts across individual students, classes, boards, or globally — with optional expiry dates
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDiscountModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Discount</span>
            </button>
          </div>

          <div className="divide-y divide-sky-100/80 dark:divide-white/10">
            {workspace.discounts.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-neutral-400 py-4">No discount rules configured.</p>
            ) : (
              workspace.discounts.map((d) => (
                <div key={d.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <Percent className="w-3.5 h-3.5 text-sky-600 dark:text-white" />
                      {d.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-neutral-400">
                      {d.kind === 'percentage' ? `${d.value}% off` : `${formatRupeesFromPaise(d.value)} off`} · Scope: {d.scope}
                      {d.studentId ? ` (${studentMap.get(d.studentId)?.fullName ?? ''})` : ''}
                      {d.classLevel ? ` (Class ${d.classLevel})` : ''}
                      {d.board ? ` (${d.board})` : ''}
                      {d.endDate ? ` · Valid until ${d.endDate}` : ' · Permanent'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteDiscount(d.id)}
                    aria-label={`Delete discount ${d.name}`}
                    className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-white"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: RECEIPTS & TRANSACTION HISTORY */}
      {tab === 'history' && (
        <div className="liquid-glass rounded-3xl p-5 sm:p-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-sky-100 dark:border-white/15 text-xs text-slate-500 dark:text-neutral-400">
                <th className="py-2 pr-4 font-medium">Receipt #</th>
                <th className="py-2 px-3 font-medium">Student</th>
                <th className="py-2 px-3 font-medium">Date & Method</th>
                <th className="py-2 px-3 text-right font-medium">Amount</th>
                <th className="py-2 pl-3 text-right font-medium">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-100/70 dark:divide-white/10">
              {workspace.payments.map((p) => {
                const stu = studentMap.get(p.studentId);
                return (
                  <tr key={p.id}>
                    <td className="py-3 pr-4 font-mono text-xs font-semibold text-slate-900 dark:text-white">{p.receiptNumber}</td>
                    <td className="py-3 px-3 text-xs font-medium text-slate-800 dark:text-neutral-200">{stu?.fullName ?? 'Student'}</td>
                    <td className="py-3 px-3 text-xs text-slate-500 dark:text-neutral-400 font-mono">
                      {p.paymentDate} · {p.method.toUpperCase()} {p.transactionRef ? `· ${p.transactionRef}` : ''}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-xs font-bold text-slate-950 dark:text-white">
                      {formatRupeesFromPaise(p.amountPaise)}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => setReceiptPayment(p)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 dark:text-white hover:underline"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        <span>View / Print</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* RECORD PAYMENT MODAL */}
      {paymentModalStudentId && (
        <RecordPaymentModal
          workspace={workspace}
          studentId={paymentModalStudentId}
          invoiceId={paymentModalInvoiceId}
          onClose={() => {
            setPaymentModalStudentId(null);
            setPaymentModalInvoiceId(null);
            onClearInitialPaymentStudent();
          }}
          onSubmit={async (payload) => {
            const res = await onRecordPayment(payload);
            setPaymentModalStudentId(null);
            setPaymentModalInvoiceId(null);
            onClearInitialPaymentStudent();
            if (res.receiptNumber) {
              setGenMessage(`Payment recorded successfully — Receipt ${res.receiptNumber} ready in Receipts tab.`);
            }
          }}
        />
      )}

      {/* ADD DISCOUNT MODAL */}
      {showDiscountModal && (
        <AddDiscountModal
          workspace={workspace}
          onClose={() => setShowDiscountModal(false)}
          onSubmit={async (payload) => {
            await onCreateDiscount(payload);
            setShowDiscountModal(false);
          }}
        />
      )}

      {/* PRINTABLE RECEIPT MODAL */}
      {receiptPayment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 dark:bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Fee Payment Receipt"
        >
          <div className="bg-white dark:bg-neutral-950 border border-sky-200 dark:border-white/20 w-full max-w-md rounded-3xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 dark:border-white/15 pb-4">
              <div>
                <p className="font-display font-bold text-lg text-slate-950 dark:text-white">
                  {workspace.settings.tuitionName}
                </p>
                <p className="text-xs text-slate-500 dark:text-neutral-400">
                  {workspace.settings.teacherName} · {workspace.settings.contactPhone}
                </p>
              </div>
              <span className="font-mono text-xs font-bold text-sky-700 dark:text-white">
                {receiptPayment.receiptNumber}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-neutral-400">Student</span>
                <span className="font-semibold text-slate-950 dark:text-white">
                  {studentMap.get(receiptPayment.studentId)?.fullName ?? 'Student'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-neutral-400">Class & Board</span>
                <span className="text-slate-800 dark:text-neutral-200">
                  Class {studentMap.get(receiptPayment.studentId)?.classLevel} · {studentMap.get(receiptPayment.studentId)?.board}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-neutral-400">Payment Date</span>
                <span className="font-mono text-slate-800 dark:text-neutral-200">{receiptPayment.paymentDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-neutral-400">Method & Reference</span>
                <span className="font-mono text-slate-800 dark:text-neutral-200 uppercase">
                  {receiptPayment.method} {receiptPayment.transactionRef ? `(${receiptPayment.transactionRef})` : ''}
                </span>
              </div>
              <div className="flex justify-between pt-3 mt-2 border-t border-slate-200 dark:border-white/15 text-base font-bold">
                <span className="text-slate-900 dark:text-white">Amount Received</span>
                <span className="font-mono tabular-nums text-slate-950 dark:text-white">
                  {formatRupeesFromPaise(receiptPayment.amountPaise)}
                </span>
              </div>
              {receiptPayment.notes && (
                <p className="text-xs text-slate-500 dark:text-neutral-400 pt-1">Note: {receiptPayment.notes}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 no-print">
              <button
                type="button"
                onClick={() => setReceiptPayment(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-white/20"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print / Save PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const RecordPaymentModal: React.FC<{
  workspace: WorkspaceSnapshot;
  studentId: string;
  invoiceId: string | null;
  onClose: () => void;
  onSubmit: (payload: {
    studentId: string;
    invoiceId?: string | null;
    amountPaise: number;
    method: PaymentMethod;
    transactionRef: string;
    notes: string;
    idempotencyKey: string;
  }) => Promise<void>;
}> = ({ workspace, studentId: initSid, invoiceId, onClose, onSubmit }) => {
  const [sid, setSid] = useState(initSid);
  const unpaidForStudent = useMemo(
    () =>
      workspace.invoices.filter(
        (i) => i.studentId === sid && i.status !== 'paid' && i.status !== 'waived' && i.totalAmountPaise > i.paidAmountPaise,
      ),
    [workspace.invoices, sid],
  );
  const targetInv = unpaidForStudent.find((i) => i.id === invoiceId) ?? unpaidForStudent[0];
  const suggestedRupees = targetInv ? (targetInv.totalAmountPaise - targetInv.paidAmountPaise) / 100 : 700;

  const [rupees, setRupees] = useState(String(suggestedRupees));
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [txRef, setTxRef] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [idempotencyKey] = useState(() => `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(rupees);
    if (!Number.isFinite(num) || num <= 0) return;
    setSaving(true);
    try {
      await onSubmit({
        studentId: sid,
        invoiceId: targetInv?.id ?? null,
        amountPaise: Math.round(num * 100),
        method,
        transactionRef: txRef.trim(),
        notes: notes.trim(),
        idempotencyKey,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 dark:bg-black/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record Fee Payment"
    >
      <form onSubmit={handleSubmit} className="liquid-glass-strong w-full max-w-md rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-950 dark:text-white">Record Fee Payment</h2>
          <button type="button" onClick={onClose} aria-label="Close payment modal"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Student</label>
            <select
              value={sid}
              onChange={(e) => setSid(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            >
              {workspace.students.map((s) => (
                <option key={s.id} value={s.id}>{s.fullName} (Class {s.classLevel} {s.board})</option>
              ))}
            </select>
          </div>

          {targetInv && (
            <p className="text-xs text-slate-600 dark:text-neutral-400">
              Applying to {getMonthLabel(targetInv.monthKey)} bill (balance {formatRupeesFromPaise(targetInv.totalAmountPaise - targetInv.paidAmountPaise)}). Any extra amount is saved as advance credit.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pay-amount" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
                Amount (₹) *
              </label>
              <input
                id="pay-amount"
                type="number"
                min={1}
                step="1"
                required
                value={rupees}
                onChange={(e) => setRupees(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
              >
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Transaction Reference (optional)
            </label>
            <input
              value={txRef}
              onChange={(e) => setTxRef(e.target.value)}
              placeholder="e.g. UPI-6319201188"
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Notes</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Partial payment / Paid by guardian"
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs border border-sky-200 dark:border-white/20">Cancel</button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black"
          >
            {saving ? 'Recording...' : 'Save & Generate Receipt'}
          </button>
        </div>
      </form>
    </div>
  );
};

const AddDiscountModal: React.FC<{
  workspace: WorkspaceSnapshot;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}> = ({ workspace, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DiscountKind>('fixed');
  const [val, setVal] = useState('100');
  const [scope, setScope] = useState<DiscountScope>('student');
  const [studentId, setStudentId] = useState(workspace.students[0]?.id ?? '');
  const [classLevel, setClassLevel] = useState<ClassLevel>(7);
  const [board, setBoard] = useState<BoardType>('CBSE');
  const [endDate, setEndDate] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(val);
    if (!name.trim() || !Number.isFinite(num) || num <= 0) return;
    await onSubmit({
      name: name.trim(),
      kind,
      value: kind === 'fixed' ? Math.round(num * 100) : Math.min(100, Math.round(num)),
      scope,
      studentId: scope === 'student' ? studentId : undefined,
      classLevel: scope === 'class' ? classLevel : undefined,
      board: scope === 'board' ? board : undefined,
      endDate: endDate || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 dark:bg-black/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add Fee Discount"
    >
      <form onSubmit={handleSubmit} className="liquid-glass-strong w-full max-w-md rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-950 dark:text-white">Create Discount Rule</h2>
          <button type="button" onClick={onClose} aria-label="Close discount modal"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Discount Name *</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sibling Discount / Merit Award"
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Type</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as DiscountKind)}
                className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
              >
                <option value="fixed">Fixed (₹)</option>
                <option value="percentage">Percentage (%)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
                {kind === 'fixed' ? 'Amount (₹)' : 'Percent (%)'}
              </label>
              <input
                type="number"
                min={1}
                max={kind === 'percentage' ? 100 : 10000}
                value={val}
                onChange={(e) => setVal(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">Applies To</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as DiscountScope)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            >
              <option value="student">Specific Student</option>
              <option value="class">Specific Class</option>
              <option value="board">Specific Board</option>
              <option value="global">All Students</option>
            </select>
          </div>
          {scope === 'student' && (
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            >
              {workspace.students.map((s) => (
                <option key={s.id} value={s.id}>{s.fullName}</option>
              ))}
            </select>
          )}
          {scope === 'class' && (
            <select
              value={classLevel}
              onChange={(e) => setClassLevel(Number(e.target.value) as ClassLevel)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            >
              {[3, 4, 5, 6, 7, 8, 9, 10].map((c) => (
                <option key={c} value={c}>Class {c}</option>
              ))}
            </select>
          )}
          {scope === 'board' && (
            <select
              value={board}
              onChange={(e) => setBoard(e.target.value as BoardType)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm text-slate-900 dark:text-white"
            >
              <option value="SSC">SSC</option>
              <option value="CBSE">CBSE</option>
              <option value="ICSE">ICSE</option>
            </select>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1">
              Expiry Date (leave blank for permanent)
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white/80 dark:bg-black border border-sky-200 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs border border-sky-200 dark:border-white/20">Cancel</button>
          <button type="submit" className="px-5 py-2 rounded-xl text-xs font-semibold bg-sky-600 dark:bg-white text-white dark:text-black">Save Discount</button>
        </div>
      </form>
    </div>
  );
};
