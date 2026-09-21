import type { DemandType, Person, PlanState, WorkItem } from '@/types/planning';

export function sumItemDays(item: WorkItem): number {
  return Object.values(item.allocations).reduce((sum, allocation) => sum + allocation.days, 0);
}

export function personItems(plan: PlanState, personId: string): WorkItem[] {
  return plan.workItems.filter((item) => item.personId === personId);
}

export function personTypeDays(plan: PlanState, personId: string, type: DemandType): number {
  return personItems(plan, personId)
    .filter((item) => item.type === type)
    .reduce((sum, item) => sum + sumItemDays(item), 0);
}

export function personTotalDays(plan: PlanState, personId: string): number {
  return personItems(plan, personId).reduce((sum, item) => sum + sumItemDays(item), 0);
}

export function personIterationDays(plan: PlanState, personId: string, iterationId: string): number {
  return personItems(plan, personId).reduce(
    (sum, item) => sum + (item.allocations[iterationId]?.days ?? 0),
    0,
  );
}

export function personQuarterCapacity(plan: PlanState, person: Person): number {
  return person.iterationCapacityDays * plan.iterations.length;
}

export function typeBudget(plan: PlanState, person: Person, type: DemandType): number {
  const quarterCapacity = personQuarterCapacity(plan, person);
  return quarterCapacity * (type === 'routine' ? person.routineRatio : person.dpoRatio);
}

export function planMetrics(plan: PlanState, iterationId = plan.currentIterationId) {
  const selectedItems = plan.workItems.filter(
    (item) => (item.allocations[iterationId]?.days ?? 0) > 0,
  );
  const iterationCapacity = plan.people.reduce(
    (sum, person) => sum + person.iterationCapacityDays,
    0,
  );
  const iterationDays = selectedItems.reduce(
    (sum, item) => sum + (item.allocations[iterationId]?.days ?? 0),
    0,
  );
  const routineDays = selectedItems
    .filter((item) => item.type === 'routine')
    .reduce((sum, item) => sum + (item.allocations[iterationId]?.days ?? 0), 0);
  const overloadedPeople = plan.people.filter(
    (person) => personIterationDays(plan, person.id, iterationId) > person.iterationCapacityDays,
  ).length;

  return {
    iterationItemCount: selectedItems.length,
    iterationCapacity,
    iterationDays,
    routineDays,
    overloadedPeople,
  };
}

export function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}
