import dayjs, { type Dayjs } from 'dayjs';
import type { Iteration } from '@/types/planning';

export const STANDARD_ITERATION_WORKDAYS = 10;

export function isWorkday(value: string | Dayjs): boolean {
  const date = typeof value === 'string' ? dayjs(value) : value;
  const weekday = date.day();
  return date.isValid() && weekday !== 0 && weekday !== 6;
}

export function nextWorkday(value: string | Dayjs): Dayjs {
  let date = typeof value === 'string' ? dayjs(value) : value;
  if (!date.isValid()) return date;
  while (!isWorkday(date)) date = date.add(1, 'day');
  return date;
}

export function previousWorkday(value: string | Dayjs): Dayjs {
  let date = typeof value === 'string' ? dayjs(value) : value;
  if (!date.isValid()) return date;
  while (!isWorkday(date)) date = date.subtract(1, 'day');
  return date;
}

export function addWorkdaysInclusive(value: string | Dayjs, workdays: number): Dayjs {
  let date = nextWorkday(value);
  let remaining = Math.max(1, Math.floor(workdays)) - 1;
  while (remaining > 0) {
    date = date.add(1, 'day');
    if (isWorkday(date)) remaining -= 1;
  }
  return date;
}

export function countWorkdays(startDate: string, endDate: string): number {
  let cursor = dayjs(startDate);
  const end = dayjs(endDate);
  if (!cursor.isValid() || !end.isValid() || end.isBefore(cursor, 'day')) return 0;
  let count = 0;
  while (!cursor.isAfter(end, 'day')) {
    if (isWorkday(cursor)) count += 1;
    cursor = cursor.add(1, 'day');
  }
  return count;
}

export function iterationWorkdays(iteration: Iteration): number {
  return countWorkdays(iteration.startDate, iteration.endDate);
}

export function buildWorkdayIterations(
  startDate: string,
  endDate: string,
  idPrefix: string,
): Iteration[] {
  const boundary = dayjs(endDate);
  if (!dayjs(startDate).isValid() || !boundary.isValid() || boundary.isBefore(dayjs(startDate), 'day')) return [];
  const lastWorkday = previousWorkday(boundary);
  let cursor = nextWorkday(startDate);
  const iterations: Iteration[] = [];

  while (!cursor.isAfter(lastWorkday, 'day')) {
    const targetEnd = addWorkdaysInclusive(cursor, STANDARD_ITERATION_WORKDAYS);
    const iterationEnd = targetEnd.isAfter(lastWorkday, 'day') ? lastWorkday : targetEnd;
    const index = iterations.length + 1;
    iterations.push({
      id: `${idPrefix}-r${index}`,
      label: `R${index}`,
      startDate: cursor.format('YYYY-MM-DD'),
      endDate: iterationEnd.format('YYYY-MM-DD'),
    });
    cursor = nextWorkday(iterationEnd.add(1, 'day'));
  }

  return iterations;
}
