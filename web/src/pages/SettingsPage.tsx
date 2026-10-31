import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Category, SiteSettings, StatsOverview } from '../types';

const DIFF_LABEL: Record<number, string> = { 1: '易', 2: '中', 3: '难' };

export default function SettingsPage() {
  return (
    <Tabs
      defaultActiveKey="site"
      items={[
        { key: 'site', label: '站点配置', children: <SiteConfigTab /> },
        { key: 'category', label: '分类管理', children: <CategoryTab /> },
        { key: 'overview', label: '数据概览', children: <OverviewTab /> },
        { key: 'info', label: '站点信息', children: <SiteInfoTab /> },
      ]}
    />
  );
}

/* ---------- 站点配置 ---------- */
function SiteConfigTab() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.get<SiteSettings>('/api/settings');
      form.setFieldsValue({
        siteName: s.siteName,
        siteAnnouncement: s.siteAnnouncement,
        defaultDurationSec: s.defaultDurationSec,
        defaultPassScore: s.defaultPassScore,
        practiceEnabled: s.practiceEnabled,
      });
    } catch (e) {
      message.error((e as Error).message);
    }
  }, [form]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSave() {
    const values = await form.validateFields();
    setLoading(true);
    try {
      await api.put('/api/settings', values);
      message.success('配置已保存');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Form form={form} layout="vertical" style={{ maxWidth: 560 }}>
        <Form.Item name="siteName" label="站点名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="siteAnnouncement" label="站点公告（登录页/首页展示，留空则不显示）">
          <Input.TextArea rows={3} maxLength={500} />
        </Form.Item>
        <Form.Item name="defaultDurationSec" label="默认考试时长（秒）" rules={[{ required: true }]}>
          <InputNumber min={60} max={86400} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="defaultPassScore" label="默认及格分（0–100）" rules={[{ required: true }]}>
          <InputNumber min={0} max={100} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="practiceEnabled" label="学生自助练习" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Button type="primary" loading={loading} onClick={onSave}>
          保存配置
        </Button>
      </Form>
    </Card>
  );
}

/* ---------- 分类管理 ---------- */
function CategoryTab() {
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
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function onDelete(id: number) {
    try {
      await api.del(`/api/categories/${id}`);
      message.success('已删除');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '分类名', dataIndex: 'name' },
    { title: '排序', dataIndex: 'sort', width: 80 },
    { title: '上级分类', dataIndex: 'parent_id', width: 120, render: (p: number | null) => (p == null ? '-' : data.find((c) => c.id === p)?.name ?? p) },
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
          <Popconfirm title="确认删除该分类？" onConfirm={() => onDelete(r.id)}>
            <a>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <Space style={{ marginBottom: 16 }}>
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
      </Space>
      <Table rowKey="id" columns={columns} dataSource={data} loading={loading} pagination={false} />

      <Modal title={editTarget ? '编辑分类' : '新建分类'} open={modalOpen} onOk={onSave} onCancel={() => setModalOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="分类名" rules={[{ required: true, message: '请输入分类名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="parentId" label="上级分类（可选）">
            <Select
              allowClear
              options={data.filter((c) => c.id !== editTarget?.id).map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item name="sort" label="排序（数字越小越靠前）">
            <InputNumber style={{ width: 200 }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

/* ---------- 数据概览 ---------- */
function OverviewTab() {
  const [stats, setStats] = useState<StatsOverview | null>(null);

  useEffect(() => {
    api
      .get<StatsOverview>('/api/stats/overview')
      .then(setStats)
      .catch((e) => message.error((e as Error).message));
  }, []);

  if (!stats) return <div style={{ padding: 40 }}>加载中…</div>;

  const diffColumns = [
    { title: '难度', dataIndex: 'difficulty', width: 80, render: (d: number) => DIFF_LABEL[d] ?? d },
    { title: '作答数', dataIndex: 'total', width: 100 },
    { title: '答对数', dataIndex: 'correct', width: 100 },
    { title: '正确率', dataIndex: 'rate', render: (r: number) => `${(r * 100).toFixed(1)}%` },
  ];

  return (
    <div>
      <Row gutter={16}>
        <Col span={6}><Card><Statistic title="用户数" value={stats.userCount} /></Card></Col>
        <Col span={6}><Card><Statistic title="题目总数" value={stats.questionCount} /></Card></Col>
        <Col span={6}><Card><Statistic title="试卷数" value={stats.paperCount} /></Card></Col>
        <Col span={6}><Card><Statistic title="答卷数" value={stats.attemptCount} /></Card></Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={6}><Card><Statistic title="分类数" value={stats.categoryCount} /></Card></Col>
        <Col span={6}><Card><Statistic title="已判答卷" value={stats.gradedCount} /></Card></Col>
        <Col span={6}><Card><Statistic title="平均得分率" value={stats.avgScorePercent} suffix="%" /></Card></Col>
        <Col span={6}><Card><Statistic title="总体正确率" value={(stats.correctRate * 100).toFixed(1)} suffix="%" /></Card></Col>
      </Row>
      <Card title="按难度正确率" style={{ marginTop: 16 }}>
        <Table rowKey="difficulty" columns={diffColumns} dataSource={stats.correctByDifficulty} pagination={false} locale={{ emptyText: '暂无答题数据' }} />
      </Card>
    </div>
  );
}

/* ---------- 站点信息 ---------- */
function SiteInfoTab() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);

  useEffect(() => {
    api
      .get<SiteSettings>('/api/settings')
      .then(setSettings)
      .catch((e) => message.error((e as Error).message));
  }, []);

  if (!settings) return <div style={{ padding: 40 }}>加载中…</div>;

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {settings.siteName}
      </Typography.Title>
      <Space direction="vertical" size="small">
        <div>
          <Tag color="blue">版本 0.1.0</Tag>
          <Tag color="green">运行中</Tag>
        </div>
        <Typography.Text type="secondary">面向局域网的学习刷题系统</Typography.Text>
        <div style={{ marginTop: 8 }}>
          <Typography.Text>默认考试时长：{settings.defaultDurationSec} 秒</Typography.Text>
        </div>
        <div>
          <Typography.Text>默认及格分：{settings.defaultPassScore} 分</Typography.Text>
        </div>
        <div>
          <Typography.Text>学生自助练习：{settings.practiceEnabled ? '开启' : '关闭'}</Typography.Text>
        </div>
        {settings.siteAnnouncement && (
          <Card size="small" style={{ marginTop: 12, maxWidth: 480 }}>
            <Typography.Text strong>站点公告</Typography.Text>
            <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              {settings.siteAnnouncement}
            </Typography.Paragraph>
          </Card>
        )}
      </Space>
    </Card>
  );
}
