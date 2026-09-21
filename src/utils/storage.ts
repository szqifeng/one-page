import { seedPlan } from '@/data/seed';
import type { PlanState } from '@/types/planning';

const STORAGE_KEY = 'one-paper-rolling-plan-v3';

function cloneSeed(): PlanState {
  return structuredClone(seedPlan);
}

function isValidPlan(value: unknown): value is PlanState {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<PlanState>;
  return Boolean(
    Array.isArray(plan.people) &&
      Array.isArray(plan.personnelTypes) &&
      Array.isArray(plan.permissionRoles) &&
      Array.isArray(plan.iterations) &&
      Array.isArray(plan.workItems) &&
      plan.people.every((person) => typeof person.dpoRatio === 'number') &&
      plan.workItems.every((item) => 'code' in item),
  );
}

export function loadPlan(): PlanState {
  if (typeof window === 'undefined') return cloneSeed();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return cloneSeed();
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidPlan(parsed) ? parsed : cloneSeed();
  } catch {
    return cloneSeed();
  }
}

export function savePlan(plan: PlanState) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  }
}

export function clearPlan() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
