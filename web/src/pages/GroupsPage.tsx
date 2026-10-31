import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import type { StudentGroup, StudentOption } from '../types';

const { Text } = Typography;

export default function GroupsPage() {
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(false);

  const [editTarget, setEditTarget] = useState<StudentGroup | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const [memberTarget, setMemberTarget] = useState<StudentGroup | null>(null);
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, s] = await Promise.all([api.get<StudentGroup[]>('/api/groups'), api.get<StudentOption[]>('/api/users/students')]);
      setGroups(g);
      setStudents(s);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditTarget(null);
    editForm.resetFields();
    setEditOpen(true);
  }

  function openEdit(g: StudentGroup) {
    setEditTarget(g);
    editForm.setFieldsValue({ name: g.name, remark: g.remark });
    setEditOpen(true);
  }

  async function saveGroup() {
    const v = await editForm.validateFields();
    setSaving(true);
    try {
      if (editTarget) {
        await api.put(`/api/groups/${editTarget.id}`, v);
        message.success('分组已更新');
      } else {
        await api.post('/api/groups', v);
        message.success('分组已创建');
      }
      setEditOpen(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeGroup(id: number) {
    try {
      await api.del(`/api/groups/${id}`);
      message.success('分组已删除');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function openMembers(g: StudentGroup) {
    setMemberTarget(g);
    setMemberOpen(true);
    setMemberLoading(true);
    try {
      const res = await api.get<{ userIds: number[] }>(`/api/groups/${g.id}/members`);
      setMemberIds(res.userIds);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setMemberLoading(false);
    }
  }

  async function saveMembers() {
    if (!memberTarget) return;
    setSaving(true);
    try {
      await api.put(`/api/groups/${memberTarget.id}/members`, { userIds: memberIds });
      message.success('成员已保存');
      setMemberOpen(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { title: '分组名称', dataIndex: 'name', render: (n: string) => <Text strong>{n}</Text> },
    { title: '说明', dataIndex: 'remark', render: (r: string | null) => r || <span className="liti-muted">-</span> },
    {
      title: '人数',
      dataIndex: 'memberCount',
      width: 110,
      render: (c: number) => <Tag color={c ? 'blue' : 'default'}>{c} 人</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (t: number) => <span className="liti-muted">{new Date(t).toLocaleString()}</span>,
    },
    {
      title: '操作',
      key: 'op',
      width: 210,
      render: (_: unknown, g: StudentGroup) => (
        <Space size={12}>
          <a onClick={() => openMembers(g)}>管成员</a>
          <a onClick={() => openEdit(g)}>改名</a>
          <Popconfirm
            title="删除这个分组？"
            description="已发布的试卷如果只对「这个分组」可见，删组后就没人能看到了（记得回去改一下可见范围）"
            okText="删除"
            cancelText="取消"
            onConfirm={() => removeGroup(g.id)}
          >
            <a style={{ color: '#e5484d' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="liti-page">
      <PageHeader
        title="学生分组"
        description="把学生按班/按层次分组，发布试卷时可以直接选「这个组可见」，不用一个个点名字。分组是活的：往组里加人之后，之前发给这个组的试卷他也能看到。"
        extra={
          <Space>
            <Button icon={<UserAddOutlined />} onClick={load}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建分组
            </Button>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="分组只影响「谁能看到哪些卷子」"
        description="试卷挂的是分组，不是某一次的名单快照 —— 所以开学初分好组，中途转来学生塞进组里，之前的卷子他立刻就能看到。删除分组会把这份卷子从可见范围里摘掉。"
      />

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={groups}
          loading={loading}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="还没有分组。先建一个「一班」，再把学生塞进去"
                imageStyle={{ height: 60 }}
              />
            ),
          }}
          pagination={false}
        />
      </Card>

      <Modal
        title={editTarget ? '修改分组' : '新建分组'}
        open={editOpen}
        onOk={saveGroup}
        onCancel={() => setEditOpen(false)}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="name"
            label="分组名称"
            rules={[{ required: true, message: '请输入分组名称' }]}
            tooltip="发布试卷时按这个名字挑组"
          >
            <Input placeholder="例如：高一（1）班 / 提高班" maxLength={64} />
          </Form.Item>
          <Form.Item name="remark" label="说明" tooltip="给自己看的备注，学生看不到">
            <Input.TextArea rows={2} maxLength={255} placeholder="例如：2026 级，班主任王老师" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`管理成员${memberTarget ? ` · ${memberTarget.name}` : ''}`}
        open={memberOpen}
        onOk={saveMembers}
        onCancel={() => setMemberOpen(false)}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={620}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="只有学生能进分组"
          description="教师和管理员账号不出现在这里；学生账号可以在「用户管理」里创建。"
        />
        <Select
          mode="multiple"
          allowClear
          loading={memberLoading}
          style={{ width: '100%' }}
          placeholder={students.length ? '搜索并勾选学生' : '还没有学生账号，先去「用户管理」创建'}
          value={memberIds}
          onChange={(v) => setMemberIds(v)}
          optionFilterProp="label"
          maxTagCount="responsive"
          options={students.map((s) => ({ value: s.id, label: `${s.displayName}（${s.username}）` }))}
          notFoundContent="没有可选的学生"
        />
        <Space style={{ marginTop: 10 }} size={10} wrap>
          <Button size="small" icon={<TeamOutlined />} onClick={() => setMemberIds(students.map((s) => s.id))}>
            全选（{students.length} 人）
          </Button>
          <Button size="small" onClick={() => setMemberIds([])}>
            清空
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            已选 {memberIds.length} 人
          </Text>
        </Space>
      </Modal>
    </div>
  );
}
