'use client';

import {
  analyseGap,
  compareScenarios,
  formatINR,
  formatINRNumber,
  lastDateOfMonth,
  projectLoan,
  addMonths,
  type MonthKey,
  type ScenarioParams,
} from '@zerodue/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { ColumnChart } from '@/components/charts';
import { ui } from '@/components/ui';
import { typedToPaise } from '@/lib/amount';
import { formatRate, monthLabel, percentToBps } from '@/lib/format';
import { postMonth } from '@/lib/loan-state';
import { availabilityFor, baseProjection, scenarioOf } from '@/lib/loan-view';
import { useAccounts, useLoan, usePlan } from '@/lib/queries';
import {
  closeLoan,
  deleteScenario,
  recordLoanPayment,
  reopenLoan,
  saveScenario,
  setPlannedPayment,
  undoLastLoanMonth,
} from '@/lib/repo-planning';

type Tab = 'schedule' | 'projection' | 'whatif';
type LoanData = NonNullable<ReturnType<typeof useLoan>>;

const money = (value: FormDataEntryValue | string | null): number =>
  typedToPaise(String(value ?? '').replace(/[,₹\s]/g, ''));
const rupees = (paise: number): string => String(Math.round(paise / 100));

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const data = useLoan(id);
  const built = usePlan(60);
  const [tab, setTab] = useState<Tab>('schedule');

  const base = useMemo(
    () => (data ? baseProjection(data.loan, data.state, built, data.planned) : null),
    [data, built],
  );
  const projection = useMemo(() => (base ? projectLoan(base) : null), [base]);

  if (data === undefined) {
    return (
      <main className={ui.page}>
        <p className={ui.muted} role="status">
          Loading…
        </p>
      </main>
    );
  }
  if (data === null || !base || !projection) {
    return (
      <main className={ui.page}>
        <h1 className={ui.title}>Not found</h1>
        <Link href="/loans" className={ui.link}>
          Back to loans
        </Link>
      </main>
    );
  }
  const { loan, state } = data;
  const willPay =
    base.payments.defaultPaymentPaise || Object.keys(base.payments.byMonth ?? {}).length;

  return (
    <main className={ui.page}>
      <Link href="/loans" className={ui.link}>
        ‹ Loans
      </Link>
      <header>
        <h1 className={ui.title}>{loan.name}</h1>
        <p className={ui.muted}>
          {formatRate(loan.annualRateBps)} a year · {loan.kind === 'EMI' ? 'Fixed EMI' : 'Flexible'}
          {loan.status === 'CLOSED' && ' · Closed'}
        </p>
        <p className="mt-2 text-3xl font-semibold">
          {state.needsBalance ? 'Balance not entered' : formatINR(state.openingPaise)}
        </p>
        <p className={ui.muted}>
          {state.cleared || loan.status === 'CLOSED'
            ? 'Nothing left to pay.'
            : projection.payoffMonth
              ? `Clears ${monthLabel(projection.payoffMonth)} · ${formatINR(projection.totalInterestPaise)} interest still to come`
              : willPay
                ? 'Not cleared within 50 years at this pace.'
                : 'No payments planned yet, so interest keeps adding up.'}
        </p>
      </header>

      <div role="tablist" aria-label="Loan views" className="grid grid-cols-3 gap-2">
        {(
          [
            ['schedule', 'Schedule'],
            ['projection', 'Projection'],
            ['whatif', 'What-if'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`${ui.chip} ${tab === key ? ui.chipOn : ui.chipOff}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'schedule' && <ScheduleTab data={data} />}
      {tab === 'projection' && (
        <ProjectionTab
          data={data}
          base={base}
          rows={projection.rows}
          swept={built?.sweepLoan?.id === loan.id}
        />
      )}
      {tab === 'whatif' && (
        <WhatIfTab data={data} base={base} availability={availabilityFor(built, loan.id)} />
      )}
    </main>
  );
}

// ───────────────────────────── schedule ─────────────────────────────

function ScheduleTab({ data }: { data: LoanData }) {
  const { loan, state } = data;
  const accounts = useAccounts();
  const [error, setError] = useState<string | null>(null);
  const [interestText, setInterestText] = useState('');
  const [payText, setPayText] = useState('');
  const canRecord = loan.status === 'ACTIVE' && !state.cleared && !state.needsBalance;
  const interestOverride = interestText.trim() === '' ? undefined : money(interestText);
  const preview = canRecord
    ? postMonth(loan, state, {
        paymentPaise: money(payText),
        effectiveDate: '2000-01-01',
        interestPaise: interestOverride,
      })
    : null;
  const computedInterest = canRecord
    ? (postMonth(loan, state, { paymentPaise: 0, effectiveDate: '2000-01-01' })?.interestPaise ?? 0)
    : 0;

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get('account') ?? '');
    try {
      await recordLoanPayment(loan.id, {
        paymentPaise: money(form.get('payment')),
        effectiveDate: String(form.get('date')),
        interestPaise: interestOverride,
        accountId: accountId || null,
      });
      setError(null);
      setPayText('');
      setInterestText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the payment.');
    }
  }

  return (
    <>
      {state.actual.length === 0 ? (
        <p className={ui.muted}>Nothing recorded yet. Record each month’s payment below.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Recorded months</caption>
            <thead>
              <tr className="text-left">
                <th scope="col" className="py-1 font-medium">
                  Month
                </th>
                <th scope="col" className="text-right font-medium">
                  Opened
                </th>
                <th scope="col" className="text-right font-medium">
                  Interest
                </th>
                <th scope="col" className="text-right font-medium">
                  Paid
                </th>
                <th scope="col" className="text-right font-medium">
                  Closed
                </th>
              </tr>
            </thead>
            <tbody>
              {state.actual.map((m) => (
                <tr
                  key={m.month}
                  className="border-t border-slate-200 tabular-nums dark:border-slate-800"
                >
                  <td className="py-2">{monthLabel(m.month)}</td>
                  <td className="text-right">{formatINR(m.openingPaise)}</td>
                  <td className="text-right">{formatINR(m.interestPaise)}</td>
                  <td className="text-right">{formatINR(m.paymentPaise)}</td>
                  <td className="text-right">{formatINR(m.closingPaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-300 font-medium tabular-nums dark:border-slate-700">
                <td className="py-2">Total</td>
                <td />
                <td className="text-right">{formatINR(state.interestToDatePaise)}</td>
                <td className="text-right">{formatINR(state.paidToDatePaise)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {canRecord && (
        <form onSubmit={record} className={ui.card + ' flex flex-col gap-3'}>
          <h2 className="font-medium">Record {monthLabel(state.nextMonth)}</h2>
          <label className={ui.label}>
            Paid this month (₹)
            <input
              name="payment"
              inputMode="decimal"
              className={ui.input}
              value={payText}
              onChange={(e) => setPayText(e.target.value)}
            />
          </label>
          <label className={ui.label}>
            Paid on
            <input
              name="date"
              type="date"
              className={ui.input}
              defaultValue={lastDateOfMonth(state.nextMonth)}
              key={state.nextMonth}
            />
          </label>
          <label className={ui.label}>
            Interest charged (₹)
            <input
              name="interest"
              inputMode="decimal"
              className={ui.input}
              placeholder={formatINRNumber(computedInterest)}
              value={interestText}
              onChange={(e) => setInterestText(e.target.value)}
            />
            <span className={ui.muted}>
              Worked out as {formatINR(computedInterest)}. Change it if your lender charged
              differently.
            </span>
          </label>
          <label className={ui.label}>
            Also record as an expense from
            <select name="account" className={ui.input} defaultValue="">
              <option value="">Don’t record an expense</option>
              {accounts
                ?.filter((a) => !a.archived)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          {preview && (
            <p className={ui.muted} aria-live="polite">
              Balance after: <strong>{formatINR(preview.closingPaise)}</strong>
            </p>
          )}
          {error && (
            <p role="alert" className={ui.error}>
              {error}
            </p>
          )}
          <button type="submit" className={ui.primary}>
            Record payment
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {state.actual.length > 0 && (
          <button className={ui.secondary} onClick={() => undoLastLoanMonth(loan.id)}>
            Undo last month
          </button>
        )}
        {loan.status === 'ACTIVE' ? (
          <button className={ui.secondary} onClick={() => closeLoan(loan.id)}>
            Close loan
          </button>
        ) : (
          <button className={ui.secondary} onClick={() => reopenLoan(loan.id)}>
            Reopen loan
          </button>
        )}
      </div>
    </>
  );
}

// ───────────────────────────── projection ─────────────────────────────

function ProjectionTab({
  data,
  base,
  rows,
  swept,
}: {
  data: LoanData;
  base: ReturnType<typeof baseProjection>;
  rows: ReturnType<typeof projectLoan>['rows'];
  swept: boolean;
}) {
  const manual = new Map(data.planned.map((p) => [p.month, p]));
  if (data.loan.status !== 'ACTIVE' || data.state.cleared) {
    return <p className={ui.muted}>This loan is finished, so there is nothing to project.</p>;
  }
  return (
    <>
      <p className={ui.muted}>
        {swept
          ? 'This is the loan your spare money goes to, so each month pays everything the plan has free. Type a figure to pay a different amount in a month.'
          : 'Payments follow the fixed instalment. Type a figure to pay a different amount in a month.'}{' '}
        Starting {monthLabel(base.firstMonth)}.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Projected months</caption>
          <thead>
            <tr className="text-left">
              <th scope="col" className="py-1 font-medium">
                Month
              </th>
              <th scope="col" className="text-right font-medium">
                Interest
              </th>
              <th scope="col" className="text-right font-medium">
                Pay (₹)
              </th>
              <th scope="col" className="text-right font-medium">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const override = manual.get(row.month);
              return (
                <tr
                  key={row.month}
                  className="border-t border-slate-200 tabular-nums dark:border-slate-800"
                >
                  <td className="py-2">{monthLabel(row.month)}</td>
                  <td className="text-right">{formatINR(row.interestPaise)}</td>
                  <td className="text-right">
                    <input
                      aria-label={`Payment for ${monthLabel(row.month)}`}
                      inputMode="decimal"
                      defaultValue={rupees(row.paymentPaise)}
                      key={`${row.month}-${row.paymentPaise}-${override?.version ?? 0}`}
                      onBlur={(e) => {
                        const paise = money(e.target.value);
                        if (paise !== row.paymentPaise)
                          void setPlannedPayment(data.loan.id, row.month, paise);
                      }}
                      className={`min-h-11 w-28 rounded-lg border bg-transparent px-2 text-right ${
                        override ? 'border-teal-700' : 'border-slate-300 dark:border-slate-700'
                      }`}
                    />
                  </td>
                  <td className="text-right">{formatINR(row.closingPaise)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {manual.size > 0 && (
        <button
          className={ui.secondary}
          onClick={() =>
            manual.forEach((_, month) => void setPlannedPayment(data.loan.id, month, null))
          }
        >
          Clear my payment changes
        </button>
      )}
    </>
  );
}

// ───────────────────────────── what-if ─────────────────────────────

const EMPTY: ScenarioParams = {
  extraPayments: [],
  monthlyPaymentPaise: null,
  annualRateBps: null,
  targetMonth: null,
};

function WhatIfTab({
  data,
  base,
  availability,
}: {
  data: LoanData;
  base: ReturnType<typeof baseProjection>;
  availability: Record<MonthKey, number> | null;
}) {
  const [params, setParams] = useState<ScenarioParams>(EMPTY);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const months = Array.from({ length: 36 }, (_, i) => addMonths(base.firstMonth, i));

  const result = useMemo(
    () => compareScenarios(base, [scenarioOf(params, 'This what-if')]),
    [base, params],
  );
  const scenario = result.scenarios[0]!;
  const gap = useMemo(
    () =>
      params.targetMonth && availability
        ? analyseGap(base, params.targetMonth, availability)
        : null,
    [base, params.targetMonth, availability],
  );
  const saved = data.scenarios;
  const comparison = useMemo(() => {
    const chosen = saved.filter((s) => picked.includes(s.id)).slice(0, 3);
    return compareScenarios(
      base,
      chosen.map((s) => scenarioOf(s.params, s.name)),
    );
  }, [base, saved, picked]);

  if (data.loan.status !== 'ACTIVE' || data.state.cleared) {
    return <p className={ui.muted}>This loan is finished, so there is nothing to try.</p>;
  }

  function addExtra(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = money(form.get('extra'));
    if (amount < 1) return;
    setParams({
      ...params,
      extraPayments: [
        ...params.extraPayments,
        { month: String(form.get('month')), amountPaise: amount },
      ],
    });
    event.currentTarget.reset();
  }

  return (
    <>
      <section aria-label="Try a change" className={ui.card + ' flex flex-col gap-3'}>
        <h2 className="font-medium">Try a change</h2>
        <label className={ui.label}>
          Pay this much every month (₹)
          <input
            inputMode="decimal"
            className={ui.input}
            placeholder="Leave empty to keep the current plan"
            value={params.monthlyPaymentPaise == null ? '' : rupees(params.monthlyPaymentPaise)}
            onChange={(e) =>
              setParams({
                ...params,
                monthlyPaymentPaise: e.target.value.trim() ? money(e.target.value) : null,
              })
            }
          />
        </label>
        <label className={ui.label}>
          Interest rate (% a year)
          <input
            inputMode="decimal"
            className={ui.input}
            placeholder={formatRate(base.annualRateBps)}
            onChange={(e) =>
              setParams({
                ...params,
                annualRateBps: e.target.value.trim() ? percentToBps(e.target.value) : null,
              })
            }
          />
        </label>
        <label className={ui.label}>
          I want it cleared by
          <select
            className={ui.input}
            value={params.targetMonth ?? ''}
            onChange={(e) => setParams({ ...params, targetMonth: e.target.value || null })}
          >
            <option value="">No target</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <form onSubmit={addExtra} className="flex flex-col gap-2">
          <span className="text-sm">Extra payment or lump sum</span>
          <div className="flex gap-2">
            <select name="month" aria-label="Month" className={ui.input}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            <input
              name="extra"
              aria-label="Extra amount"
              inputMode="decimal"
              className={ui.input}
              placeholder="₹"
            />
          </div>
          <button type="submit" className={ui.secondary}>
            Add extra payment
          </button>
        </form>
        {params.extraPayments.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {params.extraPayments.map((extra, index) => (
              <li key={`${extra.month}-${index}`} className="flex items-center justify-between">
                <span>
                  {monthLabel(extra.month)}: {formatINR(extra.amountPaise)}
                </span>
                <button
                  className="min-h-11 px-3 underline"
                  onClick={() =>
                    setParams({
                      ...params,
                      extraPayments: params.extraPayments.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Result" className={ui.card + ' flex flex-col gap-2'} aria-live="polite">
        <h2 className="font-medium">Result</h2>
        <p>
          Cleared{' '}
          <strong>
            {scenario.payoffMonth ? monthLabel(scenario.payoffMonth) : 'not within 50 years'}
          </strong>{' '}
          · interest {formatINR(scenario.totalInterestPaise)}
        </p>
        <p className={ui.muted}>
          Current plan:{' '}
          {result.base.payoffMonth ? monthLabel(result.base.payoffMonth) : 'not cleared'} ·{' '}
          {formatINR(result.base.totalInterestPaise)} interest.
          {scenario.interestSavedPaise > 0 &&
            ` This saves ${formatINR(scenario.interestSavedPaise)}`}
          {scenario.interestSavedPaise < 0 &&
            ` This costs ${formatINR(-scenario.interestSavedPaise)} more`}
          {scenario.monthsSaved !== 0 &&
            ` and ${Math.abs(scenario.monthsSaved)} month${Math.abs(scenario.monthsSaved) === 1 ? '' : 's'} ${scenario.monthsSaved > 0 ? 'sooner' : 'later'}`}
          {(scenario.interestSavedPaise !== 0 || scenario.monthsSaved !== 0) && '.'}
        </p>
        {scenario.requiredMonthlyPaise !== undefined && (
          <p>
            To clear by {monthLabel(params.targetMonth!)} you need about{' '}
            <strong>{formatINR(scenario.requiredMonthlyPaise)}</strong> a month.
          </p>
        )}
      </section>

      {gap && (
        <section aria-label="Gap" className={ui.card}>
          <ColumnChart
            title={`Money free each month vs ${formatINR(gap.requiredMonthlyPaise)} needed`}
            categories={gap.rows.map((r) => monthLabel(r.month).slice(0, 3))}
            series={[
              { name: 'Available', slot: 1, values: gap.rows.map((r) => r.availablePaise) },
              { name: 'Needed', slot: 2, values: gap.rows.map((r) => r.neededPaise) },
            ]}
          />
          <p className="mt-2 text-sm">
            {gap.totalGapPaise > 0
              ? `Short by ${formatINR(gap.totalGapPaise)} across ${gap.rows.filter((r) => r.gapPaise > 0).length} month(s).`
              : 'Every month has enough free.'}
          </p>
        </section>
      )}
      {params.targetMonth && !availability && (
        <p className={ui.muted}>
          The monthly check needs this to be the loan your spare money goes to.
        </p>
      )}

      <section aria-label="Saved what-ifs" className={ui.card + ' flex flex-col gap-3'}>
        <h2 className="font-medium">Saved what-ifs</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void saveScenario(data.loan.id, name.trim(), params);
            setName('');
          }}
        >
          <input
            aria-label="Name"
            className={ui.input}
            placeholder="Name this what-if"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className={ui.secondary}>
            Save
          </button>
        </form>
        {saved.length === 0 && <p className={ui.muted}>Save a what-if to compare it later.</p>}
        <ul className="flex flex-col gap-1">
          {saved.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <label className="flex min-h-11 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.includes(s.id)}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked
                        ? [...picked, s.id].slice(-3)
                        : picked.filter((p) => p !== s.id),
                    )
                  }
                />
                {s.name}
              </label>
              <button className="min-h-11 px-3 underline" onClick={() => setParams(s.params)}>
                Load
              </button>
              <button className="min-h-11 px-3 underline" onClick={() => deleteScenario(s.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        {picked.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Comparison</caption>
              <thead>
                <tr className="text-left">
                  <th scope="col" className="py-1 font-medium">
                    Plan
                  </th>
                  <th scope="col" className="text-right font-medium">
                    Cleared
                  </th>
                  <th scope="col" className="text-right font-medium">
                    Interest
                  </th>
                  <th scope="col" className="text-right font-medium">
                    Saves
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-slate-200 dark:border-slate-800">
                  <td className="py-2">Current plan</td>
                  <td className="text-right">
                    {comparison.base.payoffMonth ? monthLabel(comparison.base.payoffMonth) : '—'}
                  </td>
                  <td className="text-right">{formatINR(comparison.base.totalInterestPaise)}</td>
                  <td />
                </tr>
                {comparison.scenarios.map((s) => (
                  <tr key={s.name} className="border-t border-slate-200 dark:border-slate-800">
                    <td className="py-2">{s.name}</td>
                    <td className="text-right">
                      {s.payoffMonth ? monthLabel(s.payoffMonth) : '—'}
                    </td>
                    <td className="text-right">{formatINR(s.totalInterestPaise)}</td>
                    <td className="text-right">{formatINR(s.interestSavedPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
