import type { PlanState, QuarterPlan } from '@/types/planning';

function normalizeQuarter(quarter: QuarterPlan): QuarterPlan {
  return {
    ...quarter,
    workItems: (quarter.workItems ?? []).map((item) => ({
      ...item,
      progress: Number.isFinite(item.progress) ? Math.min(100, Math.max(0, item.progress)) : 0,
    })),
  };
}

function legacyQuarter(plan: PlanState): QuarterPlan {
  const year = Number(plan.quarter?.match(/\d{4}/)?.[0]) || new Date().getFullYear();
  return {
    id: `quarter-${year}-${Date.now()}`,
    name: plan.quarter || `${year} 第1季度`,
    year,
    currentIterationId: plan.currentIterationId,
    iterations: plan.iterations ?? [],
    workItems: plan.workItems ?? [],
  };
}

export function normalizePlanQuarters(plan: PlanState): PlanState {
  const quarters = (Array.isArray(plan.quarters) && plan.quarters.length > 0
    ? plan.quarters
    : [legacyQuarter(plan)]).map(normalizeQuarter);
  const active = quarters.find((quarter) => quarter.id === plan.activeQuarterId) ?? quarters[0]!;
  return {
    ...plan,
    activeQuarterId: active.id,
    quarter: active.name,
    currentIterationId: active.currentIterationId,
    iterations: active.iterations,
    workItems: active.workItems,
    quarters,
  };
}

export function syncActiveQuarter(plan: PlanState): PlanState {
  const normalized = Array.isArray(plan.quarters)
    && plan.quarters.some((quarter) => quarter.id === plan.activeQuarterId)
    ? plan
    : normalizePlanQuarters(plan);
  const quarters = normalized.quarters.map((quarter) =>
    quarter.id === normalized.activeQuarterId
      ? {
          ...quarter,
          name: normalized.quarter,
          currentIterationId: normalized.currentIterationId,
          iterations: normalized.iterations,
          workItems: normalized.workItems,
        }
      : quarter,
  );
  return { ...normalized, quarters };
}

export function activateQuarter(plan: PlanState, quarterId: string): PlanState {
  const synchronized = syncActiveQuarter(plan);
  const target = synchronized.quarters.find((quarter) => quarter.id === quarterId);
  if (!target) return synchronized;
  return {
    ...synchronized,
    activeQuarterId: target.id,
    quarter: target.name,
    currentIterationId: target.currentIterationId,
    iterations: target.iterations,
    workItems: target.workItems,
  };
}
