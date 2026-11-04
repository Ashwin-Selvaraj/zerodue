import { assertPaise } from './guards';
import type { DateString } from './months';
import type { PlanMonth } from './plan';

export interface CashEvent {
  date: DateString;
  label: string;
  /** Signed: positive money in, negative money out. */
  amountPaise: number;
}

export interface CashRisk {
  date: DateString;
  label: string;
  /** Balance right after the event that caused the dip. */
  balancePaise: number;
  /** How far below the safety buffer the balance fell. */
  shortfallPaise: number;
}

/**
 * Walks the account balance day by day and reports every payment that takes it below the buffer
 * (0 by default). Same-day events are applied money-out first, which is the cautious reading when
 * the order within a day is unknown. This catches timing problems that monthly totals hide, e.g. an
 * EMI falling due before the payment that funds it arrives.
 */
export function findCashRisks(
  openingBalancePaise: number,
  events: CashEvent[],
  bufferPaise = 0,
): CashRisk[] {
  assertPaise(openingBalancePaise, 'openingBalancePaise');
  assertPaise(bufferPaise, 'bufferPaise');
  const ordered = [...events].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.amountPaise - b.amountPaise,
  );
  const risks: CashRisk[] = [];
  let balance = openingBalancePaise;
  for (const event of ordered) {
    balance += event.amountPaise;
    if (event.amountPaise < 0 && balance < bufferPaise) {
      risks.push({
        date: event.date,
        label: event.label,
        balancePaise: balance,
        shortfallPaise: bufferPaise - balance,
      });
    }
  }
  return risks;
}

/** Turns planned months into dated cash events for {@link findCashRisks}. */
export function cashEventsOf(months: PlanMonth[]): CashEvent[] {
  const events: CashEvent[] = [];
  for (const month of months) {
    for (const line of [...month.income, ...month.receivables]) {
      events.push({ date: line.date, label: line.label, amountPaise: line.amountPaise });
    }
    for (const line of [...month.fixed, ...month.oneOffs]) {
      events.push({ date: line.date, label: line.label, amountPaise: -line.amountPaise });
    }
    for (const line of month.earmarked) {
      events.push({ date: line.date, label: line.label, amountPaise: line.amountPaise });
    }
  }
  return events;
}
