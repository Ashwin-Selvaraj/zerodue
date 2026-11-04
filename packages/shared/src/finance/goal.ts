import { assertPaise } from './guards';

export interface GoalContributionInput {
  contributor: string;
  amountPaise: number;
  status: 'PLEDGED' | 'RECEIVED';
}

export interface GoalProgress {
  targetPaise: number;
  /** Everything committed: received plus pledged. */
  fundedPaise: number;
  receivedPaise: number;
  pledgedPaise: number;
  /** Still unfunded; zero once the goal is fully covered. */
  gapPaise: number;
  /** Funded share of the target in whole percent, capped at 100. */
  percentFunded: number;
  byContributor: { contributor: string; amountPaise: number }[];
}

/** Funding position of a purchase plan with several contributors. The gap is always computed. */
export function goalProgress(
  targetPaise: number,
  contributions: GoalContributionInput[],
): GoalProgress {
  assertPaise(targetPaise, 'targetPaise');
  let receivedPaise = 0;
  let pledgedPaise = 0;
  const totals = new Map<string, number>();
  for (const item of contributions) {
    assertPaise(item.amountPaise, 'contribution amount');
    if (item.status === 'RECEIVED') receivedPaise += item.amountPaise;
    else pledgedPaise += item.amountPaise;
    totals.set(item.contributor, (totals.get(item.contributor) ?? 0) + item.amountPaise);
  }
  const fundedPaise = receivedPaise + pledgedPaise;
  return {
    targetPaise,
    fundedPaise,
    receivedPaise,
    pledgedPaise,
    gapPaise: Math.max(0, targetPaise - fundedPaise),
    percentFunded:
      targetPaise === 0 ? 100 : Math.min(100, Math.floor((fundedPaise * 100) / targetPaise)),
    byContributor: [...totals].map(([contributor, amountPaise]) => ({ contributor, amountPaise })),
  };
}
