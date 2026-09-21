import { seedPlan } from '@/data/seed';
import { canEditItem, hasPermission, userPermissions } from '@/utils/permissions';

describe('permission checks', () => {
  it('gives the administrator organization and permission controls', () => {
    expect(hasPermission(seedPlan, 'team.manage')).toBe(true);
    expect(hasPermission(seedPlan, 'type.manage')).toBe(true);
    expect(hasPermission(seedPlan, 'permission.manage')).toBe(true);
  });

  it('limits a member to their own planning items', () => {
    const memberPlan = { ...seedPlan, currentUserId: 'p3' };
    expect(userPermissions(memberPlan).has('plan.edit_own')).toBe(true);
    expect(canEditItem(memberPlan, 'p3')).toBe(true);
    expect(canEditItem(memberPlan, 'p2')).toBe(false);
  });

  it('allows a planner to edit all planning items without permission administration', () => {
    const plannerPlan = { ...seedPlan, currentUserId: 'p2' };
    expect(canEditItem(plannerPlan, 'p5')).toBe(true);
    expect(hasPermission(plannerPlan, 'permission.manage')).toBe(false);
  });
});
