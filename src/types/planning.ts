export type DemandType = 'dpo' | 'routine';
export type WorkStatus = 'planned' | 'in_progress' | 'done' | 'risk';
export type PersonStatus = 'active' | 'disabled';
export type PermissionKey =
  | 'plan.view'
  | 'plan.edit_all'
  | 'plan.edit_own'
  | 'team.view'
  | 'team.manage'
  | 'type.manage'
  | 'iteration.manage'
  | 'permission.manage';

export interface PersonnelType {
  id: string;
  name: string;
  code: string;
  color: string;
  description: string;
  active: boolean;
}

export interface PermissionRole {
  id: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  builtIn?: boolean;
}

export interface Person {
  id: string;
  name: string;
  account: string;
  typeId: string;
  permissionRoleIds: string[];
  status: PersonStatus;
  iterationCapacityDays: number;
  dpoRatio: number;
  routineRatio: number;
}

export interface Iteration {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}

export interface Allocation {
  days: number;
  delivery: string;
}

export interface WorkItem {
  id: string;
  personId: string;
  code: string;
  title: string;
  type: DemandType;
  status: WorkStatus;
  progress: number;
  allocations: Record<string, Allocation>;
}

export interface QuarterPlan {
  id: string;
  name: string;
  year: number;
  currentIterationId: string;
  iterations: Iteration[];
  workItems: WorkItem[];
}

export interface PlanState {
  quarter: string;
  activeQuarterId: string;
  quarters: QuarterPlan[];
  currentIterationId: string;
  currentUserId: string;
  personnelTypes: PersonnelType[];
  permissionRoles: PermissionRole[];
  people: Person[];
  iterations: Iteration[];
  workItems: WorkItem[];
}
