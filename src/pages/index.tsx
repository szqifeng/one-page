import {
  BarChartOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  WarningFilled,
} from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import {
  Button,
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
import TeamSettings from '@/components/TeamSettings';
import { seedPlan } from '@/data/seed';
import type {
  Allocation,
  DemandType,
  Person,
  PlanState,
  WorkItem,
  WorkStatus,
} from '@/types/planning';
import {
  formatDays,
  personIterationDays,
  personQuarterCapacity,
  personTotalDays,
  personTypeDays,
  planMetrics,
  sumItemDays,
  typeBudget,
} from '@/utils/planning';
import {
  canEditItem,
  hasPermission,
} from '@/utils/permissions';
import { clearPlan, loadPlan, savePlan } from '@/utils/storage';
import styles from './index.less';

const { Text, Title } = Typography;

type InsightView = 'iteration' | 'quarter' | 'person' | 'task';

interface WorkItemFormValues {
  personId: string;
  type: DemandType;
  code: string;
  title: string;
  status: WorkStatus;
  allocations: Record<string, Partial<Allocation>>;
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

export default function RollingPlanPage() {
  const [plan, setPlan] = useState<PlanState>(() => loadPlan());
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
  const [capacityDemandType, setCapacityDemandType] = useState<DemandType>('routine');
  const [capacityPerson, setCapacityPerson] = useState<Person | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workForm] = Form.useForm<WorkItemFormValues>();
  const [capacityForm] = Form.useForm<{ iterationCapacityDays: number }>();

  useEffect(() => savePlan(plan), [plan]);

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
    workForm.setFieldsValue({ ...item, allocations: structuredClone(item.allocations) });
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

  const routineCapacityRows = useMemo<RoutineCapacityRow[]>(
    () =>
      analysisPeople
        .flatMap((person) =>
          plan.iterations.map((iteration) => {
            const allocated = plan.workItems
              .filter((item) => item.personId === person.id && item.type === capacityDemandType)
              .reduce((sum, item) => sum + (item.allocations[iteration.id]?.days ?? 0), 0);
            const capacity = person.iterationCapacityDays * (
              capacityDemandType === 'routine' ? person.routineRatio : person.dpoRatio
            );
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
    [analysisPeople, capacityDemandType, plan.iterations, plan.personnelTypes, plan.workItems],
  );

  const routineCapacityMatrix = useMemo<RoutineCapacityMatrixRow[]>(
    () =>
      analysisPeople.map((person) => ({
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
    [analysisPeople, plan.iterations, plan.personnelTypes, routineCapacityRows],
  );

  const insightItems = useMemo<InsightItem[]>(() => {
    const totalCapacity = analysisPeople.reduce(
      (sum, person) => sum + personQuarterCapacity(plan, person),
      0,
    );

    if (insightView === 'iteration') {
      const roundCapacity = analysisPeople.reduce(
        (sum, person) => sum + person.iterationCapacityDays,
        0,
      );
      return plan.iterations.map((iteration) => {
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
          onClick: () => setOwnerFilter(person.id),
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

  const resetDemo = () => {
    clearPlan();
    setPlan(structuredClone(seedPlan));
    setOwnerFilter('all');
    setPersonTypeFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
    setQuery('');
    setCollapsedPeople(new Set());
    message.success('已恢复六人示例数据');
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
          <div className={styles.identitySwitcher}>
            <span>当前身份</span>
            <Select
              value={plan.currentUserId}
              onChange={(currentUserId) => setPlan((current) => ({ ...current, currentUserId }))}
              options={plan.people
                .filter((person) => person.status === 'active')
                .map((person) => {
                  const type = plan.personnelTypes.find((candidate) => candidate.id === person.typeId);
                  return { label: `${person.name} · ${type?.name ?? '未分类'}`, value: person.id };
                })}
              popupMatchSelectWidth={220}
            />
          </div>
          {canViewTeam && (
            <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
              团队与权限
            </Button>
          )}
          {canEditAll && (
            <Popconfirm
              title="恢复六人示例数据？"
              description="当前本地修改将被清除。"
              onConfirm={resetDemo}
              okText="恢复"
              cancelText="取消"
            >
              <Button icon={<ReloadOutlined />}>恢复示例</Button>
            </Popconfirm>
          )}
          {canCreateItem && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreateItem()}>
              新增事项
            </Button>
          )}
        </Space>
      </header>

      <div className={styles.content}>
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
          <div className={styles.insightBody}>
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
            <table className={styles.board}>
              <colgroup>
                <col style={{ width: 126 }} />
                <col style={{ width: 88 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 88 }} />
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
                  <th rowSpan={2} className={`${styles.statusColumn} ${styles.fixedE}`}>状态</th>
                  {plan.iterations.map((iteration) => (
                    <th
                      key={iteration.id}
                      colSpan={2}
                      className={iteration.id === activeIteration.id ? styles.focusedHeader : ''}
                    >
                      {iteration.label}{' '}
                      <small>
                        {dayjs(iteration.startDate).format('M/D')}—{dayjs(iteration.endDate).format('M/D')}
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
                            <b className={roundDays > person.iterationCapacityDays ? styles.dangerText : ''}>
                              {formatDays(roundDays)}/{formatDays(person.iterationCapacityDays)} 天
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
                        return (
                          <Fragment key={`${person.id}-${type}`}>
                            <tr className={styles.typeSummaryRow}>
                              <td className={styles.fixedA}></td>
                              <td className={styles.fixedB}><Tag color={typeMeta[type].color}>{typeMeta[type].shortLabel}</Tag></td>
                              <td colSpan={3} className={styles.fixedGroupInfo}>
                                本轮 {allTypeTasks.filter((item) => (item.allocations[activeIteration.id]?.days ?? 0) > 0).length} 项 ·{' '}
                                {formatDays(typeRoundDays)} 天 / 参考{' '}
                                {formatDays(person.iterationCapacityDays * (type === 'routine' ? person.routineRatio : person.dpoRatio))} 天
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
            <Col span={16}>
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
                  <InputNumber min={0} max={14} step={0.5} placeholder="人天" addonAfter="天" />
                </Form.Item>
              </div>
            ))}
          </div>
          <Text type="secondary">未安排的迭代保持空白；人天支持 0.5 天精度。</Text>
        </Form>
      </Modal>

      <Modal
        width={980}
        title={`${typeMeta[capacityDemandType].shortLabel}容量速查`}
        open={routineCapacityOpen}
        onCancel={() => setRoutineCapacityOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Text type="secondary">
          按当前负责人和人员类型筛选范围，展示每个人每个迭代的{typeMeta[capacityDemandType].shortLabel}参考容量、已排投入与可用人天；点击单元格可定位到对应迭代。
        </Text>
        <Table<RoutineCapacityMatrixRow>
          rowKey="key"
          size="small"
          pagination={false}
          scroll={{ x: 320 + plan.iterations.length * 150, y: 460 }}
          style={{ marginTop: 14 }}
          dataSource={routineCapacityMatrix}
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
            label="每轮可投入人天"
            name="iterationCapacityDays"
            rules={[{ required: true, message: '请输入每轮容量' }]}
          >
            <InputNumber min={0.5} max={14} step={0.5} addonAfter="天" className={styles.fullWidth} />
          </Form.Item>
          <Text type="secondary">该容量用于本轮负载预警和季度剩余计算；DPO / 日常预算按每个人的配置比例计算。</Text>
        </Form>
      </Modal>

      <TeamSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        plan={plan}
        setPlan={setPlan}
      />
    </main>
  );
}
