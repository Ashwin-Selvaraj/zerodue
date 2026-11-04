import type { CategoryInput } from './dto/records';

/** A category to create for a new user; children are created under it. */
export interface DefaultCategory extends Pick<
  CategoryInput,
  'name' | 'kind' | 'icon' | 'color' | 'quickPick'
> {
  children?: Omit<DefaultCategory, 'children'>[];
}

/**
 * The seed category set. The four `quickPick` categories are the action buttons on the
 * "What type of payment?" notification. Everything is editable after sign-up.
 */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Fuel', kind: 'EXPENSE', icon: 'fuel', color: '#ea580c', quickPick: true },
  {
    name: 'Food & going out',
    kind: 'EXPENSE',
    icon: 'utensils',
    color: '#16a34a',
    quickPick: true,
  },
  { name: 'Card', kind: 'EXPENSE', icon: 'credit-card', color: '#7c3aed', quickPick: true },
  { name: 'EMI', kind: 'EXPENSE', icon: 'calendar-clock', color: '#0891b2', quickPick: false },
  { name: 'Gold', kind: 'EXPENSE', icon: 'coins', color: '#ca8a04', quickPick: false },
  { name: 'Loans', kind: 'EXPENSE', icon: 'landmark', color: '#dc2626', quickPick: false },
  { name: 'Misc', kind: 'EXPENSE', icon: 'tag', color: '#64748b', quickPick: true },
  {
    name: 'Income',
    kind: 'INCOME',
    icon: 'banknote',
    color: '#0f766e',
    quickPick: false,
    children: [
      { name: 'Salary', kind: 'INCOME', quickPick: false },
      { name: 'Bonus', kind: 'INCOME', quickPick: false },
      { name: 'Brother', kind: 'INCOME', quickPick: false },
      { name: 'Freelance / one-time', kind: 'INCOME', quickPick: false },
      { name: 'Friend repayment', kind: 'INCOME', quickPick: false },
    ],
  },
];

/** Name of the account every new user starts with, so quick-add works immediately. */
export const DEFAULT_ACCOUNT_NAME = 'Cash';
