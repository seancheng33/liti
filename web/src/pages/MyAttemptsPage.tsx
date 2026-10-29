import { useCallback, useEffect, useState } from 'react';
import { Button, Table, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { AttemptSummary } from '../types';

const STATUS_LABEL: Record<string, string> = { in_progress: '进行中', submitted: '已交卷', expired: '已超时' };

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
    { title: '试卷', dataIndex: 'paper_title' },
    { title: '成绩', dataIndex: 'score', width: 90, render: (s: number, r: AttemptSummary) => `${s}/${r.total_score}` },
    { title: '答对', dataIndex: 'correct_count', width: 90, render: (c: number, r: AttemptSummary) => `${c}/${r.question_count}` },
    { title: '状态', dataIndex: 'status', width: 90, render: (s: string) => STATUS_LABEL[s] ?? s },
    {
      title: '操作',
      key: 'op',
      width: 120,
      render: (_: unknown, r: AttemptSummary) => (
        <Button size="small" onClick={() => navigate(r.status === 'in_progress' ? `/exam/${r.id}` : `/review/${r.id}`)}>
          {r.status === 'in_progress' ? '继续答题' : '查看'}
        </Button>
      ),
    },
  ];

  return <Table rowKey="id" columns={columns} dataSource={data} loading={loading} pagination={{ current: page, pageSize: 20, total, onChange: setPage }} />;
}
