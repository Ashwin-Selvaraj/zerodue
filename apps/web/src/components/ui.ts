/** Shared Tailwind class strings so every screen looks the same. All tap targets are at least 48px. */
export const ui = {
  page: 'mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-28 pt-6 md:max-w-2xl',
  title: 'text-2xl font-semibold',
  card: 'rounded-2xl border border-slate-200 p-4 dark:border-slate-800',
  label: 'flex flex-col gap-1 text-sm',
  input:
    'min-h-12 w-full rounded-xl border border-slate-300 bg-transparent px-4 text-base dark:border-slate-700',
  primary:
    'min-h-12 rounded-xl bg-teal-700 px-4 font-medium text-white disabled:opacity-50 dark:bg-teal-600',
  secondary:
    'min-h-12 rounded-xl border border-slate-300 px-4 font-medium disabled:opacity-50 dark:border-slate-700',
  danger:
    'min-h-12 rounded-xl border border-red-300 px-4 font-medium text-red-700 dark:border-red-900 dark:text-red-300',
  link: 'text-teal-700 underline dark:text-teal-400',
  muted: 'text-sm text-slate-600 dark:text-slate-400',
  error: 'rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200',
  chip: 'min-h-11 rounded-full border px-4 text-sm',
  chipOn: 'border-teal-700 bg-teal-700 text-white dark:border-teal-500 dark:bg-teal-600',
  chipOff: 'border-slate-300 dark:border-slate-700',
};

export const chip = (on: boolean): string => `${ui.chip} ${on ? ui.chipOn : ui.chipOff}`;
