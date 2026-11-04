import { assertPaise } from './guards';
import {
  projectLoan,
  solveLevelPayment,
  type PaymentPlan,
  type Projection,
  type ProjectionInput,
} from './loan';
import { addMonths, monthsBetween, type MonthKey } from './months';

export interface GapRow {
  month: MonthKey;
  neededPaise: number;
  availablePaise: number;
  /** How much more is needed than is available (never negative). */
  gapPaise: number;
}

/** Per month, how far the money available falls short of a required payment. */
export function gapByMonth(
  fromMonth: MonthKey,
  toMonth: MonthKey,
  neededPaise: number,
  availableByMonth: Record<MonthKey, number>,
): GapRow[] {
  assertPaise(neededPaise, 'neededPaise');
  const count = monthsBetween(fromMonth, toMonth) + 1;
  if (count < 1) throw new RangeError('toMonth must not be before fromMonth');
  return Array.from({ length: count }, (_, i) => {
    const month = addMonths(fromMonth, i);
    const availablePaise = availableByMonth[month] ?? 0;
    return {
      month,
      neededPaise,
      availablePaise,
      gapPaise: Math.max(0, neededPaise - availablePaise),
    };
  });
}

export interface GapAnalysis {
  /** Level monthly payment that clears the loan by the target month. */
  requiredMonthlyPaise: number;
  rows: GapRow[];
  totalGapPaise: number;
}

/** "What would it take to finish by X, and where does the money fall short?" */
export function analyseGap(
  input: Omit<ProjectionInput, 'payments' | 'maxMonths'>,
  targetMonth: MonthKey,
  availableByMonth: Record<MonthKey, number>,
): GapAnalysis {
  const requiredMonthlyPaise = solveLevelPayment({ ...input, targetMonth });
  const rows = gapByMonth(input.firstMonth, targetMonth, requiredMonthlyPaise, availableByMonth);
  return {
    requiredMonthlyPaise,
    rows,
    totalGapPaise: rows.reduce((sum, row) => sum + row.gapPaise, 0),
  };
}

export interface Scenario {
  name?: string;
  /** Extra part-payments or lump sums on top of the base plan. */
  extraPayments?: { month: MonthKey; amountPaise: number }[];
  /** Replaces the base plan with this level payment every month (extras still apply). */
  monthlyPaymentPaise?: number;
  annualRateBps?: number;
  /** When set, also solve the level payment needed to clear by this month. */
  targetMonth?: MonthKey;
}

export interface ScenarioResult {
  name: string;
  projection: Projection;
  payoffMonth: MonthKey | null;
  totalInterestPaise: number;
  /** Number of months with a payment (schedule length). */
  months: number;
  requiredMonthlyPaise?: number;
}

export interface ScenarioComparison extends ScenarioResult {
  /** Positive means this scenario pays less interest than the base. */
  interestSavedPaise: number;
  /** Positive means this scenario clears sooner than the base. */
  monthsSaved: number;
}

function applyScenario(base: ProjectionInput, scenario: Scenario): ProjectionInput {
  const extraByMonth: Record<MonthKey, number> = { ...base.payments.extraByMonth };
  for (const extra of scenario.extraPayments ?? []) {
    assertPaise(extra.amountPaise, 'extra payment');
    extraByMonth[extra.month] = (extraByMonth[extra.month] ?? 0) + extra.amountPaise;
  }
  const payments: PaymentPlan =
    scenario.monthlyPaymentPaise === undefined
      ? { ...base.payments, extraByMonth }
      : { defaultPaymentPaise: scenario.monthlyPaymentPaise, extraByMonth };
  return { ...base, annualRateBps: scenario.annualRateBps ?? base.annualRateBps, payments };
}

export function runScenario(base: ProjectionInput, scenario: Scenario = {}): ScenarioResult {
  const input = applyScenario(base, scenario);
  const projection = projectLoan(input);
  const result: ScenarioResult = {
    name: scenario.name ?? 'Scenario',
    projection,
    payoffMonth: projection.payoffMonth,
    totalInterestPaise: projection.totalInterestPaise,
    months: projection.rows.length,
  };
  if (scenario.targetMonth) {
    result.requiredMonthlyPaise = solveLevelPayment({
      ...input,
      targetMonth: scenario.targetMonth,
      extraByMonth: input.payments.extraByMonth,
    });
  }
  return result;
}

/** Runs the base plan and each scenario, reporting interest and time saved against the base. */
export function compareScenarios(
  base: ProjectionInput,
  scenarios: Scenario[],
): { base: ScenarioResult; scenarios: ScenarioComparison[] } {
  const baseResult = runScenario(base, { name: 'Current plan' });
  return {
    base: baseResult,
    scenarios: scenarios.map((scenario) => {
      const result = runScenario(base, scenario);
      return {
        ...result,
        interestSavedPaise: baseResult.totalInterestPaise - result.totalInterestPaise,
        monthsSaved: baseResult.months - result.months,
      };
    }),
  };
}
