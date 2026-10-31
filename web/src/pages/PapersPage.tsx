import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ThunderboltOutlined, UnorderedListOutlined, DownloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import PageHeader from '../components/PageHeader';
import QuestionPicker from '../components/QuestionPicker';
import type { Category, Paper, PaperRule, Question, SiteSettings } from '../types';

const STATUS_COLOR: Record<string, string> = { draft: 'default', published: 'green', archived: 'orange' };
const STATUS_LABEL: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' };

export default function PapersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [form] = Form.useForm();
  const [practiceForm] = Form.useForm();

  // 手选题目
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<Question[]>([]);

  const isManager = user?.role === 'admin' || user?.role === 'teacher';
  const mode = Form.useWatch('mode', form);

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
    api.get<Category[]>('/api/categories').then(setCategories).catch(() => {});
    api.get<SiteSettings>('/api/settings').then(setSettings).catch(() => {});
  }, [load]);

  function openCreate() {
    setPicked([]);
    form.resetFields();
    form.setFieldsValue({
      mode: 'random',
      durationMin: Math.round((settings?.defaultDurationSec ?? 3600) / 60),
      passScore: settings?.defaultPassScore ?? 60,
      reviewMode: 'after_submit',
      shuffleOptions: true,
      randomRules: [{ categoryId: undefined, count: 10 }],
    });
    setOpen(true);
  }

  async function onCreate() {
    const values = await form.validateFields();
    let questionIds: number[] | undefined;
    let randomRules: PaperRule[] | undefined;

    if (values.mode === 'random') {
      const rules = (values.randomRules ?? []) as PaperRule[];
      const valid = rules.filter((r) => r && r.count > 0);
      if (!valid.length) {
        message.warning('请至少添加一条抽题规则');
        return;
      }
      randomRules = valid.map((r) => ({ categoryId: r.categoryId ?? null, count: r.count }));
    } else {
      if (!picked.length) {
        message.warning('请先从题库中选择题目');
        return;
      }
      questionIds = picked.map((q) => q.id);
    }

    try {
      await api.post('/api/papers', {
        title: values.title,
        mode: values.mode,
        durationSec: values.durationMin * 60,
        passScore: values.passScore,
        reviewMode: values.reviewMode,
        shuffleOptions: values.shuffleOptions,
        ...(randomRules ? { randomRules } : { questionIds }),
      });
      message.success('试卷已创建，别忘了发布');
      setOpen(false);
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

  async function startPractice() {
    const v = await practiceForm.validateFields();
    try {
      const res = await api.post<{ id: number }>('/api/attempts/practice', {
        rules: [{ categoryId: v.categoryId ?? null, count: v.count }],
        durationSec: (v.durationMin ?? 60) * 60,
      });
      navigate(`/exam/${res.id}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function publish(id: number) {
    try {
      await api.post(`/api/papers/${id}/publish`);
      message.success('已发布');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  async function remove(id: number) {
    try {
      await api.del(`/api/papers/${id}`);
      message.success('已删除');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  const columns = [
    {
      title: '试卷',
      dataIndex: 'title',
      render: (title: string, r: Paper) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{title}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            #{r.id}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '组卷方式',
      dataIndex: 'mode',
      width: 110,
      render: (m: string) => <Tag color={m === 'random' ? 'purple' : 'blue'}>{m === 'random' ? '随机抽题' : '手选题目'}</Tag>,
    },
    { title: '题量', dataIndex: 'question_count', width: 80 },
    { title: '时长', dataIndex: 'duration_sec', width: 90, render: (d: number) => `${Math.round(d / 60)} 分钟` },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s] ?? s}</Tag>,
    },
    {
      title: '操作',
      key: 'op',
      width: 200,
      render: (_: unknown, r: Paper) => (
        <Space size={12}>
          {isManager && r.status !== 'published' && <a onClick={() => publish(r.id)}>发布</a>}
          {r.status === 'published' && <a onClick={() => startExam(r)}>开始答题</a>}
          {isManager && (
            <Popconfirm title="确认删除该试卷？" okText="删除" cancelText="取消" onConfirm={() => remove(r.id)}>
              <a style={{ color: '#e5484d' }}>删除</a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const showPractice = user?.role !== 'student' || settings?.practiceEnabled !== false;

  return (
    <div className="liti-page">
      <PageHeader
        title="试卷"
        description="随机抽题可以指定分类，也可以直接从题库里手选题目组卷。发布后学生就能作答。"
        extra={
          <>
            {showPractice && (
              <Button
                icon={<ThunderboltOutlined />}
                onClick={() => {
                  practiceForm.resetFields();
                  practiceForm.setFieldsValue({ count: 10, durationMin: 60 });
                  setPracticeOpen(true);
                }}
              >
                随机练习
              </Button>
            )}
            {isManager && (
              <Button icon={<DownloadOutlined />} href="/api/attempts/export">
                导出成绩
              </Button>
            )}
            {isManager && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建试卷
              </Button>
            )}
          </>
        }
      />

      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ current: page, pageSize: 20, total, onChange: setPage, showSizeChanger: false }}
        />
      </Card>

      {/* ---------- 新建试卷 ---------- */}
      <Modal
        title="新建试卷"
        open={open}
        onOk={onCreate}
        onCancel={() => setOpen(false)}
        width={720}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="试卷标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="例如：计算机网络期中测验" />
          </Form.Item>

          <Space size={16} wrap>
            <Form.Item name="durationMin" label="考试时长（分钟）" rules={[{ required: true }]}>
              <InputNumber min={1} max={1440} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="passScore" label="及格分">
              <InputNumber min={0} max={100} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="reviewMode" label="解析时机">
              <Radio.Group optionType="button" buttonStyle="solid">
                <Radio.Button value="after_submit">交卷后</Radio.Button>
                <Radio.Button value="immediate">即时</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Form.Item name="shuffleOptions" label="选项乱序" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>

          <Form.Item name="mode" label="组卷方式">
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="random">按分类随机抽题</Radio.Button>
              <Radio.Button value="fixed">从题库手选题目</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {mode === 'fixed' ? (
            <Card size="small" style={{ background: 'transparent' }}>
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Space>
                  <Button icon={<UnorderedListOutlined />} onClick={() => setPickerOpen(true)}>
                    从题库选择题目
                  </Button>
                  <Typography.Text type="secondary">已选 {picked.length} 题</Typography.Text>
                  {picked.length > 0 && (
                    <Button type="link" size="small" onClick={() => setPicked([])}>
                      清空
                    </Button>
                  )}
                </Space>
                {picked.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有选择题目" style={{ margin: '12px 0' }} />
                ) : (
                  <div style={{ maxHeight: 180, overflow: 'auto' }}>
                    <Space size={[6, 6]} wrap>
                      {picked.map((q, i) => (
                        <Tag
                          key={q.id}
                          closable
                          color="blue"
                          onClose={(e) => {
                            e.preventDefault();
                            setPicked((prev) => prev.filter((p) => p.id !== q.id));
                          }}
                        >
                          {i + 1}. #{(q.stem || '纯图片题').slice(0, 18)}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                )}
              </Space>
            </Card>
          ) : (
            <Form.List name="randomRules">
              {(fields, { add, remove }) => (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    每个分类抽几题分别填写；分类留空表示从整个题库抽。
                  </Typography.Text>
                  {fields.map((field, index) => (
                    <Space key={field.key} align="baseline" style={{ display: 'flex', marginTop: 10 }}>
                      <Form.Item name={[field.name, 'categoryId']} style={{ marginBottom: 0 }}>
                        <Select
                          allowClear
                          placeholder={`第 ${index + 1} 条：全部分类`}
                          style={{ width: 240 }}
                          options={categories.map((c) => ({ value: c.id, label: c.name }))}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'count']}
                        style={{ marginBottom: 0 }}
                        rules={[{ required: true, message: '填写题量' }]}
                      >
                        <InputNumber min={1} max={100} addonAfter="题" style={{ width: 140 }} />
                      </Form.Item>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={fields.length <= 1}
                        onClick={() => remove(field.name)}
                      />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    block
                    icon={<PlusOutlined />}
                    style={{ marginTop: 12 }}
                    onClick={() => add({ categoryId: undefined, count: 5 })}
                  >
                    添加一条抽题规则
                  </Button>
                </div>
              )}
            </Form.List>
          )}
        </Form>
      </Modal>

      <QuestionPicker
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        onOk={(_, questions) => {
          setPicked(questions);
          setPickerOpen(false);
        }}
        initial={picked}
        categories={categories}
      />

      {/* ---------- 随机练习 ---------- */}
      <Modal title="随机练习" open={practiceOpen} onOk={startPractice} onCancel={() => setPracticeOpen(false)} okText="开始">
        <Form form={practiceForm} layout="vertical">
          <Form.Item name="categoryId" label="分类">
            <Select allowClear placeholder="全部分类" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Form.Item name="count" label="题目数量（1–100）" rules={[{ required: true }]}>
            <InputNumber min={1} max={100} />
          </Form.Item>
          <Form.Item name="durationMin" label="时长（分钟）">
            <InputNumber min={1} max={1440} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
