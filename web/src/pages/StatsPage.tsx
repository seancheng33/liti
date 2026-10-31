import { useEffect, useState } from 'react';
import { Card, Col, Progress, Row, Statistic, Table, message } from 'antd';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import type { StatsOverview } from '../types';

export default function StatsPage() {
  const [stats, setStats] = useState<StatsOverview | null>(null);

  useEffect(() => {
    api
      .get<StatsOverview>('/api/stats/overview')
      .then(setStats)
      .catch((e) => message.error((e as Error).message));
  }, []);

  if (!stats) {
    return <div className="liti-loading">加载中…</div>;
  }

  const cards = [
    { title: '题目总数', value: stats.questionCount },
    { title: '单选题', value: stats.questionByType.single },
    { title: '多选题', value: stats.questionByType.multiple },
    { title: '分类数', value: stats.categoryCount },
    { title: '试卷数', value: stats.paperCount },
    { title: '答卷数', value: stats.attemptCount },
    { title: '已判答卷', value: stats.gradedCount },
    { title: '平均得分率', value: stats.avgScorePercent, suffix: '%' },
  ];

  return (
    <div className="liti-page">
      <PageHeader title="统计" description="题库规模、作答情况与各分类的正确率一览。" />

      <Row gutter={[16, 16]}>
        {cards.map((c) => (
          <Col key={c.title} xs={12} sm={8} md={6}>
            <Card className="liti-stat-card">
              <Statistic title={c.title} value={c.value} suffix={c.suffix} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="总体正确率" style={{ marginTop: 16 }}>
        <Progress
          percent={Math.round(stats.correctRate * 1000) / 10}
          status="active"
          strokeColor={{ from: '#1677ff', to: '#52c41a' }}
        />
      </Card>

      <Card title="各分类正确率" style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="category"
          dataSource={stats.correctByCategory}
          pagination={false}
          locale={{ emptyText: '暂无答题数据' }}
          columns={[
            { title: '分类', dataIndex: 'category' },
            { title: '作答数', dataIndex: 'total', width: 120 },
            { title: '答对数', dataIndex: 'correct', width: 120 },
            {
              title: '正确率',
              dataIndex: 'rate',
              width: 220,
              render: (r: number) => (
                <Progress percent={Math.round(r * 1000) / 10} size="small" strokeColor={r >= 0.6 ? '#16a34a' : '#fa8c16'} />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
