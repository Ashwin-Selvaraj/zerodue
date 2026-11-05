'use client';

import { formatDate, formatINR, goalProgress, isoDateIST, type AccountDto } from '@zerodue/shared';
import { useState, type FormEvent } from 'react';
import { ui } from '@/components/ui';
import { typedToPaise } from '@/lib/amount';
import { useAccounts, useGoals, useReceivables } from '@/lib/queries';
import {
  addContribution,
  addGoal,
  addReceivable,
  cancelReceivable,
  deleteGoal,
  receiveContribution,
  receiveReceivable,
  undoReceive,
} from '@/lib/repo-planning';

const money = (value: FormDataEntryValue | null): number =>
  typedToPaise(String(value ?? '').replace(/[,₹\s]/g, ''));

function defaultAccount(accounts: AccountDto[] | undefined): string {
  const open = (accounts ?? []).filter((a) => !a.archived && a.type !== 'CREDIT_CARD');
  return (open.find((a) => a.type === 'BANK') ?? open[0])?.id ?? '';
}

export default function GoalsPage() {
  const accounts = useAccounts();
  const goals = useGoals();
  const receivables = useReceivables();
  const today = isoDateIST(new Date());
  const [accountId, setAccountId] = useState('');
  const account = accountId || defaultAccount(accounts);
  const [error, setError] = useState<string | null>(null);

  async function newGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const target = money(form.get('target'));
    if (!name || target < 1) return setError('Give the goal a name and an amount.');
    await addGoal({
      name,
      targetAmountPaise: target,
      targetDate: String(form.get('date') || '') || null,
    });
    setError(null);
    event.currentTarget.reset();
  }

  async function newReceivable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const who = String(form.get('who') ?? '').trim();
    const amount = money(form.get('amount'));
    const date = String(form.get('date') ?? '');
    if (!who || amount < 1 || !date)
      return setError('Enter who, how much and the date you expect it.');
    await addReceivable({
      kind: form.get('kind') === 'EXPECTED_INCOME' ? 'EXPECTED_INCOME' : 'OWED_TO_ME',
      counterparty: who,
      amountPaise: amount,
      expectedDate: date,
    });
    setError(null);
    event.currentTarget.reset();
  }

  return (
    <main className={ui.page}>
      <h1 className={ui.title}>Goals and money coming</h1>

      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}

      <label className={ui.label}>
        Money received goes into
        <select className={ui.input} value={account} onChange={(e) => setAccountId(e.target.value)}>
          {accounts
            ?.filter((a) => !a.archived)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>

      <section aria-label="Goals" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Goals</h2>
        {goals?.length === 0 && <p className={ui.muted}>No goals yet.</p>}
        {goals?.map(({ goal, contributions }) => {
          const progress = goalProgress(goal.targetAmountPaise, contributions);
          return (
            <article key={goal.id} className={ui.card + ' flex flex-col gap-3'}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">{goal.name}</h3>
                  <p className={ui.muted}>
                    {formatINR(progress.fundedPaise)} of {formatINR(goal.targetAmountPaise)}
                    {goal.targetDate && ` · by ${formatDate(`${goal.targetDate}T12:00:00+05:30`)}`}
                  </p>
                </div>
                <button
                  className="min-h-11 px-3 text-sm underline"
                  onClick={() => deleteGoal(goal.id)}
                >
                  Delete
                </button>
              </div>

              <div
                role="img"
                aria-label={`${progress.percentFunded}% funded, ${formatINR(progress.gapPaise)} still needed`}
                className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
              >
                {progress.byContributor.map((c, i) => (
                  <div
                    key={c.contributor}
                    style={{
                      width: `${(c.amountPaise * 100) / goal.targetAmountPaise}%`,
                      background: `var(--viz-series-${(i % 6) + 1})`,
                    }}
                  />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {progress.byContributor.map((c, i) => (
                  <li key={c.contributor} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ background: `var(--viz-series-${(i % 6) + 1})` }}
                    />
                    {c.contributor} {formatINR(c.amountPaise)}
                  </li>
                ))}
                <li>
                  {progress.gapPaise > 0
                    ? `Still needed ${formatINR(progress.gapPaise)}`
                    : 'Fully funded'}
                </li>
              </ul>

              <ul className="flex flex-col">
                {contributions.map((c) => (
                  <li
                    key={c.id}
                    className="flex min-h-12 items-center justify-between gap-2 border-t border-slate-200 text-sm dark:border-slate-800"
                  >
                    <span>
                      {c.contributor} · {formatINR(c.amountPaise)}
                      {c.isSelf && ' (mine)'}
                    </span>
                    {c.status === 'RECEIVED' ? (
                      <span className={ui.muted}>Received</span>
                    ) : (
                      <button
                        className={ui.secondary}
                        onClick={() => receiveContribution(c.id, account || null)}
                      >
                        Mark received
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <form
                className="flex flex-col gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const isSelf = form.get('self') === 'on';
                  const who = String(form.get('who') ?? '').trim() || (isSelf ? 'Me' : '');
                  const amount = money(form.get('amount'));
                  if (!who || amount < 1)
                    return setError('Enter who is contributing and how much.');
                  await addContribution({
                    goalId: goal.id,
                    contributor: who,
                    isSelf,
                    amountPaise: amount,
                  });
                  setError(null);
                  event.currentTarget.reset();
                }}
              >
                <div className="flex gap-2">
                  <input
                    name="who"
                    aria-label="Contributor"
                    className={ui.input}
                    placeholder="Who"
                  />
                  <input
                    name="amount"
                    aria-label="Amount"
                    inputMode="decimal"
                    className={ui.input}
                    placeholder="₹"
                  />
                </div>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="self" /> This is my own share
                </label>
                <button type="submit" className={ui.secondary}>
                  Add contribution
                </button>
              </form>
            </article>
          );
        })}

        <form onSubmit={newGoal} className={ui.card + ' flex flex-col gap-3'}>
          <h3 className="font-medium">New goal</h3>
          <input
            name="name"
            aria-label="Goal name"
            className={ui.input}
            placeholder="What are you saving for?"
          />
          <input
            name="target"
            aria-label="Target amount"
            inputMode="decimal"
            className={ui.input}
            placeholder="Target (₹)"
          />
          <label className={ui.label}>
            Needed by (optional)
            <input name="date" type="date" className={ui.input} />
          </label>
          <button type="submit" className={ui.primary}>
            Add goal
          </button>
        </form>
      </section>

      <section aria-label="Money coming" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Money coming</h2>
        {receivables?.length === 0 && <p className={ui.muted}>Nothing expected.</p>}
        <ul className="flex flex-col gap-2">
          {receivables
            ?.filter((r) => r.status !== 'CANCELLED')
            .map((r) => (
              <li key={r.id} className={ui.card + ' flex flex-col gap-2'}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.counterparty}</span>
                  <span className="font-semibold tabular-nums">{formatINR(r.amountPaise)}</span>
                </div>
                <p className={ui.muted}>
                  {r.kind === 'OWED_TO_ME' ? 'They owe you' : 'Expected income'} ·{' '}
                  {r.status === 'RECEIVED'
                    ? 'Received'
                    : `${r.expectedDate < today ? 'Was due' : 'By'} ${formatDate(`${r.expectedDate}T12:00:00+05:30`)}`}
                </p>
                {r.status === 'RECEIVED' ? (
                  <button className={ui.secondary} onClick={() => undoReceive(r.id)}>
                    Undo received
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      className={ui.primary + ' flex-1'}
                      disabled={!account}
                      onClick={() => receiveReceivable(r.id, { accountId: account })}
                    >
                      Mark received
                    </button>
                    <button className={ui.secondary} onClick={() => cancelReceivable(r.id)}>
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            ))}
        </ul>
        <form onSubmit={newReceivable} className={ui.card + ' flex flex-col gap-3'}>
          <h3 className="font-medium">Add money coming</h3>
          <select name="kind" aria-label="Kind" className={ui.input} defaultValue="OWED_TO_ME">
            <option value="OWED_TO_ME">Someone owes me</option>
            <option value="EXPECTED_INCOME">Income I’m expecting</option>
          </select>
          <input name="who" aria-label="From" className={ui.input} placeholder="From whom" />
          <input
            name="amount"
            aria-label="Amount"
            inputMode="decimal"
            className={ui.input}
            placeholder="₹"
          />
          <label className={ui.label}>
            Expected on
            <input name="date" type="date" className={ui.input} />
          </label>
          <button type="submit" className={ui.primary}>
            Add
          </button>
        </form>
      </section>
    </main>
  );
}
