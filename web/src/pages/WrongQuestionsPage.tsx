import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
  theme as antdTheme,
} from 'antd';
import { DeleteOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import type { Category, WrongQuestion, WrongQuestionDetail } from '../types';

const { Text, Paragraph } = Typography;

const STATUS_OPTIONS = [
  { value: 'active', label: '待订正' },
  { value: 'resolved', label: '已订正' },
  { value: 'all', label: '全部' },
];

export default function WrongQuestionsPage() {
  const navigate = useNavigate();
  const { token } = antdTheme.useToken();
  const successBorder = token.colorSuccessBorder;
  const successBg = token.colorSuccessBg;
  const fillQuaternary = token.colorFillQuaternary;
  const [data, setData] = useState<WrongQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [activeTotal, setActiveTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'active' | 'resolved' | 'all'>('active');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<number[]>([]);

  const [detail, setDetail] = useState<WrongQuestionDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20', status });
      if (categoryId != null) params.set('categoryId', String(categoryId));
      if (keyword.trim()) params.set('keyword', keyword.trim());
      const res = await api.get<{ items: WrongQuestion[]; total: number; activeTotal: number }>(
        `/api/wrong-questions?${params.toString()}`,
      );
      setData(res.items);
      setTotal(res.total);
      setActiveTotal(res.activeTotal);
      setSelected([]);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, status, categoryId, keyword]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<Category[]>('/api/categories')
      .then(setCategories)
      .catch(() => {});
  }, []);

  async function openDetail(questionId: number) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await api.get<WrongQuestionDetail>(`/api/wrong-questions/${questionId}`));
    } catch (e) {
      message.error((e as Error).message);
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function remove(questionId: number) {
    try {
      await api.del(`/api/wrong-questions/${questionId}`);
      message.success('已从错题本移除');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function batchRemove() {
    try {
      const res = await api.post<{ removed: number }>('/api/wrong-questions/batch-remove', { questionIds: selected });
      message.success(`已移除 ${res.removed} 道`);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function startPractice() {
    const count = Math.min(10, activeTotal);
    if (!count) return;
    setStarting(true);
    try {
      const res = await api.post<{ id: number }>('/api/attempts/practice', {
        source: 'wrong',
        count,
        durationSec: 30 * 60,
      });
      message.success('错题练习卷已生成');
      navigate(`/exam/${res.id}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  const columns = [
    {
      title: '题目',
      dataIndex: 'stem',
      render: (stem: string, r: WrongQuestion) => (
        <Space direction="vertical" size={2} style={{ maxWidth: 620 }}>
          <Space size={6} wrap>
            <Tag color={r.resolved ? 'default' : 'red'}>{r.resolved ? '已订正' : `错 ${r.wrongCount} 次`}</Tag>
            <Tag>{r.type === 'multiple' ? '多选' : '单选'}</Tag>
            {r.categoryName && <Tag color="blue">{r.categoryName}</Tag>}
          </Space>
          <Text ellipsis={{ tooltip: stem }} style={{ maxWidth: 600 }}>
            {stem || '（纯图片题，点「查看」看原题）'}
          </Text>
        </Space>
      ),
    },
    {
      title: '最近答错',
      dataIndex: 'lastWrongAt',
      width: 170,
      render: (t: number) => <span className="liti-muted">{new Date(t).toLocaleString()}</span>,
    },
    {
      title: '操作',
      key: 'op',
      width: 150,
      render: (_: unknown, r: WrongQuestion) => (
        <Space size={10}>
          <a onClick={() => openDetail(r.questionId)}>查看</a>
          <Popconfirm title="从错题本移除？" description="题目本身不会从题库删除" okText="移除" cancelText="取消" onConfirm={() => remove(r.questionId)}>
            <a style={{ color: '#e5484d' }}>移除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="liti-page">
      <PageHeader
        title="我的错题本"
        description="答错过的题会自动进这里。做对一次就移出「待订正」，再错会重新回来并累计次数。错题本只有你自己能看到。"
        extra={
          <Space>
            <Button icon={<ThunderboltOutlined />} loading={starting} disabled={!activeTotal} onClick={startPractice}>
              用错题练一遍
            </Button>
            <Button icon={<ReloadOutlined />} onClick={load}>
              刷新
            </Button>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={`待订正 ${activeTotal} 题`}
        description="错题来自「交卷后的判分结果」，所以还不会把没考过的题的答案提前告诉你。做对一次就移出待订正，答错会累加错误次数。"
      />

      <Card>
        <Space size={12} wrap style={{ marginBottom: 16 }}>
          <Radio.Group
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            optionType="button"
            buttonStyle="solid"
            options={STATUS_OPTIONS}
          />
          <Select
            allowClear
            style={{ width: 190 }}
            placeholder="全部分类"
            value={categoryId}
            onChange={(v) => {
              setCategoryId(v ?? null);
              setPage(1);
            }}
            optionFilterProp="label"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Input.Search
            allowClear
            placeholder="按题干搜索"
            style={{ width: 240 }}
            onSearch={(v) => {
              setKeyword(v);
              setPage(1);
            }}
          />
        </Space>

        {selected.length > 0 && (
          <div className="liti-batch-bar" style={{ marginBottom: 12 }}>
            <span>已选 {selected.length} 题</span>
            <Popconfirm
              title={`把选中的 ${selected.length} 道题移出错题本？`}
              description="题目本身不会从题库删除，只是不再出现在错题本里"
              okText="移除"
              cancelText="取消"
              onConfirm={batchRemove}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                批量移除
              </Button>
            </Popconfirm>
            <a onClick={() => setSelected([])}>取消选择</a>
          </div>
        )}

        <Table
          rowKey="questionId"
          columns={columns}
          dataSource={data}
          loading={loading}
          rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]) }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  status === 'active'
                    ? '没有待订正的错题。做几道题，答错的会自动进来'
                    : status === 'resolved'
                      ? '还没有订正过的题'
                      : '错题本还是空的'
                }
              />
            ),
          }}
          pagination={{ current: page, pageSize: 20, total, onChange: setPage, showSizeChanger: false }}
        />
      </Card>

      <Modal
        title="错题详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={<Button onClick={() => setDetailOpen(false)}>关闭</Button>}
        width={720}
      >
        {detailLoading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : detail ? (
          <div>
            <Descriptions size="small" column={3} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="类型">{detail.type === 'multiple' ? '多选题' : '单选题'}</Descriptions.Item>
              <Descriptions.Item label="分类">{detail.categoryName ?? '未分类'}</Descriptions.Item>
              <Descriptions.Item label="错误次数">{detail.wrongCount} 次</Descriptions.Item>
            </Descriptions>

            {detail.status === 'archived' && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="这道题已从题库中删除"
                description="不会再出现在新组卷里，但你错过的记录还在，可以继续复习。"
              />
            )}

            <Paragraph strong style={{ fontSize: 15 }}>
              {detail.stem || '（纯图片题）'}
            </Paragraph>
            {detail.images.length > 0 && (
              <Space wrap style={{ marginBottom: 12 }}>
                {detail.images.map((src) => (
                  <img key={src} src={src} alt="题干配图" style={{ maxWidth: 220, borderRadius: 6 }} />
                ))}
              </Space>
            )}

            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {detail.options.map((o, i) => (
                <div
                  key={o.id}
                  className="liti-option"
                  style={{
                    borderColor: o.isCorrect ? successBorder : undefined,
                    background: o.isCorrect ? successBg : undefined,
                  }}
                >
                  <span className="liti-option-label">{String.fromCharCode(65 + i)}.</span>
                  <div style={{ flex: 1 }}>
                    <span>{o.content}</span>
                    {o.images.length > 0 && (
                      <Space wrap style={{ marginTop: 6 }}>
                        {o.images.map((src) => (
                          <img key={src} src={src} alt="选项配图" style={{ maxWidth: 160, borderRadius: 6 }} />
                        ))}
                      </Space>
                    )}
                    {o.isCorrect && (
                      <Space size={6} style={{ marginTop: 4 }} wrap>
                        <Tag color="success">正确答案</Tag>
                      </Space>
                    )}
                  </div>
                </div>
              ))}
            </Space>

            <Card size="small" style={{ marginTop: 12, background: fillQuaternary, borderStyle: 'dashed' }}>
              <Text strong>解析</Text>
              <Paragraph style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>
                {detail.explanation || '这道题没有写解析。'}
              </Paragraph>
            </Card>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
