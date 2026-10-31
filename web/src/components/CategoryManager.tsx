import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Category } from '../types';

interface Props {
  /** 分类变动后通知外部刷新（比如题库页的下拉） */
  onChanged?: () => void;
}

/** 分类管理：管理员与教师都可使用 */
export default function CategoryManager({ onChanged }: Props) {
  const [data, setData] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<Category | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<Category[]>('/api/categories'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSave() {
    const values = await form.validateFields();
    try {
      if (editTarget) await api.put(`/api/categories/${editTarget.id}`, values);
      else await api.post('/api/categories', values);
      message.success('已保存');
      setModalOpen(false);
      load();
      onChanged?.();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function onDelete(id: number) {
    try {
      await api.del(`/api/categories/${id}`);
      message.success('已删除');
      load();
      onChanged?.();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    {
      title: '分类名',
      dataIndex: 'name',
      render: (name: string) => <Tag color="blue" style={{ fontSize: 13 }}>{name}</Tag>,
    },
    { title: '排序', dataIndex: 'sort', width: 80 },
    {
      title: '上级分类',
      dataIndex: 'parent_id',
      width: 140,
      render: (p: number | null) => (p == null ? <span className="liti-muted">-</span> : data.find((c) => c.id === p)?.name ?? p),
    },
    {
      title: '操作',
      key: 'op',
      width: 140,
      render: (_: unknown, r: Category) => (
        <Space>
          <a
            onClick={() => {
              setEditTarget(r);
              form.setFieldsValue({ name: r.name, parentId: r.parent_id, sort: r.sort });
              setModalOpen(true);
            }}
          >
            编辑
          </a>
          <Popconfirm title="确认删除该分类？" okText="删除" cancelText="取消" onConfirm={() => onDelete(r.id)}>
            <a style={{ color: '#e5484d' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button
          icon={<PlusOutlined />}
          type="primary"
          onClick={() => {
            setEditTarget(null);
            form.resetFields();
            form.setFieldsValue({ sort: 0 });
            setModalOpen(true);
          }}
        >
          新建分类
        </Button>
        <span className="liti-muted" style={{ fontSize: 13 }}>
          删除前需要先把该分类下的题目移到别的分类
        </span>
      </Space>

      <Table rowKey="id" columns={columns} dataSource={data} loading={loading} pagination={false} />

      <Modal title={editTarget ? '编辑分类' : '新建分类'} open={modalOpen} onOk={onSave} onCancel={() => setModalOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="分类名" rules={[{ required: true, message: '请输入分类名' }]}>
            <Input placeholder="例如：计算机网络" />
          </Form.Item>
          <Form.Item name="parentId" label="上级分类（可选）">
            <Select
              allowClear
              placeholder="不选则为一级分类"
              options={data.filter((c) => c.id !== editTarget?.id).map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item name="sort" label="排序（数字越小越靠前）">
            <InputNumber style={{ width: 200 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
