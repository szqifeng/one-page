import type { Allocation, PlanState, WorkItem } from '@/types/planning';

const iterations = [
  { id: 'r1', label: 'R1', startDate: '2026-09-14', endDate: '2026-09-27' },
  { id: 'r2', label: 'R2', startDate: '2026-09-28', endDate: '2026-10-11' },
  { id: 'r3', label: 'R3', startDate: '2026-10-12', endDate: '2026-10-25' },
  { id: 'r4', label: 'R4', startDate: '2026-10-26', endDate: '2026-11-08' },
  { id: 'r5', label: 'R5', startDate: '2026-11-09', endDate: '2026-11-22' },
  { id: 'r6', label: 'R6', startDate: '2026-11-23', endDate: '2026-12-06' },
  { id: 'r7', label: 'R7', startDate: '2026-12-07', endDate: '2026-12-20' },
];

function allocations(
  values: Array<[delivery: string, days: number] | null>,
): Record<string, Allocation> {
  return Object.fromEntries(
    values.flatMap((value, index) =>
      value
        ? [[iterations[index]!.id, { delivery: value[0], days: value[1] }]]
        : [],
    ),
  );
}

const workItems: WorkItem[] = [
  { id: 'w1', personId: 'p1', type: 'dpo', code: 'D01', title: '权限审批上线', status: 'in_progress', allocations: allocations([['规则与方案确认', 3], ['开发验收上线', 5]]) },
  { id: 'w2', personId: 'p1', type: 'dpo', code: 'D02', title: '角色配置优化', status: 'planned', allocations: allocations([null, null, ['配置方案', 4], ['交付上线', 5]]) },
  { id: 'w3', personId: 'p1', type: 'routine', code: 'N01', title: '财务接口适配', status: 'done', allocations: allocations([['接口适配', 2]]) },
  { id: 'w4', personId: 'p1', type: 'routine', code: 'N02', title: '审计字段补充', status: 'planned', allocations: allocations([null, ['字段补充', 2]]) },
  { id: 'w5', personId: 'p2', type: 'dpo', code: 'D03', title: '客户端数据同步', status: 'in_progress', allocations: allocations([['链路梳理', 2], ['联调与验收', 5]]) },
  { id: 'w6', personId: 'p2', type: 'dpo', code: 'D04', title: '风险详情重构', status: 'planned', allocations: allocations([null, null, ['页面开发', 4], ['验收上线', 4]]) },
  { id: 'w7', personId: 'p2', type: 'routine', code: 'N05', title: '终端接口修复', status: 'in_progress', allocations: allocations([null, ['问题修复', 2]]) },
  { id: 'w8', personId: 'p2', type: 'routine', code: 'N06', title: '批量导入调整', status: 'planned', allocations: allocations([null, ['接口调整', 2]]) },
  { id: 'w9', personId: 'p3', type: 'dpo', code: 'D05', title: '策略中心改造', status: 'in_progress', allocations: allocations([['需求拆解', 3], ['接口开发', 4], ['策略联调', 4]]) },
  { id: 'w10', personId: 'p3', type: 'routine', code: 'N09', title: '权限变更记录', status: 'planned', allocations: allocations([null, null, null, ['数据接口', 1], ['页面实现', 2], ['验收上线', 1]]) },
  { id: 'w11', personId: 'p4', type: 'dpo', code: 'D06', title: '终端资产视图', status: 'planned', allocations: allocations([null, ['原型与评审', 3], ['核心开发', 5], ['用户验证', 3]]) },
  { id: 'w12', personId: 'p4', type: 'routine', code: 'N12', title: '自定义报表', status: 'planned', allocations: allocations([null, null, ['字段方案', 2], ['报表开发', 2], ['验收交付', 1]]) },
  { id: 'w13', personId: 'p5', type: 'dpo', code: 'D07', title: '风险处置闭环', status: 'in_progress', allocations: allocations([['流程设计', 2], ['状态流转开发', 4], ['联调测试', 4]]) },
  { id: 'w14', personId: 'p5', type: 'routine', code: 'N14', title: '人员同步修复', status: 'planned', allocations: allocations([null, ['同步修复', 2]]) },
  { id: 'w15', personId: 'p5', type: 'routine', code: 'N15', title: '日志字段调整', status: 'planned', allocations: allocations([null, null, null, ['字段调整', 1]]) },
  { id: 'w16', personId: 'p6', type: 'dpo', code: 'D08', title: '客户端升级机制', status: 'in_progress', allocations: allocations([['技术验证', 3], ['灰度能力', 5], ['上线复盘', 2]]) },
  { id: 'w17', personId: 'p6', type: 'routine', code: 'N16', title: '版本兼容修复', status: 'planned', allocations: allocations([null, null, ['适配验证', 2]]) },
  { id: 'w18', personId: 'p6', type: 'routine', code: 'N17', title: '导出样式优化', status: 'planned', allocations: allocations([null, null, null, null, ['导出调整', 1]]) },
];

export const seedPlan: PlanState = {
  quarter: '2026 Q4',
  currentIterationId: 'r2',
  currentUserId: 'p1',
  personnelTypes: [
    {
      id: 'type-dev',
      name: '开发',
      code: 'DEV',
      color: 'blue',
      description: '负责产品研发、技术方案与工程交付',
      active: true,
    },
    {
      id: 'type-ops',
      name: '运营',
      code: 'OPS',
      color: 'green',
      description: '负责运营推广、服务保障与持续治理',
      active: true,
    },
    {
      id: 'type-product',
      name: '产品',
      code: 'PRODUCT',
      color: 'purple',
      description: '负责需求管理、产品规划与价值验收',
      active: true,
    },
  ],
  permissionRoles: [
    {
      id: 'role-admin',
      name: '系统管理员',
      description: '维护人员、类型、角色与全部规划数据',
      permissions: [
        'plan.view',
        'plan.edit_all',
        'team.view',
        'team.manage',
        'type.manage',
        'iteration.manage',
        'permission.manage',
      ],
      builtIn: true,
    },
    {
      id: 'role-planner',
      name: '规划负责人',
      description: '查看团队并维护全部规划和人员容量',
      permissions: ['plan.view', 'plan.edit_all', 'team.view', 'team.manage', 'iteration.manage'],
      builtIn: true,
    },
    {
      id: 'role-member',
      name: '普通成员',
      description: '查看规划并维护分配给自己的事项',
      permissions: ['plan.view', 'plan.edit_own', 'team.view'],
      builtIn: true,
    },
  ],
  iterations,
  people: [
    { id: 'p1', name: '林岚', account: 'linlan', typeId: 'type-product', permissionRoleIds: ['role-admin'], status: 'active', iterationCapacityDays: 8, dpoRatio: 0.7, routineRatio: 0.3 },
    { id: 'p2', name: '陈澈', account: 'chenche', typeId: 'type-dev', permissionRoleIds: ['role-planner'], status: 'active', iterationCapacityDays: 8, dpoRatio: 0.7, routineRatio: 0.3 },
    { id: 'p3', name: '周宁', account: 'zhouning', typeId: 'type-dev', permissionRoleIds: ['role-member'], status: 'active', iterationCapacityDays: 8, dpoRatio: 0.7, routineRatio: 0.3 },
    { id: 'p4', name: '许然', account: 'xuran', typeId: 'type-dev', permissionRoleIds: ['role-member'], status: 'active', iterationCapacityDays: 8, dpoRatio: 0.7, routineRatio: 0.3 },
    { id: 'p5', name: '罗一', account: 'luoyi', typeId: 'type-ops', permissionRoleIds: ['role-member'], status: 'active', iterationCapacityDays: 8, dpoRatio: 0.7, routineRatio: 0.3 },
    { id: 'p6', name: '唐乔', account: 'tangqiao', typeId: 'type-dev', permissionRoleIds: ['role-member'], status: 'active', iterationCapacityDays: 8, dpoRatio: 0.7, routineRatio: 0.3 },
  ],
  workItems,
};
