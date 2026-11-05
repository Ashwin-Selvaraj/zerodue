import { describeReminder, dedupeKey, OVERDUE_LEAD, reminderSlots } from './plan';

describe('reminderSlots', () => {
  it('reminds at 9am India time on each chosen day, and once more if the bill goes overdue', () => {
    const slots = reminderSlots('2026-11-05', [1, 3]);
    expect(slots.map((s) => [s.leadDays, s.at.toISOString()])).toEqual([
      [3, '2026-11-02T03:30:00.000Z'],
      [1, '2026-11-04T03:30:00.000Z'],
      [OVERDUE_LEAD, '2026-11-06T03:30:00.000Z'],
    ]);
  });

  it('includes the due day itself when asked for, and ignores repeated leads', () => {
    expect(reminderSlots('2026-11-05', [0, 0]).map((s) => s.leadDays)).toEqual([0, OVERDUE_LEAD]);
  });

  it('sends nothing for a bill with no reminders chosen', () => {
    expect(reminderSlots('2026-11-05', [])).toEqual([]);
  });

  it('crosses month ends correctly', () => {
    expect(reminderSlots('2026-12-01', [2])[0]!.at.toISOString()).toBe('2026-11-29T03:30:00.000Z');
  });
});

describe('dedupeKey', () => {
  it('is stable for the same bill and lead, and different otherwise', () => {
    expect(dedupeKey('a', 3)).toBe('a:3:WEB_PUSH');
    expect(dedupeKey('a', 3)).not.toBe(dedupeKey('a', 1));
  });
});

describe('describeReminder', () => {
  const base = {
    name: 'Rent',
    kind: 'EXPENSE' as const,
    amountPaise: 450_000,
    dueDate: '2026-11-05',
  };

  it('says when a bill is due', () => {
    expect(describeReminder({ ...base, leadDays: 3 })).toEqual({
      title: 'Rent due in 3 days',
      body: '₹4,500 · due 05 Nov 2026',
    });
    expect(describeReminder({ ...base, leadDays: 1 }).title).toBe('Rent due tomorrow');
    expect(describeReminder({ ...base, leadDays: 0 }).title).toBe('Rent due today');
  });

  it('says when a bill is overdue', () => {
    expect(describeReminder({ ...base, leadDays: OVERDUE_LEAD }).title).toBe('Rent is overdue');
  });

  it('words income as expected rather than due', () => {
    expect(describeReminder({ ...base, name: 'Salary', kind: 'INCOME', leadDays: 1 })).toEqual({
      title: 'Salary expected tomorrow',
      body: '₹4,500 · expected 05 Nov 2026',
    });
  });
});
