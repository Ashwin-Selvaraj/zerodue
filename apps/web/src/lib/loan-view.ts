import {
  availabilityByMonth,
  type LoanDto,
  type MonthKey,
  type PlannedPaymentDto,
  type ProjectionInput,
  type Scenario,
  type ScenarioParams,
} from '@zerodue/shared';
import { loanTerms, type LoanState } from './loan-state';
import type { BuiltPlan } from './plan-input';

/**
 * The loan's future as currently planned. For the loan the plan sweeps spare money into, that is
 * whatever the plan pays each month; for any other loan it is the fixed instalment (and any manual
 * payments you set).
 */
export function baseProjection(
  loan: LoanDto,
  state: LoanState,
  built: BuiltPlan | undefined,
  planned: PlannedPaymentDto[],
): ProjectionInput {
  const manual = Object.fromEntries(planned.map((p) => [p.month, p.amountPaise]));
  const swept = built?.sweepLoan?.id === loan.id;
  const fromPlan = swept
    ? Object.fromEntries(
        built!.plan.months.flatMap((m) => (m.loan ? [[m.month, m.loanPaymentPaise]] : [])),
      )
    : {};
  return {
    ...loanTerms(loan),
    openingBalancePaise: state.openingPaise,
    firstMonth: state.nextMonth,
    payments: {
      byMonth: { ...fromPlan, ...manual },
      defaultPaymentPaise: swept ? undefined : (loan.emiPaise ?? undefined),
    },
  };
}

export function scenarioOf(params: ScenarioParams, name?: string): Scenario {
  return {
    name,
    extraPayments: params.extraPayments,
    monthlyPaymentPaise: params.monthlyPaymentPaise ?? undefined,
    annualRateBps: params.annualRateBps ?? undefined,
    targetMonth: params.targetMonth ?? undefined,
  };
}

/** Money the plan has free for this loan each month, or null when the plan doesn't pay this loan. */
export function availabilityFor(
  built: BuiltPlan | undefined,
  loanId: string,
): Record<MonthKey, number> | null {
  if (!built || built.sweepLoan?.id !== loanId) return null;
  return availabilityByMonth(built.plan);
}
