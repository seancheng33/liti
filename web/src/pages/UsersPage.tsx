import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Popconfirm, Radio, Select, Space, Table, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useAuth } from '../auth';
import PageHeader from '../components/PageHeader';

const ROLE_LABEL: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生' };
const ROLE_COLOR: Record<string, string> = { admin: 'red', teacher: 'blue', student: 'green' };

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: string;
  status: string;
  provider: string;
  created_at: number;
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const [data, setData] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [resetForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<UserRow[]>('/api/users'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate() {
    const values = await createForm.validateFields();
    try {
      await api.post('/api/users', values);
      message.success('已创建用户');
      setCreateOpen(false);
      createForm.resetFields();
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function onEdit() {
    const values = await editForm.validateFields();
    try {
      await api.put(`/api/users/${editTarget!.id}`, values);
      message.success('已保存');
      setEditTarget(null);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function onResetPassword() {
    const values = await resetForm.validateFields();
    try {
      await api.post(`/api/users/${resetTarget!.id}/reset-password`, { password: values.password });
      message.success('密码已重置');
      setResetTarget(null);
      resetForm.resetFields();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function onDelete(id: number) {
    try {
      await api.del(`/api/users/${id}`);
      message.success('已删除');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username' },
    { title: '显示名', dataIndex: 'display_name' },
    {
      title: '角色',
      dataIndex: 'role',
      width: 100,
      render: (r: string) => <Tag color={ROLE_COLOR[r]}>{ROLE_LABEL[r] ?? r}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: string) => (s === 'active' ? <Tag color="green">正常</Tag> : <Tag color="default">停用</Tag>),
    },
    {
      title: '来源',
      dataIndex: 'provider',
      width: 90,
      render: (p: string) => (p === 'local' ? '本地' : 'SSO'),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (t: number) => new Date(t).toLocaleString(),
    },
    {
      title: '操作',
      key: 'op',
      width: 200,
      render: (_: unknown, r: UserRow) => (
        <Space>
          <a
            onClick={() => {
              setEditTarget(r);
              editForm.setFieldsValue({ displayName: r.display_name, role: r.role, status: r.status });
            }}
          >
            编辑
          </a>
          <a
            onClick={() => {
              setResetTarget(r);
              resetForm.resetFields();
            }}
          >
            重置密码
          </a>
          <Popconfirm title="确认删除该用户？" onConfirm={() => onDelete(r.id)} disabled={r.id === me?.userId}>
            <a style={{ color: r.id === me?.userId ? '#ccc' : undefined }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="liti-page">
      <PageHeader
        title="用户管理"
        description="创建账号、调整角色、重置密码。删除用户会一并清理其答卷数据。"
        extra={
          <Button
            icon={<PlusOutlined />}
            type="primary"
            onClick={() => {
              setCreateOpen(true);
              createForm.resetFields();
              createForm.setFieldsValue({ role: 'student' });
            }}
          >
            新建用户
          </Button>
        }
      />

      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={false}
          locale={{ emptyText: '还没有账号，点右上角「新建用户」创建第一个' }}
        />
      </Card>

      {/* 新建用户 */}
      <Modal title="新建用户" open={createOpen} onOk={onCreate} onCancel={() => setCreateOpen(false)}>
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
            tooltip="登录用，创建后不能修改"
          >
            <Input placeholder="字母、数字、下划线" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名" rules={[{ required: true, message: '请输入显示名' }]} tooltip="成绩单和答卷列表里显示的名字">
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}
            tooltip="至少 6 位；创建后可以随时在列表里重置"
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]} tooltip="学生只能答题；教师可管题库和试卷；管理员还能管用户和站点配置">
            <Radio.Group>
              <Radio value="student">学生</Radio>
              <Radio value="teacher">教师</Radio>
              <Radio value="admin">管理员</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑用户 */}
      <Modal title={`编辑用户：${editTarget?.username ?? ''}`} open={!!editTarget} onOk={onEdit} onCancel={() => setEditTarget(null)}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="displayName" label="显示名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'student', label: '学生' },
                { value: 'teacher', label: '教师' },
                { value: 'admin', label: '管理员' },
              ]}
            />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Radio.Group>
              <Radio value="active">正常</Radio>
              <Radio value="disabled">停用</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码 */}
      <Modal title={`重置密码：${resetTarget?.username ?? ''}`} open={!!resetTarget} onOk={onResetPassword} onCancel={() => setResetTarget(null)}>
        <Form form={resetForm} layout="vertical">
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
