import { seedPlan } from '@/data/seed';
import type { PlanState, QuarterPlan } from '@/types/planning';
import { activateQuarter, normalizePlanQuarters, syncActiveQuarter } from '@/utils/quarters';

describe('quarter planning', () => {
  it('keeps active quarter changes before switching quarters', () => {
    const second: QuarterPlan = {
      id: 'quarter-2027-1',
      name: '2027 第1季度',
      year: 2027,
      currentIterationId: '2027-r1',
      iterations: [{ id: '2027-r1', label: 'R1', startDate: '2027-01-01', endDate: '2027-01-14' }],
      workItems: [],
    };
    const changed = {
      ...seedPlan,
      workItems: seedPlan.workItems.map((item) => item.id === 'w1' ? { ...item, progress: 80 } : item),
      quarters: [...seedPlan.quarters, second],
    };

    const switched = activateQuarter(changed, second.id);
    expect(switched.activeQuarterId).toBe(second.id);
    expect(switched.workItems).toEqual([]);
    expect(switched.quarters[0]!.workItems.find((item) => item.id === 'w1')?.progress).toBe(80);
  });

  it('migrates legacy plans and defaults missing item progress to zero', () => {
    const legacy = {
      ...seedPlan,
      activeQuarterId: undefined,
      quarters: undefined,
      workItems: seedPlan.workItems.map(({ progress: _progress, ...item }) => item),
    } as unknown as PlanState;
    const normalized = normalizePlanQuarters(legacy);
    expect(normalized.quarters).toHaveLength(1);
    expect(normalized.workItems.every((item) => item.progress === 0)).toBe(true);
    expect(syncActiveQuarter(normalized).quarters[0]!.workItems).toEqual(normalized.workItems);
  });
});
