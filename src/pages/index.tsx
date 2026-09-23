import {
  BarChartOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  LogoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  WarningFilled,
} from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import {
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useCollaboration } from '@/utils/useCollaboration';
import TeamSettings from '@/components/TeamSettings';
import { seedPlan } from '@/data/seed';
import { ApiError, bindApiTeam, createTeam, getAuthConfig, getCurrentUser, getPlan, getPlanVersions, getTeams, login, logout, restorePlanVersion, switchTeam, type AuthUser, type PlanVersion, type TeamSummary } from '@/utils/api';
import type {
  Allocation,
  DemandType,
  Person,
  PlanState,
  QuarterPlan,
  WorkItem,
  WorkStatus,
} from '@/types/planning';
import {
  formatDays,
  personIterationCapacity,
  personIterationDays,
  personQuarterCapacity,
  personTotalDays,
  personTypeDays,
  planMetrics,
  sumItemDays,
  typeBudget,
} from '@/utils/planning';
import { buildWorkdayIterations, iterationWorkdays } from '@/utils/workdays';
import {
  canEditItem,
  hasPermission,
} from '@/utils/permissions';
import { activateQuarter, normalizePlanQuarters, syncActiveQuarter } from '@/utils/quarters';
import styles from './index.less';

const { Text, Title } = Typography;

type InsightView = 'iteration' | 'quarter' | 'person' | 'task';
type CapacityView = DemandType | 'total';

interface WorkItemFormValues {
  personId: string;
  type: DemandType;
  code: string;
  title: string;
  status: WorkStatus;
  progress: number;
  allocations: Record<string, Partial<Allocation>>;
}

interface QuarterFormValues {
  name: string;
  year: number;
  startDate: string;
  endDate: string;
}

interface TeamFormValues {
  name: string;
  code: string;
}

interface InsightItem {
  key: string;
  label: string;
  value: number;
  suffix: string;
  hint: string;
  ratio: number;
  danger?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

function LoginScreen({ onLogin, error, oauthEnabled, passwordEnabled }: { onLogin: (account: string, password: string) => Promise<void>; error?: string; oauthEnabled: boolean; passwordEnabled: boolean }) {
  const [form] = Form.useForm<{ account: string; password: string }>();
  return (
    <main className={styles.loginPage}>
      <Card className={styles.loginCard} bordered={false}>
        <Title level={2}>季度双周滚动规划</Title>
        <Text type="secondary">请登录团队账号后继续</Text>
        {error && <div className={styles.loginError}>{error}</div>}
        {passwordEnabled && (
          <Form form={form} layout="vertical" onFinish={(values) => onLogin(values.account, values.password)}>
            <Form.Item label="账号" name="account" rules={[{ required: true, message: '请输入账号' }]}>
              <Input autoComplete="username" placeholder="请输入团队账号" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password autoComplete="current-password" placeholder="请输入密码" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block>登录</Button>
          </Form>
        )}
        {oauthEnabled && (
          <Button block className={styles.ssoButton} onClick={() => { window.location.href = '/api/auth/oauth2/start'; }}>
            企业单点登录
          </Button>
        )}
        <Text type="secondary" className={styles.loginHint}>管理员初始密码由部署环境变量 BOOTSTRAP_ADMIN_PASSWORD 配置。</Text>
      </Card>
    </main>
  );
}

interface RoutineCapacityRow {
  key: string;
  personId: string;
  personName: string;
  personType: string;
  iterationId: string;
  iterationLabel: string;
  startDate: string;
  endDate: string;
  capacity: number;
  allocated: number;
  available: number;
}

interface RoutineCapacityMatrixRow {
  key: string;
  personId: string;
  personName: string;
  personType: string;
  iterations: Record<string, RoutineCapacityRow>;
}

const typeMeta: Record<DemandType, { label: string; shortLabel: string; color: string }> = {
  dpo: { label: 'DPO / 产品建设', shortLabel: 'DPO', color: 'blue' },
  routine: { label: '日常事项', shortLabel: '日常', color: 'green' },
};

const statusMeta: Record<WorkStatus, { label: string; color: string }> = {
  planned: { label: '待安排', color: 'default' },
  in_progress: { label: '进行中', color: 'processing' },
  done: { label: '已完成', color: 'success' },
  risk: { label: '有风险', color: 'warning' },
};

const makeId = () => `work-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function personIdForUser(plan: PlanState, user: AuthUser) {
  return plan.people.find((person) => person.id === user.personId || person.account.toLowerCase() === user.account.toLowerCase())?.id ?? user.personId;
}

function blankPlanForTeam(user: AuthUser): PlanState {
  const next = structuredClone(seedPlan);
  const creator = next.people[0]!;
  next.people = [{
    ...creator,
    id: user.personId,
    name: user.displayName,
    account: user.account,
    permissionRoleIds: ['role-admin'],
  }];
  next.quarters = next.quarters.map((quarter) => ({ ...quarter, workItems: [] }));
  next.workItems = [];
  next.currentUserId = user.personId;
  return next;
}

export default function RollingPlanPage() {
  const [plan, setPlan] = useState<PlanState>(() => structuredClone(seedPlan));
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(true);
  const [planVersion, setPlanVersion] = useState(0);
  const [planHydrated, setPlanHydrated] = useState(false);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [teamChanging, setTeamChanging] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [quarterModalOpen, setQuarterModalOpen] = useState(false);
  const [planVersions, setPlanVersions] = useState<PlanVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [personTypeFilter, setPersonTypeFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | DemandType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | WorkStatus>('all');
  const [query, setQuery] = useState('');
  const [insightView, setInsightView] = useState<InsightView>('iteration');
  const [collapsedPeople, setCollapsedPeople] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<WorkItem | null>(null);
  const [workModalOpen, setWorkModalOpen] = useState(false);
  const [routineCapacityOpen, setRoutineCapacityOpen] = useState(false);
  const [capacityDemandType, setCapacityDemandType] = useState<CapacityView>('routine');
  const [capacityPerson, setCapacityPerson] = useState<Person | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workForm] = Form.useForm<WorkItemFormValues>();
  const [capacityForm] = Form.useForm<{ iterationCapacityDays: number }>();
  const [quarterForm] = Form.useForm<QuarterFormValues>();
  const [teamForm] = Form.useForm<TeamFormValues>();
  const collaboration = useCollaboration(plan, planVersion, planHydrated && Boolean(authUser),
    workModalOpen || settingsOpen || quarterModalOpen || Boolean(capacityPerson) || restoreModalOpen, setPlan);
  const requireSaved = () => {
    if (collaboration.canLeave()) return true;
    message.warning('请等待保存完成；如有冲突，请先导出草稿并重新加载');
    return false;
  };

  useEffect(() => {
    let active = true;
    getAuthConfig().then(({ oauthEnabled: ssoEnabled, passwordEnabled: localEnabled }) => {
      if (active) {
        setOauthEnabled(ssoEnabled);
        setPasswordEnabled(localEnabled);
      }
    }).catch(() => undefined);
    getCurrentUser()
      .then(async ({ user }) => {
        if (!active) return;
        setAuthUser(user);
        bindApiTeam(user.teamId);
        try {
          const [remote, teamResult] = await Promise.all([getPlan(), getTeams()]);
          if (!active) return;
          setTeams(teamResult.teams);
          const normalized = normalizePlanQuarters(remote.plan);
          setPlan({ ...normalized, currentUserId: personIdForUser(normalized, user) });
          setPlanVersion(remote.version);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            const teamResult = await getTeams();
            if (!active) return;
            setTeams(teamResult.teams);
            setPlan({ ...structuredClone(seedPlan), currentUserId: personIdForUser(seedPlan, user) });
            setPlanVersion(0);
          } else {
            throw error;
          }
        }
        setPlanHydrated(true);
        setAuthLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        if (!(error instanceof ApiError && error.status === 401)) {
          setAuthError(error instanceof TypeError ? '无法连接服务端，请先启动 PostgreSQL 与 API 服务' : error instanceof Error ? error.message : '无法连接服务端');
        }
        setAuthLoading(false);
      });
    return () => { active = false; };
  }, []);

  const handleLogin = async (account: string, password: string) => {
    try {
      setAuthError('');
      const result = await login(account, password);
      setAuthUser(result.user);
      bindApiTeam(result.user.teamId);
      const [remote, teamResult] = await Promise.all([
        getPlan().catch((error) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }),
        getTeams(),
      ]);
      setTeams(teamResult.teams);
      const nextPlan = normalizePlanQuarters(remote?.plan ?? structuredClone(seedPlan));
      setPlan({ ...nextPlan, currentUserId: personIdForUser(nextPlan, result.user) });
      setPlanVersion(remote?.version ?? 0);
      setPlanHydrated(true);
    } catch (error) {
      setAuthError(error instanceof TypeError ? '无法连接服务端，请先启动 PostgreSQL 与 API 服务' : error instanceof Error ? error.message : '登录失败');
    }
  };

  const handleLogout = async () => {
    if (!requireSaved()) return;
    await logout().catch(() => undefined);
    setAuthUser(null);
    setPlanHydrated(false);
    setPlanVersion(0);
    setTeams([]);
  };

  const resetWorkspaceView = () => {
    setOwnerFilter('all');
    setPersonTypeFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
    setQuery('');
    setCollapsedPeople(new Set());
    setSettingsOpen(false);
    setRestoreModalOpen(false);
  };

  const loadTeamWorkspace = async (user: AuthUser, blankWhenMissing = false) => {
    bindApiTeam(user.teamId);
    const remote = await getPlan().catch((error) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    });
    const fallback = blankWhenMissing ? blankPlanForTeam(user) : structuredClone(seedPlan);
    const nextPlan = normalizePlanQuarters(remote?.plan ?? fallback);
    setPlan({ ...nextPlan, currentUserId: personIdForUser(nextPlan, user) });
    setPlanVersion(remote?.version ?? 0);
    resetWorkspaceView();
  };

  const handleTeamChange = async (teamId: string) => {
    if (!authUser || teamId === authUser.teamId) return;
    if (!requireSaved()) return;
    setTeamChanging(true);
    setPlanHydrated(false);
    try {
      const { user } = await switchTeam(teamId);
      setAuthUser(user);
      await loadTeamWorkspace(user, true);
      setPlanHydrated(true);
      message.success(`已切换到 ${user.teamName}`);
    } catch (error) {
      message.error('团队加载失败，请重新加载页面：' + (error instanceof Error ? error.message : '请求失败'));
    } finally {
      setTeamChanging(false);
    }
  };

  const submitTeam = async () => {
    const values = await teamForm.validateFields();
    if (!requireSaved()) return;
    setTeamChanging(true);
    setPlanHydrated(false);
    try {
      const result = await createTeam(values.name.trim(), values.code.trim().toUpperCase());
      setTeams(result.teams);
      setAuthUser(result.user);
      await loadTeamWorkspace(result.user, true);
      setPlanHydrated(true);
      setTeamModalOpen(false);
      teamForm.resetFields();
      message.success(`团队「${result.team.name}」创建成功`);
    } catch (error) {
      message.error('团队创建或加载失败，请重新加载页面：' + (error instanceof Error ? error.message : '请求失败'));
    } finally {
      setTeamChanging(false);
    }
  };

  const activeIteration = plan.iterations.find(
    (iteration) => iteration.id === plan.currentIterationId,
  ) ?? plan.iterations[0]!;
  const metrics = useMemo(
    () => planMetrics(plan, activeIteration.id),
    [activeIteration.id, plan],
  );
  const canEditAll = hasPermission(plan, 'plan.edit_all');
  const canEditOwn = hasPermission(plan, 'plan.edit_own');
  const canCreateItem = canEditAll || canEditOwn;
  const canViewTeam = hasPermission(plan, 'team.view');
  const canManageTeam = hasPermission(plan, 'team.manage');

  function openEditItem(item: WorkItem) {
    if (!canEditItem(plan, item.personId)) {
      message.warning('当前身份只能查看该事项');
      return;
    }
    setEditingItem(item);
    workForm.setFieldsValue({ ...item, progress: item.progress ?? 0, allocations: structuredClone(item.allocations) });
    setWorkModalOpen(true);
  }

  const visibleTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return plan.workItems.filter((item) => {
      const person = plan.people.find((candidate) => candidate.id === item.personId);
      const matchesOwner = ownerFilter === 'all' || item.personId === ownerFilter;
      const matchesPersonType = personTypeFilter === 'all' || person?.typeId === personTypeFilter;
      const matchesType = typeFilter === 'all' || item.type === typeFilter;
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchesQuery =
        !normalized ||
        [
          item.code,
          item.title,
          person?.name,
          ...Object.values(item.allocations).map((allocation) => allocation.delivery),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalized);
      return matchesOwner && matchesPersonType && matchesType && matchesStatus && matchesQuery;
    });
  }, [ownerFilter, personTypeFilter, plan.people, plan.workItems, query, statusFilter, typeFilter]);

  const analysisTasks = useMemo(
    () =>
      plan.workItems.filter(
        (item) =>
          (ownerFilter === 'all' || item.personId === ownerFilter) &&
          (personTypeFilter === 'all' || plan.people.find((person) => person.id === item.personId)?.typeId === personTypeFilter) &&
          (typeFilter === 'all' || item.type === typeFilter) &&
          (statusFilter === 'all' || item.status === statusFilter),
      ),
    [ownerFilter, personTypeFilter, plan.people, plan.workItems, statusFilter, typeFilter],
  );

  const analysisPeople = useMemo(
    () =>
      plan.people.filter(
        (person) =>
          (ownerFilter === 'all' || person.id === ownerFilter) &&
          (personTypeFilter === 'all' || person.typeId === personTypeFilter),
      ),
    [ownerFilter, personTypeFilter, plan.people],
  );

  const capacityPeople = useMemo(
    () =>
      analysisPeople.filter((person) =>
        capacityDemandType === 'total'
          ? person.iterationCapacityDays > 0
          : capacityDemandType === 'routine' ? person.routineRatio > 0 : person.dpoRatio > 0,
      ),
    [analysisPeople, capacityDemandType],
  );

  const routineCapacityRows = useMemo<RoutineCapacityRow[]>(
    () =>
      capacityPeople
        .flatMap((person) =>
          plan.iterations.map((iteration) => {
            const allocated = plan.workItems
              .filter((item) => item.personId === person.id && (capacityDemandType === 'total' || item.type === capacityDemandType))
              .reduce((sum, item) => sum + (item.allocations[iteration.id]?.days ?? 0), 0);
            const actualCapacity = personIterationCapacity(person, iteration);
            const capacity = capacityDemandType === 'total'
              ? actualCapacity
              : actualCapacity * (capacityDemandType === 'routine' ? person.routineRatio : person.dpoRatio);
            return {
              key: `${person.id}-${iteration.id}`,
              personId: person.id,
              personName: person.name,
              personType: plan.personnelTypes.find((type) => type.id === person.typeId)?.name ?? '未分类',
              iterationId: iteration.id,
              iterationLabel: iteration.label,
              startDate: iteration.startDate,
              endDate: iteration.endDate,
              capacity,
              allocated,
              available: capacity - allocated,
            };
          }),
        )
        .sort((left, right) => right.available - left.available),
    [capacityPeople, capacityDemandType, plan.iterations, plan.personnelTypes, plan.workItems],
  );

  const routineCapacityMatrix = useMemo<RoutineCapacityMatrixRow[]>(
    () =>
      capacityPeople.map((person) => ({
        key: person.id,
        personId: person.id,
        personName: person.name,
        personType: plan.personnelTypes.find((type) => type.id === person.typeId)?.name ?? '未分类',
        iterations: Object.fromEntries(
          plan.iterations.map((iteration) => [
            iteration.id,
            routineCapacityRows.find(
              (row) => row.personId === person.id && row.iterationId === iteration.id,
            )!,
          ]),
        ),
      })),
    [capacityPeople, plan.iterations, plan.personnelTypes, routineCapacityRows],
  );

  const insightItems = useMemo<InsightItem[]>(() => {
    const totalCapacity = analysisPeople.reduce(
      (sum, person) => sum + personQuarterCapacity(plan, person),
      0,
    );

    if (insightView === 'iteration') {
      return plan.iterations.map((iteration) => {
        const roundCapacity = analysisPeople.reduce(
          (sum, person) => sum + personIterationCapacity(person, iteration),
          0,
        );
        const value = analysisTasks.reduce(
          (sum, item) => sum + (item.allocations[iteration.id]?.days ?? 0),
          0,
        );
        return {
          key: iteration.id,
          label: iteration.label,
          value,
          suffix: '天',
          hint: `容量 ${formatDays(roundCapacity)} 天`,
          ratio: roundCapacity ? value / roundCapacity : 0,
          danger: value > roundCapacity,
          selected: iteration.id === activeIteration.id,
          onClick: () =>
            setPlan((current) => ({
              ...current,
              currentIterationId: iteration.id,
            })),
        };
      });
    }

    if (insightView === 'quarter') {
      const dpoCapacity = analysisPeople.reduce(
        (sum, person) => sum + typeBudget(plan, person, 'dpo'),
        0,
      );
      const routineCapacity = analysisPeople.reduce(
        (sum, person) => sum + typeBudget(plan, person, 'routine'),
        0,
      );
      const dpoDays = analysisTasks
        .filter((item) => item.type === 'dpo')
        .reduce((sum, item) => sum + sumItemDays(item), 0);
      const routineDays = analysisTasks
        .filter((item) => item.type === 'routine')
        .reduce((sum, item) => sum + sumItemDays(item), 0);
      const totalDays = dpoDays + routineDays;
      return [
        {
          key: 'quarter-dpo',
          label: 'DPO 已排',
          value: dpoDays,
          suffix: '天',
          hint: `参考 ${formatDays(dpoCapacity)} 天`,
          ratio: dpoCapacity ? dpoDays / dpoCapacity : 0,
          danger: dpoDays > dpoCapacity,
          onClick: () => {
            setCapacityDemandType('dpo');
            setRoutineCapacityOpen(true);
          },
        },
        {
          key: 'quarter-routine',
          label: '日常已排',
          value: routineDays,
          suffix: '天',
          hint: `参考 ${formatDays(routineCapacity)} 天`,
          ratio: routineCapacity ? routineDays / routineCapacity : 0,
          danger: routineDays > routineCapacity,
          onClick: () => {
            setCapacityDemandType('routine');
            setRoutineCapacityOpen(true);
          },
        },
        {
          key: 'quarter-total',
          label: '季度总投入',
          value: totalDays,
          suffix: '天',
          hint: `容量 ${formatDays(totalCapacity)} 天`,
          ratio: totalCapacity ? totalDays / totalCapacity : 0,
          danger: totalDays > totalCapacity,
          onClick: () => {
            setCapacityDemandType('total');
            setRoutineCapacityOpen(true);
          },
        },
        {
          key: 'quarter-left',
          label: '季度剩余',
          value: totalCapacity - totalDays,
          suffix: '天',
          hint: '尚未排入事项的容量',
          ratio: 0,
          danger: totalCapacity - totalDays < 0,
        },
      ];
    }

    if (insightView === 'person') {
      return analysisPeople.map((person) => {
        const value = analysisTasks
          .filter((item) => item.personId === person.id)
          .reduce((sum, item) => sum + sumItemDays(item), 0);
        const capacity = personQuarterCapacity(plan, person);
        return {
          key: person.id,
          label: person.name,
          value,
          suffix: '天',
          hint: `剩余 ${formatDays(capacity - value)} 天`,
          ratio: capacity ? value / capacity : 0,
          danger: value > capacity,
          selected: ownerFilter === person.id,
        };
      });
    }

    return [...analysisTasks]
      .filter((item) => sumItemDays(item) > 0)
      .sort((left, right) => sumItemDays(right) - sumItemDays(left))
      .slice(0, 8)
      .map((item) => {
        const person = plan.people.find((candidate) => candidate.id === item.personId);
        return {
          key: item.id,
          label: `${item.code} ${item.title}`,
          value: sumItemDays(item),
          suffix: '天',
          hint: `${person?.name ?? '-'} · ${typeMeta[item.type].shortLabel}`,
          ratio: Math.min(sumItemDays(item) / 14, 1),
          onClick: () => openEditItem(item),
        };
      });
  }, [activeIteration.id, analysisPeople, analysisTasks, insightView, ownerFilter, plan]);

  if (authLoading) {
    return <main className={styles.loginPage}><Card className={styles.loginCard} bordered={false}><Text>正在连接团队服务…</Text></Card></main>;
  }
  if (!authUser) {
    return <LoginScreen onLogin={handleLogin} error={authError} oauthEnabled={oauthEnabled} passwordEnabled={passwordEnabled} />;
  }
  if (!planHydrated) {
    return <main className={styles.loginPage}><Card title="团队数据尚未加载">
      <p>{authError || '请重新加载团队数据后继续操作'}</p>
      <Button onClick={() => window.location.reload()}>重新加载</Button>
      <Button onClick={async () => { await logout(); window.location.reload(); }}>退出登录</Button>
    </Card></main>;
  }

  const nextCode = (type: DemandType) => {
    const prefix = type === 'dpo' ? 'D' : 'N';
    const largest = plan.workItems
      .filter((item) => item.code.toUpperCase().startsWith(prefix))
      .reduce((max, item) => {
        const number = Number(item.code.replace(/\D/g, ''));
        return Number.isFinite(number) ? Math.max(max, number) : max;
      }, 0);
    return `${prefix}${String(largest + 1).padStart(2, '0')}`;
  };

  const openCreateItem = (personId?: string, type: DemandType = 'dpo') => {
    if (!canCreateItem) {
      message.warning('当前身份没有维护规划的权限');
      return;
    }
    const editablePersonId = canEditAll
      ? personId ?? plan.people[0]?.id
      : plan.currentUserId;
    setEditingItem(null);
    workForm.resetFields();
    workForm.setFieldsValue({
      personId: editablePersonId,
      type,
      code: nextCode(type),
      status: 'planned',
      progress: 0,
      allocations: {},
    });
    setWorkModalOpen(true);
  };

  const submitWorkItem = async () => {
    const values = await workForm.validateFields();
    if (!canEditAll && values.personId !== plan.currentUserId) {
      message.error('当前身份只能维护分配给自己的事项');
      return;
    }
    const duplicateCode = plan.workItems.some(
      (item) =>
        item.id !== editingItem?.id &&
        item.code.toLowerCase() === values.code.trim().toLowerCase(),
    );
    if (duplicateCode) {
      workForm.setFields([{ name: 'code', errors: ['事项编号已存在'] }]);
      return;
    }
    const overCapacityIteration = plan.iterations.find((iteration) =>
      Number(values.allocations?.[iteration.id]?.days ?? 0) > iterationWorkdays(iteration),
    );
    if (overCapacityIteration) {
      message.error(`${overCapacityIteration.label} 的投入不能超过 ${iterationWorkdays(overCapacityIteration)} 个工作日`);
      return;
    }

    const allocations = Object.fromEntries(
      plan.iterations.flatMap((iteration) => {
        const value = values.allocations?.[iteration.id];
        const delivery = value?.delivery?.trim() ?? '';
        const days = Number(value?.days ?? 0);
        return delivery || days > 0 ? [[iteration.id, { delivery, days }]] : [];
      }),
    );

    const nextItem: WorkItem = {
      id: editingItem?.id ?? makeId(),
      personId: values.personId,
      type: values.type,
      code: values.code.trim().toUpperCase(),
      title: values.title.trim(),
      status: values.status,
      progress: values.progress,
      allocations,
    };

    setPlan((current) => ({
      ...current,
      workItems: editingItem
        ? current.workItems.map((item) => (item.id === editingItem.id ? nextItem : item))
        : [...current.workItems, nextItem],
    }));
    setWorkModalOpen(false);
    message.success(editingItem ? '事项已更新' : '事项已加入规划');
  };

  const deleteItem = (itemId: string) => {
    const target = plan.workItems.find((item) => item.id === itemId);
    if (!target || !canEditItem(plan, target.personId)) {
      message.error('当前身份没有删除该事项的权限');
      return;
    }
    setPlan((current) => ({
      ...current,
      workItems: current.workItems.filter((item) => item.id !== itemId),
    }));
    setWorkModalOpen(false);
    message.success('事项已删除');
  };

  const openCapacityEditor = (person: Person) => {
    if (!canManageTeam) {
      message.warning('当前身份没有调整人员容量的权限');
      return;
    }
    setCapacityPerson(person);
    capacityForm.setFieldsValue({ iterationCapacityDays: person.iterationCapacityDays });
  };

  const submitCapacity = async () => {
    if (!capacityPerson) return;
    const values = await capacityForm.validateFields();
    setPlan((current) => ({
      ...current,
      people: current.people.map((person) =>
        person.id === capacityPerson.id
          ? { ...person, iterationCapacityDays: values.iterationCapacityDays }
          : person,
      ),
    }));
    setCapacityPerson(null);
    message.success('参考容量已更新');
  };

  const openRestoreHistory = async () => {
    setRestoreModalOpen(true);
    setVersionsLoading(true);
    try {
      const result = await getPlanVersions();
      setPlanVersions(result.versions);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本列表加载失败');
    } finally {
      setVersionsLoading(false);
    }
  };

  const restoreVersion = async (backup: PlanVersion) => {
    if (!requireSaved()) return;
    try {
      const result = await restorePlanVersion(backup.id, collaboration.version());
      const normalized = normalizePlanQuarters(result.plan);
      setPlan({ ...normalized, currentUserId: personIdForUser(normalized, authUser) });
      setPlanVersion(result.version);
      setRestoreModalOpen(false);
      message.success(`已恢复 ${backup.backupDate} ${backup.backupSlot} 的备份，当前数据版本为 v${result.version}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本恢复失败');
    }
  };

  const switchQuarter = (quarterId: string) => {
    setPlan((current) => activateQuarter(current, quarterId));
    setOwnerFilter('all');
    setPersonTypeFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
    setQuery('');
    setCollapsedPeople(new Set());
  };

  const openQuarterCreator = () => {
    const currentYear = Number(plan.quarter.match(/\d{4}/)?.[0]) || dayjs().year();
    const quarterCountByYear = plan.quarters.reduce<Map<number, number>>((counts, quarter) => {
      counts.set(quarter.year, (counts.get(quarter.year) ?? 0) + 1);
      return counts;
    }, new Map());
    let targetYear = currentYear;
    while ((quarterCountByYear.get(targetYear) ?? 0) >= 3) targetYear += 1;
    const sequence = (quarterCountByYear.get(targetYear) ?? 0) + 1;
    const existingRanges = plan.quarters
      .filter((quarter) => quarter.year === targetYear)
      .map((quarter) => ({
        start: quarter.iterations[0]?.startDate,
        end: quarter.iterations.at(-1)?.endDate,
      }));
    const candidatePeriods: Array<[string, string]> = [
      [`${targetYear}-01-01`, `${targetYear}-04-30`],
      [`${targetYear}-05-01`, `${targetYear}-08-31`],
      [`${targetYear}-09-01`, `${targetYear}-12-31`],
    ];
    const [startDate, endDate] = candidatePeriods.find(([candidateStart, candidateEnd]) =>
      existingRanges.every((range) => !range.start || !range.end || candidateEnd < range.start || candidateStart > range.end),
    ) ?? candidatePeriods[0]!;
    quarterForm.setFieldsValue({
      name: `${targetYear} 第${sequence}季度`,
      year: targetYear,
      startDate,
      endDate,
    });
    setQuarterModalOpen(true);
  };

  const createQuarter = async () => {
    const values = await quarterForm.validateFields();
    const start = dayjs(values.startDate);
    const end = dayjs(values.endDate);
    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      message.error('季度结束日期不能早于开始日期');
      return;
    }
    if (start.year() !== values.year || end.year() !== values.year) {
      message.error('季度开始与结束日期必须在所选年份内');
      return;
    }
    if (plan.quarters.filter((quarter) => quarter.year === values.year).length >= 3) {
      message.error(`${values.year} 年最多创建 3 个季度`);
      return;
    }
    const overlaps = plan.quarters
      .filter((quarter) => quarter.year === values.year)
      .some((quarter) => {
        const quarterStart = quarter.iterations[0]?.startDate;
        const quarterEnd = quarter.iterations.at(-1)?.endDate;
        return quarterStart && quarterEnd && values.startDate <= quarterEnd && values.endDate >= quarterStart;
      });
    if (overlaps) {
      message.error('季度日期范围不能与同年份已有季度重叠');
      return;
    }
    if (plan.quarters.some((quarter) => quarter.name.trim().toLowerCase() === values.name.trim().toLowerCase())) {
      message.error('季度名称已存在');
      return;
    }
    const quarterId = `quarter-${values.year}-${Date.now()}`;
    const iterations = buildWorkdayIterations(values.startDate, values.endDate, quarterId);
    if (iterations.length === 0) {
      message.error('季度日期范围内没有可用工作日');
      return;
    }
    const quarter: QuarterPlan = {
      id: quarterId,
      name: values.name.trim(),
      year: values.year,
      currentIterationId: iterations[0]!.id,
      iterations,
      workItems: [],
    };
    setPlan((current) => {
      const synchronized = syncActiveQuarter(current);
      return activateQuarter({
        ...synchronized,
        quarters: [...synchronized.quarters, quarter],
      }, quarter.id);
    });
    setQuarterModalOpen(false);
    setOwnerFilter('all');
    setPersonTypeFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
    setQuery('');
    setCollapsedPeople(new Set());
    message.success(`已创建 ${quarter.name}，并生成 ${iterations.length} 个双周迭代`);
  };

  const toggleCollapsed = (personId: string) => {
    setCollapsedPeople((current) => {
      const next = new Set(current);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  };

  const displayedPeople = plan.people.filter(
      (person) =>
        (ownerFilter === 'all' || person.id === ownerFilter) &&
        (personTypeFilter === 'all' || person.typeId === personTypeFilter) &&
        visibleTasks.some((item) => item.personId === person.id),
  );

  const totalColumns = 5 + plan.iterations.length * 2 + 2;
  const boardMinWidth = 710 + plan.iterations.length * 183;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Title level={1}>季度双周滚动规划</Title>
          <Text>
            {dayjs(plan.iterations[0]?.startDate).format('YYYY.MM.DD')} —{' '}
            {dayjs(plan.iterations.at(-1)?.endDate).format('YYYY.MM.DD')} ·{' '}
            {plan.iterations.length} 轮规划 · 交付内容和人天独立记录
          </Text>
        </div>
        <Space wrap className={styles.headerActions}>
          <Select
            className={styles.quarterSelect}
            value={plan.activeQuarterId}
            onChange={switchQuarter}
            disabled={!canEditAll}
            options={plan.quarters
              .slice()
              .sort((left, right) => left.year - right.year || left.name.localeCompare(right.name))
              .map((quarter) => ({ label: quarter.name, value: quarter.id }))}
          />
          {canEditAll && (
            <Button onClick={openQuarterCreator}>新建季度</Button>
          )}
          <div className={styles.identitySwitcher}>
            <Select
              aria-label="当前团队"
              className={styles.teamSelect}
              value={authUser.teamId}
              loading={teamChanging}
              onChange={handleTeamChange}
              options={teams.map((team) => ({ label: `${team.name} · ${team.code}`, value: team.id }))}
            />
            <Button
              className={styles.createTeamButton}
              icon={<TeamOutlined />}
              onClick={() => setTeamModalOpen(true)}
              disabled={teamChanging}
            >
              新建团队
            </Button>
            <span className={styles.identityDivider} />
            <span className={styles.userIdentity}>
              <small>当前用户</small>
              <Text strong>{authUser.displayName}</Text>
            </span>
          </div>
          {canViewTeam && (
            <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
              团队与权限
            </Button>
          )}
          {canEditAll && (
            <Button icon={<ReloadOutlined />} onClick={openRestoreHistory}>恢复版本</Button>
          )}
          {canCreateItem && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateItem()}>
              新增事项
            </Button>
          )}
          <Button icon={<LogoutOutlined />} onClick={handleLogout}>退出登录</Button>
        </Space>
      </header>

      <div className={styles.content}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Tag color={collaboration.status === '已同步' ? 'green' : 'orange'}>{planHydrated ? collaboration.status : '团队数据未就绪，请重新加载'}</Tag>
          <Button size="small" onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `planning-draft-${authUser.teamCode}.json`;
            link.click();
            URL.revokeObjectURL(url);
          }}>导出本地草稿</Button>
          <Popconfirm title="重新加载会丢弃未保存的修改，请先导出草稿" onConfirm={() => window.location.reload()}>
            <Button size="small">重新加载</Button>
          </Popconfirm>
        </Space>
        <Row gutter={[12, 12]} className={styles.summary}>
          <Col xs={12} lg={6}>
            <ProCard className={styles.metricCard}>
              <Statistic title={`${activeIteration.label} 已排事项`} value={metrics.iterationItemCount} suffix="项" />
            </ProCard>
          </Col>
          <Col xs={12} lg={6}>
            <ProCard className={styles.metricCard}>
              <Statistic
                title="本轮预计投入 / 总容量"
                value={metrics.iterationDays}
                suffix={`/ ${formatDays(metrics.iterationCapacity)} 人天`}
              />
            </ProCard>
          </Col>
          <Col xs={12} lg={6}>
            <ProCard className={styles.metricCard}>
              <Statistic title="本轮日常事项投入" value={metrics.routineDays} suffix="人天" />
            </ProCard>
          </Col>
          <Col xs={12} lg={6}>
            <ProCard className={styles.metricCard}>
              <Statistic
                title="本轮超载人员"
                value={metrics.overloadedPeople}
                suffix="人"
                prefix={metrics.overloadedPeople ? <WarningFilled /> : undefined}
                valueStyle={{ color: metrics.overloadedPeople ? '#c45745' : undefined }}
              />
            </ProCard>
          </Col>
        </Row>

        <section className={styles.insights}>
          <div className={styles.insightHeader}>
            <Space>
              <BarChartOutlined />
              <Text strong>投入分析</Text>
            </Space>
            <div className={styles.tabs}>
              {([
                ['iteration', '迭代投入'],
                ['quarter', '季度投入'],
                ['person', '单人投入'],
                ['task', '事项投入'],
              ] as [InsightView, string][]).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={insightView === value ? styles.activeTab : styles.tab}
                  onClick={() => setInsightView(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <Text type="secondary" className={styles.insightTip}>
              点击人员、事项或迭代可定位到明细
            </Text>
          </div>
          <div
            className={`${styles.insightBody} ${insightView === 'task' ? styles.scrollableInsightBody : ''}`}
            tabIndex={0}
            aria-label="投入分析卡片，可横向滚动"
          >
            {insightItems.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`${styles.insightItem} ${item.selected ? styles.selectedInsight : ''}`}
                onClick={item.onClick}
                disabled={!item.onClick}
              >
                <Text strong ellipsis={{ tooltip: item.label }}>{item.label}</Text>
                <div>
                  <b className={item.danger ? styles.dangerText : ''}>{formatDays(item.value)}</b>
                  <small>{item.suffix} · {item.hint}</small>
                </div>
                <Progress
                  percent={Math.min(100, Math.round(item.ratio * 100))}
                  showInfo={false}
                  size="small"
                  status={item.danger ? 'exception' : 'normal'}
                />
              </button>
            ))}
            {insightItems.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </div>
        </section>

        <section className={styles.toolbar}>
          <label>
            <span>当前迭代</span>
            <Select
              value={activeIteration.id}
              onChange={(value) => setPlan((current) => ({ ...current, currentIterationId: value }))}
              disabled={!canEditAll}
              options={plan.iterations.map((iteration) => ({
                label: `${iteration.label} · ${dayjs(iteration.startDate).format('M/D')}—${dayjs(iteration.endDate).format('M/D')}`,
                value: iteration.id,
              }))}
            />
          </label>
          <label>
            <span>负责人</span>
            <Select
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[
                { label: '全部人员', value: 'all' },
                ...plan.people.map((person) => ({ label: person.name, value: person.id })),
              ]}
            />
          </label>
          <label>
            <span>人员类型</span>
            <Select
              value={personTypeFilter}
              onChange={setPersonTypeFilter}
              options={[
                { label: '全部人员类型', value: 'all' },
                ...plan.personnelTypes.map((type) => ({ label: type.name, value: type.id })),
              ]}
            />
          </label>
          <label>
            <span>需求类型</span>
            <Select
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { label: '全部类型', value: 'all' },
                { label: 'DPO', value: 'dpo' },
                { label: '日常事项', value: 'routine' },
              ]}
            />
          </label>
          <label>
            <span>状态</span>
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { label: '全部状态', value: 'all' },
                ...Object.entries(statusMeta).map(([value, meta]) => ({ label: meta.label, value })),
              ]}
            />
          </label>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="检索编号、事项、交付内容或负责人"
            className={styles.search}
          />
          <Text type="secondary" className={styles.matchCount}>
            匹配 {visibleTasks.length} 项 · {displayedPeople.length} 人
          </Text>
          <Space.Compact className={styles.collapseActions}>
            <Button
              size="small"
              icon={<DownOutlined />}
              onClick={() => setCollapsedPeople(new Set())}
              disabled={displayedPeople.length === 0 || !displayedPeople.some((person) => collapsedPeople.has(person.id))}
            >
              全部展开
            </Button>
            <Button
              size="small"
              icon={<RightOutlined />}
              onClick={() => setCollapsedPeople(new Set(displayedPeople.map((person) => person.id)))}
              disabled={displayedPeople.length === 0 || displayedPeople.every((person) => collapsedPeople.has(person.id))}
            >
              全部折叠
            </Button>
          </Space.Compact>
        </section>

        <section className={styles.boardCard}>
          <div className={styles.boardScroller}>
            <table className={styles.board} style={{ minWidth: boardMinWidth }}>
              <colgroup>
                <col className={styles.personColumn} />
                <col className={styles.typeColumn} />
                <col className={styles.codeColumn} />
                <col className={styles.taskColumn} />
                <col className={styles.statusColumn} />
                {plan.iterations.map((iteration) => (
                  <Fragment key={iteration.id}>
                    <col className={styles.iterationDeliveryCol} />
                    <col className={styles.iterationDaysCol} />
                  </Fragment>
                ))}
                <col style={{ width: 78 }} />
                <col style={{ width: 80 }} />
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2} className={`${styles.personColumn} ${styles.fixedA}`}>负责人</th>
                  <th rowSpan={2} className={`${styles.typeColumn} ${styles.fixedB}`}>类型</th>
                  <th rowSpan={2} className={`${styles.codeColumn} ${styles.fixedC}`}>编号</th>
                  <th rowSpan={2} className={`${styles.taskColumn} ${styles.fixedD}`}>具体事项</th>
                  <th rowSpan={2} className={`${styles.statusColumn} ${styles.fixedE}`}>状态 / 进度</th>
                  {plan.iterations.map((iteration) => (
                    <th
                      key={iteration.id}
                      colSpan={2}
                      className={iteration.id === activeIteration.id ? styles.focusedHeader : ''}
                    >
                      {iteration.label}{' '}
                      <small>
                        {dayjs(iteration.startDate).format('M/D')}—{dayjs(iteration.endDate).format('M/D')} · {iterationWorkdays(iteration)} 工作日
                      </small>
                    </th>
                  ))}
                  <th rowSpan={2} className={styles.totalColumn}>季度已排</th>
                  <th rowSpan={2} className={styles.remainColumn}>剩余容量</th>
                </tr>
                <tr>
                  {plan.iterations.map((iteration) => (
                    <Fragment key={iteration.id}>
                      <th className={`${styles.deliveryColumn} ${iteration.id === activeIteration.id ? styles.focusedHeader : ''}`}>阶段交付</th>
                      <th className={`${styles.daysColumn} ${iteration.id === activeIteration.id ? styles.focusedHeader : ''}`}>人天</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedPeople.map((person) => {
                  const isCollapsed = collapsedPeople.has(person.id);
                  const allPersonTasks = plan.workItems.filter((item) => item.personId === person.id);
                  const personTasks = visibleTasks.filter((item) => item.personId === person.id);
                  const roundDays = personIterationDays(plan, person.id, activeIteration.id);
                  const roundCapacity = personIterationCapacity(person, activeIteration);
                  const quarterDays = personTotalDays(plan, person.id);
                  const quarterCapacity = personQuarterCapacity(plan, person);
                  return (
                    <Fragment key={person.id}>
                      <tr className={styles.personSummaryRow}>
                        <td className={`${styles.fixedA} ${styles.personSummaryName}`}>
                          <button type="button" className={styles.foldButton} onClick={() => toggleCollapsed(person.id)}>
                            {isCollapsed ? <RightOutlined /> : <DownOutlined />}
                          </button>
                          <strong>{person.name}</strong>
                          <span>
                            {plan.personnelTypes.find((type) => type.id === person.typeId)?.name ?? '未分类'}
                          </span>
                        </td>
                        <td colSpan={4} className={`${styles.fixedB} ${styles.personSummaryInfo}`}>
                          <span>
                            本轮 {allPersonTasks.filter((item) => (item.allocations[activeIteration.id]?.days ?? 0) > 0).length} 项 ·{' '}
                            <b className={roundDays > roundCapacity ? styles.dangerText : ''}>
                              {formatDays(roundDays)}/{formatDays(roundCapacity)} 天
                            </b>
                          </span>
                          {canManageTeam && (
                            <Button
                              type="link"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={() => openCapacityEditor(person)}
                            >
                              调整容量
                            </Button>
                          )}
                        </td>
                        <td colSpan={plan.iterations.length * 2} className={styles.personSummaryHint}>
                          DPO 与日常分别汇总；点击事项直接修改交付和投入
                        </td>
                        <td className={styles.numeric}>{formatDays(quarterDays)} 天</td>
                        <td className={`${styles.numeric} ${quarterCapacity - quarterDays < 0 ? styles.dangerText : ''}`}>
                          {formatDays(quarterCapacity - quarterDays)} 天
                        </td>
                      </tr>
                      {!isCollapsed && (['dpo', 'routine'] as DemandType[]).map((type) => {
                        const tasks = personTasks.filter((item) => item.type === type);
                        if (tasks.length === 0) return null;
                        const allTypeTasks = allPersonTasks.filter((item) => item.type === type);
                        const typeDays = personTypeDays(plan, person.id, type);
                        const budget = typeBudget(plan, person, type);
                        const typeRoundDays = allTypeTasks.reduce(
                          (sum, item) => sum + (item.allocations[activeIteration.id]?.days ?? 0),
                          0,
                        );
                        const typeRoundCapacity = roundCapacity * (type === 'routine' ? person.routineRatio : person.dpoRatio);
                        return (
                          <Fragment key={`${person.id}-${type}`}>
                            <tr className={styles.typeSummaryRow}>
                              <td className={styles.fixedA}></td>
                              <td className={styles.fixedB}><Tag color={typeMeta[type].color}>{typeMeta[type].shortLabel}</Tag></td>
                              <td colSpan={3} className={styles.fixedGroupInfo}>
                                本轮 {allTypeTasks.filter((item) => (item.allocations[activeIteration.id]?.days ?? 0) > 0).length} 项 ·{' '}
                                {formatDays(typeRoundDays)} 天 / 参考{' '}
                                {formatDays(typeRoundCapacity)} 天
                              </td>
                              <td colSpan={plan.iterations.length * 2}>
                                本类型季度已排 {formatDays(typeDays)} 天 · 预算 {formatDays(budget)} 天
                              </td>
                              <td className={styles.numeric}>{formatDays(typeDays)} 天</td>
                              <td className={`${styles.numeric} ${budget - typeDays < 0 ? styles.dangerText : ''}`}>
                                {formatDays(budget - typeDays)} 天
                              </td>
                            </tr>
                            {tasks.map((item) => (
                              <tr key={item.id} className={styles.taskRow}>
                                <td className={styles.fixedA}></td>
                                <td className={styles.fixedB}><Tag color={typeMeta[item.type].color}>{typeMeta[item.type].shortLabel}</Tag></td>
                                <td className={`${styles.fixedC} ${styles.codeCell}`}>
                                  <button type="button" disabled={!canEditItem(plan, item.personId)} onClick={() => openEditItem(item)}>{item.code}</button>
                                </td>
                                <td className={`${styles.fixedD} ${styles.taskCell}`}>
                                  <button type="button" disabled={!canEditItem(plan, item.personId)} title={item.title} onClick={() => openEditItem(item)}>{item.title}</button>
                                </td>
                                <td className={`${styles.fixedE} ${styles.statusCell}`}>
                                  <Tag color={statusMeta[item.status].color}>{statusMeta[item.status].label}</Tag>
                                  <Progress percent={item.progress ?? 0} size="small" />
                                </td>
                                {plan.iterations.map((iteration) => {
                                  const allocation = item.allocations[iteration.id];
                                  const focused = iteration.id === activeIteration.id;
                                  return (
                                    <Fragment key={iteration.id}>
                                      <td className={focused ? styles.focusedCell : ''}>
                                        <button
                                          type="button"
                                          className={`${styles.cellButton} ${!allocation?.delivery ? styles.emptyCell : ''}`}
                                          disabled={!canEditItem(plan, item.personId)}
                                          onClick={() => openEditItem(item)}
                                        >
                                          {allocation?.delivery || '＋'}
                                        </button>
                                      </td>
                                      <td className={`${styles.numeric} ${focused ? styles.focusedCell : ''}`}>
                                        <button type="button" className={styles.cellButton} disabled={!canEditItem(plan, item.personId)} onClick={() => openEditItem(item)}>
                                          {allocation?.days ? formatDays(allocation.days) : '·'}
                                        </button>
                                      </td>
                                    </Fragment>
                                  );
                                })}
                                <td className={styles.numeric}>{formatDays(sumItemDays(item))} 天</td>
                                <td className={styles.numeric}>—</td>
                              </tr>
                            ))}
                            <tr className={styles.addRow}>
                              <td className={styles.fixedA}></td>
                              <td className={styles.fixedB}></td>
                              <td colSpan={3} className={styles.fixedAddCell}>
                                {canEditItem(plan, person.id) && (
                                  <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => openCreateItem(person.id, type)}>
                                    添加{type === 'dpo' ? ' DPO' : '日常'}事项
                                  </Button>
                                )}
                              </td>
                              <td colSpan={plan.iterations.length * 2 + 2}></td>
                            </tr>
                          </Fragment>
                        );
                      })}
                      {!isCollapsed && quarterDays > quarterCapacity && (
                        <tr className={styles.warningRow}>
                          <td colSpan={totalColumns}>
                            <WarningFilled /> {person.name} 的季度投入已超过参考容量 {formatDays(quarterDays - quarterCapacity)} 天
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {displayedPeople.length === 0 && (
                  <tr><td colSpan={totalColumns}><Empty description="没有匹配事项" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className={styles.legend}>
          点击事项或迭代格可编辑。每项一行；日常事项可从任意轮开始并跨轮交付。人天按同一行的各轮投入汇总；DPO / 日常参考容量按每个人配置的比例计算。
        </p>
      </div>

      <Modal
        title="新建团队"
        open={teamModalOpen}
        onOk={submitTeam}
        onCancel={() => setTeamModalOpen(false)}
        okText="创建并进入"
        cancelText="取消"
        confirmLoading={teamChanging}
        destroyOnHidden
      >
        <Text type="secondary">创建后你将成为该团队的系统管理员，并自动切换到新团队。</Text>
        <Form form={teamForm} layout="vertical" preserve={false} style={{ marginTop: 16 }}>
          <Form.Item
            label="团队名称"
            name="name"
            rules={[{ required: true, message: '请输入团队名称' }, { min: 2, max: 50, message: '请输入 2–50 个字符' }]}
          >
            <Input placeholder="例如：增长产品团队" maxLength={50} />
          </Form.Item>
          <Form.Item
            label="团队编码"
            name="code"
            normalize={(value) => String(value || '').toUpperCase()}
            rules={[
              { required: true, message: '请输入团队编码' },
              { pattern: /^[A-Z0-9][A-Z0-9-]{1,19}$/, message: '请输入 2–20 位大写字母、数字或连字符' },
            ]}
          >
            <Input placeholder="例如：GROWTH-PRODUCT" maxLength={20} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新建季度"
        open={quarterModalOpen}
        onOk={createQuarter}
        onCancel={() => setQuarterModalOpen(false)}
        okText="创建季度"
        cancelText="取消"
        destroyOnHidden
      >
        <Text type="secondary">每年最多创建 3 个季度。系统会根据日期范围自动生成连续的双周迭代。</Text>
        <Form form={quarterForm} layout="vertical" preserve={false} style={{ marginTop: 16 }}>
          <Row gutter={14}>
            <Col span={16}>
              <Form.Item label="季度名称" name="name" rules={[{ required: true, message: '请输入季度名称' }, { max: 30 }]}>
                <Input placeholder="例如：2027 第1季度" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="年份" name="year" rules={[{ required: true, message: '请输入年份' }]}>
                <InputNumber min={2000} max={2100} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={14}>
            <Col span={12}>
              <Form.Item label="开始日期" name="startDate" rules={[{ required: true, message: '请选择开始日期' }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="结束日期" name="endDate" rules={[{ required: true, message: '请选择结束日期' }]}>
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        width={760}
        title="恢复规划版本"
        open={restoreModalOpen}
        onCancel={() => setRestoreModalOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Text type="secondary">每天定时生成 3 份备份，此处展示最近 50 份。恢复不会删除已有备份。</Text>
        <Table<PlanVersion>
          rowKey="id"
          size="small"
          loading={versionsLoading}
          pagination={false}
          style={{ marginTop: 14 }}
          dataSource={planVersions}
          locale={{ emptyText: '暂无可恢复版本' }}
          columns={[
            { title: '备份日期', dataIndex: 'backupDate', width: 130, render: (value: string) => dayjs(value).format('YYYY-MM-DD') },
            { title: '备份时点', dataIndex: 'backupSlot', width: 100 },
            { title: '数据版本', dataIndex: 'sourceVersion', width: 100, render: (value: number) => `v${value}` },
            { title: '实际生成时间', dataIndex: 'createdAt', width: 190, render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm:ss') },
            {
              title: '操作',
              width: 100,
              render: (_: unknown, record: PlanVersion) => (
                <Popconfirm
                  title={`恢复 ${record.backupDate} ${record.backupSlot} 的备份？`}
                  description="恢复后会生成新的版本记录。"
                  okText="恢复"
                  cancelText="取消"
                  onConfirm={() => restoreVersion(record)}
                >
                  <Button type="link" size="small">恢复</Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        width={760}
        title={editingItem ? '编辑具体事项' : '新增具体事项'}
        open={workModalOpen}
        onOk={submitWorkItem}
        onCancel={() => setWorkModalOpen(false)}
        okText="保存修改"
        cancelText="取消"
        destroyOnHidden
        footer={(_, { OkBtn, CancelBtn }) => (
          <Flex justify={editingItem ? 'space-between' : 'flex-end'}>
            {editingItem && (
              <Popconfirm
                title="确定删除这项需求？"
                onConfirm={() => deleteItem(editingItem.id)}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button danger icon={<DeleteOutlined />}>删除事项</Button>
              </Popconfirm>
            )}
            <Space><CancelBtn /><OkBtn /></Space>
          </Flex>
        )}
      >
        <Form form={workForm} layout="vertical" preserve={false} requiredMark="optional">
          <Row gutter={14}>
            <Col span={8}>
              <Form.Item label="负责人" name="personId" rules={[{ required: true, message: '请选择负责人' }]}>
                <Select
                  disabled={!canEditAll}
                  options={plan.people
                    .filter((person) => person.status === 'active' || person.id === editingItem?.personId)
                    .map((person) => ({ label: person.name, value: person.id }))}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="需求类型" name="type" rules={[{ required: true }]}>
                <Select options={Object.entries(typeMeta).map(([value, meta]) => ({ value, label: meta.label }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="状态" name="status" rules={[{ required: true }]}>
                <Select options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label }))} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={14}>
            <Col span={8}>
              <Form.Item
                label="事项编号"
                name="code"
                rules={[
                  { required: true, message: '请输入事项编号' },
                  { max: 16, message: '最多 16 个字符' },
                ]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item
                label="具体事项"
                name="title"
                rules={[
                  { required: true, message: '请输入具体事项' },
                  { max: 70, message: '最多 70 个字符' },
                ]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="完成进度" name="progress" rules={[{ required: true, message: '请输入完成进度' }]}>
                <InputNumber min={0} max={100} precision={0} addonAfter="%" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Title level={5} className={styles.formSectionTitle}>各轮交付与预计投入</Title>
          <div className={styles.cycleEditor}>
            {plan.iterations.map((iteration) => (
              <div className={styles.cycleRow} key={iteration.id}>
                <div>
                  <Text strong>{iteration.label} 迭代</Text>
                  <Text type="secondary">
                    {dayjs(iteration.startDate).format('YYYY.MM.DD')} — {dayjs(iteration.endDate).format('YYYY.MM.DD')}
                  </Text>
                </div>
                <Form.Item name={['allocations', iteration.id, 'delivery']} noStyle>
                  <Input placeholder="本轮要完成什么" />
                </Form.Item>
                <Form.Item name={['allocations', iteration.id, 'days']} noStyle>
                  <InputNumber min={0} max={iterationWorkdays(iteration)} step={0.5} placeholder="人天" addonAfter="天" />
                </Form.Item>
              </div>
            ))}
          </div>
          <Text type="secondary">未安排的迭代保持空白；人天支持 0.5 天精度。</Text>
        </Form>
      </Modal>

      <Modal
        width={980}
        title={`${capacityDemandType === 'total' ? '总投入' : typeMeta[capacityDemandType].shortLabel}容量速查`}
        open={routineCapacityOpen}
        onCancel={() => setRoutineCapacityOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Text type="secondary">
          按当前负责人和人员类型筛选范围，展示每个人每个迭代的{capacityDemandType === 'total' ? '总' : typeMeta[capacityDemandType].shortLabel}容量、已排投入与可用人天；点击单元格可定位到对应迭代。
        </Text>
        <Table<RoutineCapacityMatrixRow>
          rowKey="key"
          size="small"
          pagination={false}
          scroll={{ x: 320 + plan.iterations.length * 150, y: 460 }}
          style={{ marginTop: 14 }}
          dataSource={routineCapacityMatrix}
          locale={{ emptyText: `当前筛选范围没有配置${capacityDemandType === 'total' ? '可投入容量' : `${typeMeta[capacityDemandType].shortLabel}投入比例`}的人员` }}
          onRow={(record) => ({
            onClick: () => {
              setOwnerFilter(record.personId);
              setRoutineCapacityOpen(false);
            },
            style: { cursor: 'pointer' },
          })}
          columns={[
            { title: '人员', dataIndex: 'personName', width: 100, fixed: 'left' },
            { title: '人员类型', dataIndex: 'personType', width: 90, fixed: 'left' },
            ...plan.iterations.map((iteration) => ({
              title: (
                <div>
                  <b>{iteration.label}</b>
                  <br />
                  <Text type="secondary">
                    {dayjs(iteration.startDate).format('M/D')}—{dayjs(iteration.endDate).format('M/D')}
                  </Text>
                </div>
              ),
              key: iteration.id,
              width: 150,
              render: (_: unknown, record: RoutineCapacityMatrixRow) => {
                const cell = record.iterations[iteration.id]!;
                return (
                  <div
                    onClick={(event) => {
                      event.stopPropagation();
                      setOwnerFilter(record.personId);
                      setPlan((current) => ({ ...current, currentIterationId: iteration.id }));
                      setRoutineCapacityOpen(false);
                    }}
                  >
                    <Tag color={cell.available > 0 ? 'green' : cell.available < 0 ? 'red' : 'default'}>
                      {cell.available > 0 ? `可排 ${formatDays(cell.available)} 天` : cell.available < 0 ? `超出 ${formatDays(Math.abs(cell.available))} 天` : '已排满'}
                    </Tag>
                    <br />
                    <Text type="secondary">
                      已排 {formatDays(cell.allocated)} / 容量 {formatDays(cell.capacity)} 天
                    </Text>
                  </div>
                );
              },
            })),
          ]}
        />
      </Modal>

      <Modal
        title="调整人员参考容量"
        open={Boolean(capacityPerson)}
        onOk={submitCapacity}
        onCancel={() => setCapacityPerson(null)}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={capacityForm} layout="vertical" preserve={false}>
          <Form.Item label="负责人">
            <Input value={capacityPerson?.name} disabled />
          </Form.Item>
          <Form.Item
            label="标准双周可投入人天"
            name="iterationCapacityDays"
            rules={[{ required: true, message: '请输入每轮容量' }]}
          >
            <InputNumber min={0.5} max={10} step={0.5} addonAfter="天" className={styles.fullWidth} />
          </Form.Item>
          <Text type="secondary">以 10 个工作日为标准双周容量；不足 10 个工作日的迭代会按实际工作日折算，DPO / 日常预算再按个人比例计算。</Text>
        </Form>
      </Modal>

      <TeamSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        plan={plan}
        setPlan={setPlan}
        teamName={authUser.teamName}
      />
    </main>
  );
}
