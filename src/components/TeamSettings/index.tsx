import { DeleteOutlined, EditOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import {
  Button,
  Checkbox,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import type { Dispatch, SetStateAction } from 'react';
import { useMemo, useState } from 'react';
import type {
  PermissionKey,
  PermissionRole,
  Person,
  PersonnelType,
  PlanState,
  Iteration,
} from '@/types/planning';
import { hasPermission, permissionCatalog } from '@/utils/permissions';
import styles from './index.less';

const { Text, Title } = Typography;

interface TeamSettingsProps {
  open: boolean;
  onClose: () => void;
  plan: PlanState;
  setPlan: Dispatch<SetStateAction<PlanState>>;
}

interface PersonFormValues {
  name: string;
  account: string;
  typeId: string;
  permissionRoleIds: string[];
  status: 'active' | 'disabled';
  iterationCapacityDays: number;
  dpoRatioPercent: number;
  routineRatioPercent: number;
}

interface TypeFormValues {
  name: string;
  code: string;
  color: string;
  description: string;
  active: boolean;
}

interface RoleFormValues {
  name: string;
  description: string;
  permissions: PermissionKey[];
}

interface IterationFormValues {
  label: string;
  startDate: string;
  endDate: string;
}

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function TeamSettings({ open, onClose, plan, setPlan }: TeamSettingsProps) {
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [personModalOpen, setPersonModalOpen] = useState(false);
  const [editingType, setEditingType] = useState<PersonnelType | null>(null);
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<PermissionRole | null>(null);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingIteration, setEditingIteration] = useState<Iteration | null>(null);
  const [iterationModalOpen, setIterationModalOpen] = useState(false);
  const [personForm] = Form.useForm<PersonFormValues>();
  const [typeForm] = Form.useForm<TypeFormValues>();
  const [roleForm] = Form.useForm<RoleFormValues>();
  const [iterationForm] = Form.useForm<IterationFormValues>();

  const canManagePeople = hasPermission(plan, 'team.manage');
  const canManageTypes = hasPermission(plan, 'type.manage');
  const canManageIterations = hasPermission(plan, 'iteration.manage');
  const canManagePermissions = hasPermission(plan, 'permission.manage');

  const openPersonEditor = (person?: Person) => {
    const target = person ?? null;
    setEditingPerson(target);
    personForm.resetFields();
    personForm.setFieldsValue(
      target
        ? {
            ...target,
            dpoRatioPercent: target.dpoRatio * 100,
            routineRatioPercent: target.routineRatio * 100,
          }
        : {
            status: 'active',
            typeId: plan.personnelTypes.find((type) => type.active)?.id,
            permissionRoleIds: ['role-member'],
            iterationCapacityDays: 8,
            dpoRatioPercent: 70,
            routineRatioPercent: 30,
          },
    );
    setPersonModalOpen(true);
  };

  const submitPerson = async () => {
    const values = await personForm.validateFields();
    const duplicate = plan.people.some(
      (person) =>
        person.id !== editingPerson?.id &&
        person.account.toLowerCase() === values.account.trim().toLowerCase(),
    );
    if (duplicate) {
      personForm.setFields([{ name: 'account', errors: ['登录账号已存在'] }]);
      return;
    }
    if (editingPerson?.id === plan.currentUserId && values.status === 'disabled') {
      message.error('不能停用当前登录身份');
      return;
    }
    if (Math.abs(values.dpoRatioPercent + values.routineRatioPercent - 100) > 0.001) {
      message.error('DPO 占比与日常占比合计必须为 100%');
      return;
    }

    const record: Person = {
      id: editingPerson?.id ?? makeId('person'),
      name: values.name.trim(),
      account: values.account.trim().toLowerCase(),
      typeId: values.typeId,
      permissionRoleIds: canManagePermissions
        ? values.permissionRoleIds
        : editingPerson?.permissionRoleIds ?? ['role-member'],
      status: values.status,
      iterationCapacityDays: values.iterationCapacityDays,
      dpoRatio: values.dpoRatioPercent / 100,
      routineRatio: values.routineRatioPercent / 100,
    };
    setPlan((current) => ({
      ...current,
      people: editingPerson
        ? current.people.map((person) => (person.id === editingPerson.id ? record : person))
        : [...current.people, record],
    }));
    setPersonModalOpen(false);
    message.success(editingPerson ? '人员信息已更新' : '人员已添加');
  };

  const openTypeEditor = (type?: PersonnelType) => {
    const target = type ?? null;
    setEditingType(target);
    typeForm.resetFields();
    typeForm.setFieldsValue(
      target ?? {
        color: 'blue',
        active: true,
      },
    );
    setTypeModalOpen(true);
  };

  const submitType = async () => {
    const values = await typeForm.validateFields();
    const duplicate = plan.personnelTypes.some(
      (type) =>
        type.id !== editingType?.id &&
        type.code.toLowerCase() === values.code.trim().toLowerCase(),
    );
    if (duplicate) {
      typeForm.setFields([{ name: 'code', errors: ['类型编码已存在'] }]);
      return;
    }
    const record: PersonnelType = {
      id: editingType?.id ?? makeId('type'),
      name: values.name.trim(),
      code: values.code.trim().toUpperCase(),
      color: values.color,
      description: values.description?.trim() ?? '',
      active: values.active,
    };
    setPlan((current) => ({
      ...current,
      personnelTypes: editingType
        ? current.personnelTypes.map((type) => (type.id === editingType.id ? record : type))
        : [...current.personnelTypes, record],
    }));
    setTypeModalOpen(false);
    message.success(editingType ? '人员类型已更新' : '人员类型已添加');
  };

  const openRoleEditor = (role?: PermissionRole) => {
    const target = role ?? null;
    setEditingRole(target);
    roleForm.resetFields();
    roleForm.setFieldsValue(
      target ?? {
        permissions: ['plan.view', 'team.view'],
      },
    );
    setRoleModalOpen(true);
  };

  const submitRole = async () => {
    const values = await roleForm.validateFields();
    const record: PermissionRole = {
      id: editingRole?.id ?? makeId('role'),
      name: values.name.trim(),
      description: values.description.trim(),
      permissions: values.permissions,
      builtIn: editingRole?.builtIn ?? false,
    };
    setPlan((current) => ({
      ...current,
      permissionRoles: editingRole
        ? current.permissionRoles.map((role) => (role.id === editingRole.id ? record : role))
        : [...current.permissionRoles, record],
    }));
    setRoleModalOpen(false);
    message.success(editingRole ? '权限角色已更新' : '权限角色已添加');
  };

  const openIterationEditor = (iteration?: Iteration) => {
    const target = iteration ?? null;
    setEditingIteration(target);
    iterationForm.resetFields();
    iterationForm.setFieldsValue(
      target ?? {
        label: `R${plan.iterations.length + 1}`,
        startDate: dayjs().format('YYYY-MM-DD'),
        endDate: dayjs().add(13, 'day').format('YYYY-MM-DD'),
      },
    );
    setIterationModalOpen(true);
  };

  const submitIteration = async () => {
    const values = await iterationForm.validateFields();
    if (values.endDate < values.startDate) {
      iterationForm.setFields([{ name: 'endDate', errors: ['结束日期不能早于开始日期'] }]);
      return;
    }
    const duplicate = plan.iterations.some(
      (iteration) =>
        iteration.id !== editingIteration?.id &&
        iteration.label.trim().toLowerCase() === values.label.trim().toLowerCase(),
    );
    if (duplicate) {
      iterationForm.setFields([{ name: 'label', errors: ['迭代名称已存在'] }]);
      return;
    }
    const record: Iteration = {
      id: editingIteration?.id ?? makeId('iteration'),
      label: values.label.trim().toUpperCase(),
      startDate: values.startDate,
      endDate: values.endDate,
    };
    setPlan((current) => ({
      ...current,
      iterations: editingIteration
        ? current.iterations.map((iteration) => (iteration.id === editingIteration.id ? record : iteration))
        : [...current.iterations, record],
    }));
    setIterationModalOpen(false);
    message.success(editingIteration ? '迭代已更新' : '迭代已添加');
  };

  const deleteIteration = (iteration: Iteration) => {
    if (iteration.id === plan.currentIterationId) {
      message.error('当前迭代不能删除，请先切换当前迭代');
      return;
    }
    if (plan.workItems.some((item) => item.allocations[iteration.id])) {
      message.error('该迭代已有事项投入，不能删除');
      return;
    }
    setPlan((current) => ({
      ...current,
      iterations: current.iterations.filter((candidate) => candidate.id !== iteration.id),
    }));
    message.success('迭代已删除');
  };

  const peopleColumns = useMemo<ProColumns<Person>[]>(
    () => [
      {
        title: '人员',
        dataIndex: 'name',
        render: (_, person) => (
          <div className={styles.identityCell}>
            <Text strong>{person.name}</Text>
            <Text type="secondary">@{person.account}</Text>
          </div>
        ),
      },
      {
        title: '人员类型',
        dataIndex: 'typeId',
        render: (_, person) => {
          const type = plan.personnelTypes.find((candidate) => candidate.id === person.typeId);
          return type ? <Tag color={type.color}>{type.name}</Tag> : <Tag>未设置</Tag>;
        },
      },
      {
        title: '权限角色',
        dataIndex: 'permissionRoleIds',
        render: (_, person) => (
          <Space size={[4, 4]} wrap>
            {person.permissionRoleIds.map((roleId) => (
              <Tag key={roleId} icon={<SafetyCertificateOutlined />}>
                {plan.permissionRoles.find((role) => role.id === roleId)?.name ?? '未知角色'}
              </Tag>
            ))}
          </Space>
        ),
      },
      {
        title: '每轮容量',
        dataIndex: 'iterationCapacityDays',
        width: 100,
        render: (_, person) => `${person.iterationCapacityDays} 天`,
      },
      {
        title: 'DPO / 日常',
        dataIndex: 'dpoRatio',
        width: 110,
        render: (_, person) => `${Math.round(person.dpoRatio * 100)}% / ${Math.round(person.routineRatio * 100)}%`,
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 80,
        render: (_, person) => (
          <Tag color={person.status === 'active' ? 'success' : 'default'}>
            {person.status === 'active' ? '启用' : '停用'}
          </Tag>
        ),
      },
      {
        title: '操作',
        valueType: 'option',
        width: 80,
        render: (_, person) =>
          canManagePeople ? (
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openPersonEditor(person)}>
              编辑
            </Button>
          ) : null,
      },
    ],
    [canManagePeople, plan.permissionRoles, plan.personnelTypes],
  );

  const typeColumns: ProColumns<PersonnelType>[] = [
    { title: '类型名称', dataIndex: 'name', render: (_, type) => <Tag color={type.color}>{type.name}</Tag> },
    { title: '编码', dataIndex: 'code', width: 120 },
    { title: '说明', dataIndex: 'description', ellipsis: true },
    {
      title: '人数',
      width: 80,
      render: (_, type) => plan.people.filter((person) => person.typeId === type.id).length,
    },
    {
      title: '状态',
      width: 80,
      render: (_, type) => <Tag color={type.active ? 'success' : 'default'}>{type.active ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 80,
      render: (_, type) =>
        canManageTypes ? (
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openTypeEditor(type)}>
            编辑
          </Button>
        ) : null,
    },
  ];

  const roleColumns: ProColumns<PermissionRole>[] = [
    { title: '角色名称', dataIndex: 'name', width: 150 },
    { title: '说明', dataIndex: 'description', ellipsis: true },
    {
      title: '已授权限',
      dataIndex: 'permissions',
      render: (_, role) => (
        <Space size={[4, 4]} wrap>
          {role.permissions.map((permission) => (
            <Tag key={permission}>{permissionCatalog.find((item) => item.key === permission)?.name}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '人数',
      width: 80,
      render: (_, role) => plan.people.filter((person) => person.permissionRoleIds.includes(role.id)).length,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 80,
      render: (_, role) =>
        canManagePermissions ? (
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openRoleEditor(role)}>
            编辑
          </Button>
        ) : null,
    },
  ];

  const iterationColumns: ProColumns<Iteration>[] = [
    { title: '迭代名称', dataIndex: 'label', width: 120, render: (_, iteration) => <Tag color={iteration.id === plan.currentIterationId ? 'cyan' : 'default'}>{iteration.label}</Tag> },
    { title: '开始日期', dataIndex: 'startDate', width: 140, render: (_, iteration) => dayjs(iteration.startDate).format('YYYY-MM-DD') },
    { title: '结束日期', dataIndex: 'endDate', width: 140, render: (_, iteration) => dayjs(iteration.endDate).format('YYYY-MM-DD') },
    {
      title: '事项数',
      width: 80,
      render: (_, iteration) => plan.workItems.filter((item) => item.allocations[iteration.id]).length,
    },
    {
      title: '状态',
      width: 90,
      render: (_, iteration) => (
        <Tag color={iteration.id === plan.currentIterationId ? 'cyan' : 'default'}>
          {iteration.id === plan.currentIterationId ? '当前' : '可用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 150,
      render: (_, iteration) =>
        canManageIterations ? (
          <Space size={0}>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openIterationEditor(iteration)}>
              编辑
            </Button>
            <Popconfirm
              title="删除这个迭代？"
              description="仅能删除没有事项投入且不是当前迭代的迭代。"
              onConfirm={() => deleteIteration(iteration)}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ) : null,
    },
  ];

  return (
    <>
      <Drawer
        title="团队与权限"
        width={980}
        open={open}
        onClose={onClose}
        destroyOnClose
      >
        <div className={styles.intro}>
          <Title level={4}>组织模型与权限边界</Title>
          <Text type="secondary">人员类型描述工作属性，权限角色决定可执行的系统操作，两者相互独立。</Text>
        </div>
        <Tabs
          items={[
            {
              key: 'people',
              label: `人员（${plan.people.length}）`,
              children: (
                <ProTable<Person>
                  rowKey="id"
                  search={false}
                  pagination={false}
                  options={false}
                  dataSource={plan.people}
                  columns={peopleColumns}
                  scroll={{ x: 850 }}
                  toolBarRender={() =>
                    canManagePeople
                      ? [
                          <Button key="add-person" type="primary" icon={<PlusOutlined />} onClick={() => openPersonEditor()}>
                            添加人员
                          </Button>,
                        ]
                      : []
                  }
                />
              ),
            },
            {
              key: 'types',
              label: `人员类型（${plan.personnelTypes.length}）`,
              children: (
                <ProTable<PersonnelType>
                  rowKey="id"
                  search={false}
                  pagination={false}
                  options={false}
                  dataSource={plan.personnelTypes}
                  columns={typeColumns}
                  toolBarRender={() =>
                    canManageTypes
                      ? [
                          <Button key="add-type" type="primary" icon={<PlusOutlined />} onClick={() => openTypeEditor()}>
                            添加类型
                          </Button>,
                        ]
                      : []
                  }
                />
              ),
            },
            {
              key: 'iterations',
              label: `迭代（${plan.iterations.length}）`,
              children: (
                <ProTable<Iteration>
                  rowKey="id"
                  search={false}
                  pagination={false}
                  options={false}
                  dataSource={plan.iterations}
                  columns={iterationColumns}
                  toolBarRender={() =>
                    canManageIterations
                      ? [
                          <Button key="add-iteration" type="primary" icon={<PlusOutlined />} onClick={() => openIterationEditor()}>
                            添加迭代
                          </Button>,
                        ]
                      : []
                  }
                />
              ),
            },
            {
              key: 'roles',
              label: `权限角色（${plan.permissionRoles.length}）`,
              children: (
                <ProTable<PermissionRole>
                  rowKey="id"
                  search={false}
                  pagination={false}
                  options={false}
                  dataSource={plan.permissionRoles}
                  columns={roleColumns}
                  scroll={{ x: 850 }}
                  toolBarRender={() =>
                    canManagePermissions
                      ? [
                          <Button key="add-role" type="primary" icon={<PlusOutlined />} onClick={() => openRoleEditor()}>
                            添加角色
                          </Button>,
                        ]
                      : []
                  }
                />
              ),
            },
          ]}
        />
      </Drawer>

      <Modal
        title={editingPerson ? '编辑人员' : '添加人员'}
        open={personModalOpen}
        onOk={submitPerson}
        onCancel={() => setPersonModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={650}
        destroyOnHidden
      >
        <Form form={personForm} layout="vertical" preserve={false}>
          <Row gutter={14}>
            <Col span={12}>
              <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入姓名' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="登录账号" name="account" rules={[{ required: true, message: '请输入登录账号' }]}>
                <Input prefix="@" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={14}>
            <Col span={12}>
              <Form.Item label="人员类型" name="typeId" rules={[{ required: true, message: '请选择人员类型' }]}>
                <Select
                  options={plan.personnelTypes.filter((type) => type.active || type.id === editingPerson?.typeId).map((type) => ({
                    label: type.name,
                    value: type.id,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="状态" name="status" rules={[{ required: true }]}>
                <Select options={[{ label: '启用', value: 'active' }, { label: '停用', value: 'disabled' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="权限角色" name="permissionRoleIds" rules={[{ required: true, message: '至少选择一个角色' }]}>
            <Select
              mode="multiple"
              disabled={!canManagePermissions}
              options={plan.permissionRoles.map((role) => ({ label: role.name, value: role.id }))}
            />
          </Form.Item>
          <Row gutter={14}>
            <Col span={12}>
              <Form.Item label="每轮可投入人天" name="iterationCapacityDays" rules={[{ required: true }]}>
                <InputNumber min={0.5} max={14} step={0.5} addonAfter="天" className={styles.fullWidth} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Space.Compact block>
                <Form.Item label="DPO 占比" name="dpoRatioPercent" rules={[{ required: true }]}>
                  <InputNumber min={0} max={100} addonAfter="%" className={styles.ratioInput} />
                </Form.Item>
                <Form.Item label="日常占比" name="routineRatioPercent" rules={[{ required: true }]}>
                  <InputNumber min={0} max={100} addonAfter="%" className={styles.ratioInput} />
                </Form.Item>
              </Space.Compact>
            </Col>
          </Row>
          <Text type="secondary">两项比例可按人员分别配置，例如 60% / 40%、80% / 20%；合计必须为 100%。</Text>
        </Form>
      </Modal>

      <Modal
        title={editingIteration ? '编辑迭代' : '添加迭代'}
        open={iterationModalOpen}
        onOk={submitIteration}
        onCancel={() => setIterationModalOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={iterationForm} layout="vertical" preserve={false}>
          <Form.Item label="迭代名称" name="label" rules={[{ required: true, message: '请输入迭代名称' }]}>
            <Input placeholder="例如：R8" />
          </Form.Item>
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
          <Text type="secondary">删除迭代前需要先清空该迭代下的事项投入。</Text>
        </Form>
      </Modal>

      <Modal
        title={editingType ? '编辑人员类型' : '添加人员类型'}
        open={typeModalOpen}
        onOk={submitType}
        onCancel={() => setTypeModalOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={typeForm} layout="vertical" preserve={false}>
          <Row gutter={14}>
            <Col span={12}>
              <Form.Item label="类型名称" name="name" rules={[{ required: true, message: '请输入类型名称' }]}>
                <Input placeholder="例如：开发" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="类型编码" name="code" rules={[{ required: true, message: '请输入类型编码' }]}>
                <Input placeholder="例如：DEV" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Row gutter={14}>
            <Col span={12}>
              <Form.Item label="标签颜色" name="color" rules={[{ required: true }]}>
                <Select options={['blue', 'green', 'purple', 'orange', 'cyan', 'magenta'].map((color) => ({ label: <Tag color={color}>{color}</Tag>, value: color }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="启用" name="active" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title={editingRole ? '编辑权限角色' : '添加权限角色'}
        open={roleModalOpen}
        onOk={submitRole}
        onCancel={() => setRoleModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={680}
        destroyOnHidden
      >
        <Form form={roleForm} layout="vertical" preserve={false}>
          <Form.Item label="角色名称" name="name" rules={[{ required: true, message: '请输入角色名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="角色说明" name="description" rules={[{ required: true, message: '请输入角色说明' }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="权限范围" name="permissions" rules={[{ required: true, message: '至少选择一个权限' }]}>
            <Checkbox.Group className={styles.permissionGrid}>
              {permissionCatalog.map((permission) => (
                <Checkbox key={permission.key} value={permission.key}>
                  <span className={styles.permissionLabel}>
                    <Text strong>{permission.name}</Text>
                    <Text type="secondary">{permission.description}</Text>
                  </span>
                </Checkbox>
              ))}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
