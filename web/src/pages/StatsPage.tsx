import { useEffect, useState } from 'react';
import { Card, Col, Row, Statistic, Table, message } from 'antd';
import { api } from '../api';

interface Stats {
  questionCount: number;
  questionByType: { single: number; multiple: number };
  questionByDifficulty: { difficulty: number; count: number }[];
  categoryCount: number;
  paperCount: number;
  attemptCount: number;
  gradedCount: number;
  avgScorePercent: number;
  correctRate: number;
  correctByDifficulty: { difficulty: number; total: number; correct: number; rate: number }[];
}

const DIFF_LABEL: Record<number, string> = { 1: '易', 2: '中', 3: '难' };

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api
      .get<Stats>('/api/stats/overview')
      .then(setStats)
      .catch((e) => message.error((e as Error).message));
  }, []);

  if (!stats) {
    return <div style={{ padding: 40 }}>加载中…</div>;
  }

  const diffColumns = [
    { title: '难度', dataIndex: 'difficulty', width: 80, render: (d: number) => DIFF_LABEL[d] ?? d },
    { title: '作答数', dataIndex: 'total', width: 100 },
    { title: '答对数', dataIndex: 'correct', width: 100 },
    { title: '正确率', dataIndex: 'rate', render: (r: number) => `${(r * 100).toFixed(1)}%` },
  ];

  return (
    <div>
      <Row gutter={16}>
        <Col span={6}><Card><Statistic title="题目总数" value={stats.questionCount} /></Card></Col>
        <Col span={6}><Card><Statistic title="分类数" value={stats.categoryCount} /></Card></Col>
        <Col span={6}><Card><Statistic title="试卷数" value={stats.paperCount} /></Card></Col>
        <Col span={6}><Card><Statistic title="答卷数" value={stats.attemptCount} /></Card></Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={6}><Card><Statistic title="单选题" value={stats.questionByType.single} /></Card></Col>
        <Col span={6}><Card><Statistic title="多选题" value={stats.questionByType.multiple} /></Card></Col>
        <Col span={6}><Card><Statistic title="平均得分率" value={stats.avgScorePercent} suffix="%" /></Card></Col>
        <Col span={6}><Card><Statistic title="总体正确率" value={(stats.correctRate * 100).toFixed(1)} suffix="%" /></Card></Col>
      </Row>

      <Card title="按难度正确率" style={{ marginTop: 16 }}>
        <Table
          rowKey="difficulty"
          columns={diffColumns}
          dataSource={stats.correctByDifficulty}
          pagination={false}
          locale={{ emptyText: '暂无答题数据' }}
        />
      </Card>

      <Card title="题库难度分布" style={{ marginTop: 16 }}>
        <Table
          rowKey="difficulty"
          columns={[
            { title: '难度', dataIndex: 'difficulty', render: (d: number) => DIFF_LABEL[d] ?? d },
            { title: '题目数', dataIndex: 'count' },
          ]}
          dataSource={stats.questionByDifficulty}
          pagination={false}
        />
      </Card>
    </div>
  );
}
