import { seedPlan } from '@/data/seed';
import {
  personIterationDays,
  personQuarterCapacity,
  personTypeDays,
  planMetrics,
  typeBudget,
} from '@/utils/planning';

describe('planning calculations', () => {
  it('calculates a person load in the selected iteration', () => {
    expect(personIterationDays(seedPlan, 'p1', 'r2')).toBe(7);
  });

  it('calculates routine allocation and quarter budget', () => {
    const person = seedPlan.people[0]!;
    expect(personTypeDays(seedPlan, 'p1', 'routine')).toBe(4);
    expect(personQuarterCapacity(seedPlan, person)).toBe(56);
    expect(typeBudget(seedPlan, person, 'routine')).toBeCloseTo(16.8);
    expect(typeBudget(seedPlan, person, 'dpo')).toBeCloseTo(39.2);

    const customRatioPlan = {
      ...seedPlan,
      people: seedPlan.people.map((candidate) =>
        candidate.id === person.id
          ? { ...candidate, dpoRatio: 0.55, routineRatio: 0.45 }
          : candidate,
      ),
    };
    const customPerson = customRatioPlan.people[0]!;
    expect(typeBudget(customRatioPlan, customPerson, 'dpo')).toBeCloseTo(30.8);
    expect(typeBudget(customRatioPlan, customPerson, 'routine')).toBeCloseTo(25.2);
  });

  it('reports the selected iteration summary', () => {
    const metrics = planMetrics(seedPlan, 'r2');
    expect(metrics.iterationItemCount).toBe(10);
    expect(metrics.iterationDays).toBe(34);
    expect(metrics.iterationCapacity).toBe(48);
    expect(metrics.routineDays).toBe(8);
    expect(metrics.overloadedPeople).toBe(1);
  });
});
