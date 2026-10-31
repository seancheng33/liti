import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Col, Form, Input, InputNumber, Row, Space, Statistic, Switch, Table, Tabs, Tag, Typography, message } from 'antd';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import CategoryManager from '../components/CategoryManager';
import type { SiteSettings, StatsOverview } from '../types';

export default function SettingsPage() {
  return (
    <div className="liti-page">
      <PageHeader
        title="网站管理"
        description="站点名称、默认考试参数、分类、数据概览。分类管理页教师也能进入，方便维护题库结构。"
      />
      <Tabs
        defaultActiveKey="site"
        items={[
          { key: 'site', label: '站点配置', children: <SiteConfigTab /> },
          { key: 'category', label: '分类管理', children: <CategoryTab /> },
          { key: 'overview', label: '数据概览', children: <OverviewTab /> },
          { key: 'info', label: '站点信息', children: <SiteInfoTab /> },
        ]}
      />
    </div>
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
      <Form form={form} layout="vertical" style={{ maxWidth: 680 }}>
        <Form.Item name="siteName" label="站点名称" rules={[{ required: true }]} tooltip="显示在页头、登录页和浏览器标签上">
          <Input style={{ maxWidth: 360 }} />
        </Form.Item>
        <Form.Item
          name="siteAnnouncement"
          label="站点公告（登录页展示，留空则不显示）"
          extra="适合写考试安排、注意事项之类；首页和登录页都会显示。"
        >
          <Input.TextArea rows={3} maxLength={500} showCount />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="defaultDurationSec"
              label="新建试卷默认时长（秒）"
              rules={[{ required: true }]}
              extra="只是新建试卷时的预填值，每份卷子可以单独改。"
            >
              <InputNumber min={60} max={86400} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="defaultPassScore"
              label="默认及格分（0–100）"
              rules={[{ required: true }]}
              extra="只影响成绩单上的及格判定，不影响得分。"
            >
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="practiceEnabled"
          label="允许学生自助练习"
          valuePropName="checked"
          extra="关闭后学生端不再出现「随机练习」入口，教师端不受影响。"
        >
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
  return (
    <Card>
      <CategoryManager />
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

  if (!stats) return <div className="liti-loading">加载中…</div>;

  const cards = [
    { title: '用户数', value: stats.userCount },
    { title: '题目总数', value: stats.questionCount },
    { title: '试卷数', value: stats.paperCount },
    { title: '答卷数', value: stats.attemptCount },
    { title: '分类数', value: stats.categoryCount },
    { title: '已判答卷', value: stats.gradedCount },
    { title: '平均得分率', value: stats.avgScorePercent, suffix: '%' },
    { title: '总体正确率', value: Math.round(stats.correctRate * 1000) / 10, suffix: '%' },
  ];

  return (
    <div>
      <Row gutter={[16, 16]}>
        {cards.map((c) => (
          <Col key={c.title} xs={12} sm={8} md={6}>
            <Card className="liti-stat-card">
              <Statistic title={c.title} value={c.value} suffix={c.suffix} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="各分类正确率" style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="category"
          dataSource={stats.correctByCategory}
          pagination={false}
          locale={{ emptyText: '暂无答题数据' }}
          columns={[
            { title: '分类', dataIndex: 'category' },
            { title: '作答数', dataIndex: 'total', width: 110 },
            { title: '答对数', dataIndex: 'correct', width: 110 },
            { title: '正确率', dataIndex: 'rate', width: 140, render: (r: number) => `${(r * 100).toFixed(1)}%` },
          ]}
        />
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

  if (!settings) return <div className="liti-loading">加载中…</div>;

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {settings.siteName}
      </Typography.Title>
      <Space direction="vertical" size="small">
        <div>
          <Tag color="blue">版本 0.2.0</Tag>
          <Tag color="green">运行中</Tag>
        </div>
        <Typography.Text type="secondary">面向局域网的学习刷题系统</Typography.Text>
        <div style={{ marginTop: 8 }}>
          <Typography.Text>默认考试时长：{Math.round(settings.defaultDurationSec / 60)} 分钟</Typography.Text>
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
