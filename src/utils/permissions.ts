import type { PermissionKey, PlanState } from '@/types/planning';

export const permissionCatalog: Array<{
  key: PermissionKey;
  name: string;
  description: string;
  group: string;
}> = [
  { key: 'plan.view', name: '查看规划', description: '查看季度与双周规划数据', group: '规划' },
  { key: 'plan.edit_all', name: '维护全部规划', description: '新增、编辑、删除任意人员的事项', group: '规划' },
  { key: 'plan.edit_own', name: '维护本人规划', description: '仅维护负责人为自己的事项', group: '规划' },
  { key: 'team.view', name: '查看团队', description: '查看人员、类型与角色信息', group: '组织' },
  { key: 'team.manage', name: '维护人员', description: '新增、编辑、停用人员及调整容量', group: '组织' },
  { key: 'type.manage', name: '维护人员类型', description: '维护开发、运营、产品等人员类型', group: '组织' },
  { key: 'iteration.manage', name: '维护迭代', description: '维护季度内的双周迭代与日期', group: '规划' },
  { key: 'permission.manage', name: '维护权限角色', description: '配置角色权限与人员角色归属', group: '权限' },
];

export function currentUser(plan: PlanState) {
  return plan.people.find((person) => person.id === plan.currentUserId);
}

export function userPermissions(plan: PlanState): Set<PermissionKey> {
  const user = currentUser(plan);
  if (!user || user.status !== 'active') return new Set();
  const roleIds = new Set(user.permissionRoleIds);
  return new Set(
    plan.permissionRoles
      .filter((role) => roleIds.has(role.id))
      .flatMap((role) => role.permissions),
  );
}

export function hasPermission(plan: PlanState, permission: PermissionKey): boolean {
  return userPermissions(plan).has(permission);
}

export function canEditItem(plan: PlanState, personId: string): boolean {
  const permissions = userPermissions(plan);
  return (
    permissions.has('plan.edit_all') ||
    (permissions.has('plan.edit_own') && plan.currentUserId === personId)
  );
}
