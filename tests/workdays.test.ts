import type { Person } from '@/types/planning';
import { personIterationCapacity } from '@/utils/planning';
import {
  addWorkdaysInclusive,
  buildWorkdayIterations,
  countWorkdays,
} from '@/utils/workdays';

describe('workday-based iterations', () => {
  it('counts Monday through Friday and skips weekends', () => {
    expect(countWorkdays('2026-01-01', '2026-01-14')).toBe(10);
    expect(addWorkdaysInclusive('2026-01-01', 10).format('YYYY-MM-DD')).toBe('2026-01-14');
  });

  it('builds ten-workday iterations and keeps a shorter final iteration', () => {
    const iterations = buildWorkdayIterations('2026-01-01', '2026-01-31', 'quarter-test');
    expect(iterations.map((iteration) => [iteration.startDate, iteration.endDate])).toEqual([
      ['2026-01-01', '2026-01-14'],
      ['2026-01-15', '2026-01-28'],
      ['2026-01-29', '2026-01-30'],
    ]);
  });

  it('prorates capacity for an iteration with fewer than ten workdays', () => {
    const person = { iterationCapacityDays: 8 } as Person;
    expect(personIterationCapacity(person, {
      id: 'r1',
      label: 'R1',
      startDate: '2026-01-29',
      endDate: '2026-01-30',
    })).toBe(1.6);
  });
});
