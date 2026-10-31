import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Progress, Space, Table, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import type { AttemptSummary } from '../types';
import { STATUS_LABEL, submitReasonText } from '../types';

export default function MyAttemptsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<AttemptSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: AttemptSummary[]; total: number }>(`/api/attempts?page=${page}&pageSize=20`);
      setData(res.items);
      setTotal(res.total);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    {
      title: '试卷',
      dataIndex: 'paper_title',
      render: (title: string) => <Typography.Text strong>{title}</Typography.Text>,
    },
    {
      title: '得分',
      dataIndex: 'score',
      width: 170,
      render: (s: number, r: AttemptSummary) => {
        const percent = r.total_score ? Math.round((s / r.total_score) * 100) : 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Progress
              percent={percent}
              size="small"
              style={{ flex: 1, marginBottom: 0, minWidth: 60 }}
              strokeColor={percent >= 60 ? '#16a34a' : '#e5484d'}
              showInfo={false}
            />
            <span className="liti-mono" style={{ minWidth: 42, textAlign: 'right' }}>
              {s}/{r.total_score}
            </span>
          </div>
        );
      },
    },
    { title: '答对', dataIndex: 'correct_count', width: 90, render: (c: number, r: AttemptSummary) => `${c}/${r.question_count}` },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => <Tag color={s === 'in_progress' ? 'processing' : s === 'expired' ? 'orange' : 'green'}>{STATUS_LABEL[s] ?? s}</Tag>,
    },
    {
      title: '交卷原因',
      dataIndex: 'submit_reason',
      width: 170,
      render: (reason: string | null) =>
        reason ? (
          <Tag color={reason === 'manual' ? 'default' : 'orange'}>{submitReasonText(reason)}</Tag>
        ) : (
          <span className="liti-muted">-</span>
        ),
    },
    {
      title: '操作',
      key: 'op',
      width: 110,
      render: (_: unknown, r: AttemptSummary) => (
        <Button size="small" onClick={() => navigate(r.status === 'in_progress' ? `/exam/${r.id}` : `/review/${r.id}`)}>
          {r.status === 'in_progress' ? '继续答题' : '查看解析'}
        </Button>
      ),
    },
  ];

  return (
    <div className="liti-page">
      <PageHeader title="我的答卷" description="这里能看到每次作答的成绩、交卷原因，以及每道题的解析。" />
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ current: page, pageSize: 20, total, onChange: setPage, showSizeChanger: false }}
        />
      </Card>
    </div>
  );
}
