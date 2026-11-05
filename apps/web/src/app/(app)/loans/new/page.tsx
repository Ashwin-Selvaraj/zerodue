'use client';

import { isoDateIST, monthKey } from '@zerodue/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ui } from '@/components/ui';
import { typedToPaise } from '@/lib/amount';
import { percentToBps } from '@/lib/format';
import { createLoan } from '@/lib/repo-planning';

const money = (value: FormDataEntryValue | null): number =>
  typedToPaise(String(value ?? '').replace(/[,₹\s]/g, ''));

export default function NewLoanPage() {
  const router = useRouter();
  const [kind, setKind] = useState<'FLEXIBLE' | 'EMI'>('FLEXIBLE');
  const [error, setError] = useState<string | null>(null);
  const thisMonth = monthKey(new Date());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const balance = money(form.get('balance'));
    if (!name) return setError('Give the loan a name.');
    if (balance < 1) return setError('Enter what you owe today.');
    const emi = money(form.get('emi'));
    const day = Number(form.get('day'));
    const loan = await createLoan({
      name,
      kind,
      status: 'ACTIVE',
      outstandingPaise: balance,
      originalPaise: balance,
      outstandingAsOf: String(form.get('asOf') || `${thisMonth}`),
      annualRateBps: percentToBps(String(form.get('rate') ?? '')),
      interestStartMonth: String(form.get('interestStart') || thisMonth).slice(0, 7) + '-01',
      emiPaise: kind === 'EMI' && emi > 0 ? emi : null,
      emiDueDay: kind === 'EMI' && day >= 1 && day <= 31 ? day : null,
      paymentDay: kind === 'FLEXIBLE' && day >= 1 && day <= 31 ? day : null,
    });
    router.push(`/loans/${loan.id}`);
  }

  return (
    <main className={ui.page}>
      <Link href="/loans" className={ui.link}>
        ‹ Loans
      </Link>
      <h1 className={ui.title}>New loan</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className={ui.label}>
          Name
          <input name="name" className={ui.input} placeholder="e.g. Home loan" required />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm">How is it repaid?</legend>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={kind === 'FLEXIBLE'}
              onClick={() => setKind('FLEXIBLE')}
              className={`${ui.chip} flex-1 ${kind === 'FLEXIBLE' ? ui.chipOn : ui.chipOff}`}
            >
              Pay what I can
            </button>
            <button
              type="button"
              aria-pressed={kind === 'EMI'}
              onClick={() => setKind('EMI')}
              className={`${ui.chip} flex-1 ${kind === 'EMI' ? ui.chipOn : ui.chipOff}`}
            >
              Fixed EMI
            </button>
          </div>
        </fieldset>
        <label className={ui.label}>
          What you owe today (₹)
          <input name="balance" inputMode="decimal" className={ui.input} placeholder="5,00,000" />
        </label>
        <label className={ui.label}>
          Balance is as of
          <input
            name="asOf"
            type="date"
            defaultValue={`${isoDateIST(new Date()).slice(0, 8)}01`}
            className={ui.input}
          />
          <span className={ui.muted}>
            Use the 1st of the month if the balance is before this month’s interest.
          </span>
        </label>
        <label className={ui.label}>
          Interest rate (% a year)
          <input name="rate" inputMode="decimal" className={ui.input} placeholder="9" />
        </label>
        <label className={ui.label}>
          Interest starts from
          <input name="interestStart" type="date" defaultValue={thisMonth} className={ui.input} />
        </label>
        {kind === 'EMI' && (
          <label className={ui.label}>
            EMI amount (₹)
            <input name="emi" inputMode="decimal" className={ui.input} />
          </label>
        )}
        <label className={ui.label}>
          {kind === 'EMI' ? 'EMI due on day' : 'Usual payment day (leave empty for month-end)'}
          <input name="day" type="number" min={1} max={31} className={ui.input} />
        </label>
        {error && (
          <p role="alert" className={ui.error}>
            {error}
          </p>
        )}
        <button type="submit" className={ui.primary}>
          Add loan
        </button>
      </form>
    </main>
  );
}
