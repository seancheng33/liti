import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Radio, Space, Table, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Paper } from '../types';

const STATUS_LABEL: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' };

export default function PapersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const isManager = user?.role === 'admin' || user?.role === 'teacher';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: Paper[]; total: number }>(`/api/papers?page=${page}&pageSize=20`);
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

  async function onCreate() {
    const v = await form.validateFields();
    const payload = {
      title: v.title,
      mode: v.mode,
      durationSec: v.durationSec * 60,
      reviewMode: v.reviewMode,
      shuffleOptions: v.shuffleOptions,
      ...(v.mode === 'random'
        ? { randomRules: [{ count: v.count }] }
        : { questionIds: String(v.questionIds).split(',').map((s: string) => Number(s.trim())).filter(Boolean) }),
    };
    try {
      await api.post('/api/papers', payload);
      message.success('已创建');
      setOpen(false);
      form.resetFields();
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function startExam(paper: Paper) {
    try {
      const res = await api.post<{ id: number }>('/api/attempts', { paperId: paper.id });
      navigate(`/exam/${res.id}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  const columns = [
    { title: '标题', dataIndex: 'title' },
    { title: '方式', dataIndex: 'mode', width: 80, render: (m: string) => (m === 'random' ? '随机' : '固定') },
    { title: '题量', dataIndex: 'question_count', width: 70 },
    { title: '时长(分)', dataIndex: 'duration_sec', width: 90, render: (d: number) => Math.round(d / 60) },
    { title: '状态', dataIndex: 'status', width: 90, render: (s: string) => STATUS_LABEL[s] ?? s },
    {
      title: '操作',
      key: 'op',
      width: 180,
      render: (_: unknown, r: Paper) => (
        <Space>
          {isManager && r.status !== 'published' && (
            <a
              onClick={async () => {
                await api.post(`/api/papers/${r.id}/publish`);
                message.success('已发布');
                load();
              }}
            >
              发布
            </a>
          )}
          {r.status === 'published' && <a onClick={() => startExam(r)}>开始答题</a>}
          {isManager && (
            <a
              onClick={async () => {
                await api.del(`/api/papers/${r.id}`);
                message.success('已删除');
                load();
              }}
            >
              删除
            </a>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {isManager && (
        <Button
          icon={<PlusOutlined />}
          style={{ marginBottom: 16 }}
          onClick={() => {
            form.resetFields();
            setOpen(true);
          }}
        >
          新建试卷
        </Button>
      )}
      <Table rowKey="id" columns={columns} dataSource={data} loading={loading} pagination={{ current: page, pageSize: 20, total, onChange: setPage }} />

      <Modal title="新建试卷" open={open} onOk={onCreate} onCancel={() => setOpen(false)}>
        <Form form={form} layout="vertical" initialValues={{ mode: 'random', durationSec: 60, reviewMode: 'after_submit', shuffleOptions: true, count: 10 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="mode" label="组卷方式">
            <Radio.Group>
              <Radio value="random">随机抽题</Radio>
              <Radio value="fixed">固定题目</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.mode !== b.mode}>
            {({ getFieldValue }) =>
              getFieldValue('mode') === 'random' ? (
                <Form.Item name="count" label="题目数量（1–100）" rules={[{ required: true }]}>
                  <InputNumber min={1} max={100} />
                </Form.Item>
              ) : (
                <Form.Item name="questionIds" label="题目 ID 列表（逗号分隔）" rules={[{ required: true }]}>
                  <Input placeholder="例如 1,3,5" />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item name="durationSec" label="时长（分钟）">
            <InputNumber min={1} />
          </Form.Item>
          <Form.Item name="reviewMode" label="解析时机">
            <Radio.Group>
              <Radio value="after_submit">交卷后</Radio>
              <Radio value="immediate">即时</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="shuffleOptions" label="选项乱序" valuePropName="checked">
            <Radio value={true}>启用</Radio>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
