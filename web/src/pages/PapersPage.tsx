import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
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
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import PageHeader from '../components/PageHeader';
import QuestionPicker from '../components/QuestionPicker';
import PaperPreviewModal from '../components/PaperPreviewModal';
import {
  MAX_ATTEMPTS_PER_PAPER,
  type Category,
  type Paper,
  type PaperPreview,
  type PaperRule,
  type Question,
  type SiteSettings,
  type StudentOption,
} from '../types';

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

  // 预览
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PaperPreview | null>(null);

  // 发布 / 可见范围
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<Paper | null>(null);
  const [pubMode, setPubMode] = useState<'all' | 'selected'>('all');
  const [pubIds, setPubIds] = useState<number[]>([]);
  const [pubLoading, setPubLoading] = useState(false);

  const isManager = user?.role === 'admin' || user?.role === 'teacher';
  const isStudent = user?.role === 'student';
  const mode = Form.useWatch('mode', form);
  const [searchParams, setSearchParams] = useSearchParams();
  const autoStartedRef = useRef(false);

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
    // 学生名册只有教师/管理员用得上（发布时勾人）
    if (isManager) {
      api.get<StudentOption[]>('/api/users/students').then(setStudents).catch(() => {});
    }
  }, [load, isManager]);

  // 未登录点「开始答题」→ 登录页 → 回到这里时带 ?start=<paperId>，直接开考
  useEffect(() => {
    const target = searchParams.get('start');
    if (!target || !user || autoStartedRef.current) return;
    autoStartedRef.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete('start');
    setSearchParams(next, { replace: true });
    api
      .post<{ id: number }>('/api/attempts', { paperId: Number(target) })
      .then((res) => navigate(`/exam/${res.id}`))
      .catch((e) => message.error((e as Error).message));
  }, [searchParams, user, setSearchParams, navigate]);

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

  /** 把表单收成接口入参；校验不通过时给提示并返回 null */
  async function collectPayload(): Promise<Record<string, unknown> | null> {
    let values: Record<string, any>;
    try {
      values = await form.validateFields();
    } catch {
      // 表单校验失败时 antd 已经在字段下方标红，这里不用再弹提示
      return null;
    }
    let questionIds: number[] | undefined;
    let randomRules: PaperRule[] | undefined;

    if (values.mode === 'random') {
      const rules = (values.randomRules ?? []) as PaperRule[];
      const valid = rules.filter((r) => r && r.count > 0);
      if (!valid.length) {
        message.warning('请至少添加一条抽题规则');
        return null;
      }
      randomRules = valid.map((r) => ({ categoryId: r.categoryId ?? null, count: r.count }));
    } else {
      if (!picked.length) {
        message.warning('请先从题库中选择题目');
        return null;
      }
      questionIds = picked.map((q) => q.id);
    }

    return {
      title: values.title,
      mode: values.mode,
      durationSec: values.durationMin * 60,
      passScore: values.passScore,
      reviewMode: values.reviewMode,
      shuffleOptions: values.shuffleOptions,
      ...(randomRules ? { randomRules } : { questionIds }),
    };
  }

  async function onCreate() {
    const payload = await collectPayload();
    if (!payload) return;
    try {
      await api.post('/api/papers', payload);
      message.success('试卷已创建，点「发布」时可以选对哪些学生可见');
      setOpen(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  /** 新建弹窗里的「预览卷面」：按当前表单临时抽题，不落库 */
  async function previewDraft() {
    const payload = await collectPayload();
    if (!payload) return;
    setPreviewOpen(true);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const data = await api.post<PaperPreview>('/api/papers/draft-preview', payload);
      setPreview(data);
    } catch (e) {
      message.error((e as Error).message);
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  }

  /** 已存在的试卷预览（草稿也能看） */
  async function openPreview(id: number) {
    setPreviewOpen(true);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const data = await api.get<PaperPreview>(`/api/papers/${id}/preview`);
      setPreview(data);
    } catch (e) {
      message.error((e as Error).message);
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
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

  /** 打开发布 / 可见范围弹窗，先把该卷当前的名单读出来 */
  async function openPublish(paper: Paper) {
    setPublishTarget(paper);
    setPubMode(paper.audience_mode === 'selected' ? 'selected' : 'all');
    setPubIds(paper.audience_user_ids ?? []);
    setPublishOpen(true);
    try {
      const aud = await api.get<{ audienceMode: 'all' | 'selected'; audienceUserIds: number[] }>(
        `/api/papers/${paper.id}/audience`,
      );
      setPubMode(aud.audienceMode);
      setPubIds(aud.audienceUserIds);
    } catch {
      /* 草稿还没发布过，读不到就用默认值 */
    }
  }

  async function confirmPublish() {
    if (!publishTarget) return;
    if (pubMode === 'selected' && !pubIds.length) {
      message.warning('选了「指定学生」就要至少勾一个学生');
      return;
    }
    setPubLoading(true);
    try {
      const body = { audienceMode: pubMode, audienceUserIds: pubIds };
      if (publishTarget.status === 'published') {
        await api.put(`/api/papers/${publishTarget.id}/audience`, body);
        message.success('可见范围已更新');
      } else {
        await api.post(`/api/papers/${publishTarget.id}/publish`, body);
        message.success(pubMode === 'selected' ? `已发布，仅 ${pubIds.length} 名学生可见` : '已发布，所有学生可见');
      }
      setPublishOpen(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setPubLoading(false);
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
      title: '可见范围',
      dataIndex: 'audience_mode',
      width: 120,
      render: (m: string, r: Paper) =>
        m === 'selected' ? (
          <Tooltip title="只对点名的学生可见，其他人看不到这份卷子">
            <Tag color="geekblue" icon={<TeamOutlined />}>
              指定 {r.audience_count ?? 0} 人
            </Tag>
          </Tooltip>
        ) : (
          <Tag>所有学生</Tag>
        ),
    },
    ...(isStudent
      ? [
          {
            title: '作答次数',
            key: 'attempts',
            width: 120,
            render: (_: unknown, r: Paper) => {
              const left = r.remaining_attempts ?? MAX_ATTEMPTS_PER_PAPER;
              return (
                <Tooltip title={`这份试卷最多可作答 ${MAX_ATTEMPTS_PER_PAPER} 次，每次交卷后重新开始`}>
                  <Typography.Text type={left === 0 ? 'danger' : left <= 1 ? 'warning' : 'secondary'}>
                    {left > 0 ? `还可答 ${left} 次` : '次数已用完'}
                  </Typography.Text>
                </Tooltip>
              );
            },
          },
        ]
      : []),
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s] ?? s}</Tag>,
    },
    {
      title: '操作',
      key: 'op',
      width: 260,
      render: (_: unknown, r: Paper) => {
        const left = r.remaining_attempts ?? MAX_ATTEMPTS_PER_PAPER;
        return (
          <Space size={12} wrap>
            <Tooltip title="考生视角看一遍卷面，不含答案">
              <a onClick={() => openPreview(r.id)}>预览</a>
            </Tooltip>
            {isManager && r.status !== 'published' && <a onClick={() => openPublish(r)}>发布</a>}
            {isManager && r.status === 'published' && (
              <Tooltip title="指定哪些学生能看到这份卷子">
                <a onClick={() => openPublish(r)}>可见范围</a>
              </Tooltip>
            )}
            {r.status === 'published' &&
              (left > 0 ? (
                <a onClick={() => startExam(r)}>开始答题</a>
              ) : (
                <Tooltip title={`最多可作答 ${MAX_ATTEMPTS_PER_PAPER} 次，你已经用完了`}>
                  <span style={{ color: '#bbb', cursor: 'not-allowed' }}>次数已用完</span>
                </Tooltip>
              ))}
            {isManager && (
              <Popconfirm title="确认删除该试卷？" okText="删除" cancelText="取消" onConfirm={() => remove(r.id)}>
                <a style={{ color: '#e5484d' }}>删除</a>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  const showPractice = user?.role !== 'student' || settings?.practiceEnabled !== false;

  return (
    <div className="liti-page">
      <PageHeader
        title="试卷"
        description={`随机抽题可以指定分类，也可以直接从题库里手选题目组卷。建好后点「发布」，发布时可以选让所有学生看到还是只给指定学生看。每份试卷最多作答 ${MAX_ATTEMPTS_PER_PAPER} 次，练习卷不受限。`}
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
          scroll={{ x: 980 }}
          pagination={{ current: page, pageSize: 20, total, onChange: setPage, showSizeChanger: false }}
        />
      </Card>

      {/* ---------- 新建试卷 ---------- */}
      <Modal
        title="新建试卷"
        open={open}
        onCancel={() => setOpen(false)}
        width={720}
        cancelText="取消"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Tooltip title="按当前填写的内容临时抽一份卷子看看效果，不会保存">
              <Button icon={<EyeOutlined />} loading={previewLoading} onClick={previewDraft}>
                预览卷面
              </Button>
            </Tooltip>
            <Space>
              <Button onClick={() => setOpen(false)}>取消</Button>
              <Button type="primary" onClick={onCreate}>
                创建
              </Button>
            </Space>
          </div>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label="试卷标题"
            rules={[{ required: true, message: '请输入标题' }]}
            tooltip="会显示在学生的试卷列表和成绩单上"
          >
            <Input placeholder="例如：计算机网络期中测验" />
          </Form.Item>

          <Space size={16} wrap>
            <Form.Item name="durationMin" label="考试时长（分钟）" rules={[{ required: true }]} tooltip="整卷倒计时，到点自动交卷">
              <InputNumber min={1} max={1440} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="passScore" label="及格分" tooltip="只影响成绩页的及格判定，不影响得分">
              <InputNumber min={0} max={100} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="reviewMode" label="解析时机" tooltip="交卷后：整卷交完统一看解析；即时：每题答完就能看">
              <Radio.Group optionType="button" buttonStyle="solid">
                <Radio.Button value="after_submit">交卷后</Radio.Button>
                <Radio.Button value="immediate">即时</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Form.Item name="shuffleOptions" label="选项乱序" valuePropName="checked" tooltip="每个学生拿到的选项顺序不同，防抄袭">
              <Switch />
            </Form.Item>
          </Space>

          <Form.Item name="mode" label="组卷方式" tooltip="随机抽题每次抽到的题不固定；手选可以精确控制题目">
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
                  <Alert
                    type="info"
                    showIcon
                    icon={<InfoCircleOutlined />}
                    style={{ marginBottom: 4 }}
                    message="每条规则 = 从某个分类抽几题；分类留空表示从整个题库抽"
                    description="多条规则之间不会抽到重复题目。填的题量多于题库现有题量时会提示不足，点「预览卷面」可以先看看这次抽到什么。"
                  />
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
                      <Tooltip title={fields.length <= 1 ? '至少保留一条规则' : '删除这条规则'}>
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          disabled={fields.length <= 1}
                          onClick={() => remove(field.name)}
                        />
                      </Tooltip>
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

      {/* ---------- 发布 / 可见范围 ---------- */}
      <Modal
        title={publishTarget?.status === 'published' ? '修改可见范围' : '发布试卷'}
        open={publishOpen}
        onCancel={() => setPublishOpen(false)}
        onOk={confirmPublish}
        okText={publishTarget?.status === 'published' ? '保存' : '发布'}
        cancelText="取消"
        confirmLoading={pubLoading}
        width={620}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="发布后学生才能作答，可以选择让所有学生看到，或者只给点名的学生看"
          description="指定学生之后，不在名单里的学生连这份卷子都看不到（不是只挡住「开始答题」）。"
        />

        <Divider orientation="left" plain style={{ margin: '4px 0 12px' }}>
          谁能看到这份试卷
        </Divider>

        <Radio.Group value={pubMode} onChange={(e) => setPubMode(e.target.value)} style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={10}>
            <Radio value="all">
              <Space direction="vertical" size={0}>
                <span>所有学生</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  发布了就能在所有人的试卷列表和首页看到
                </Typography.Text>
              </Space>
            </Radio>
            <Radio value="selected">
              <Space direction="vertical" size={0}>
                <span>指定学生</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  只给下面勾选的学生看，其他人看不到这份卷子
                </Typography.Text>
              </Space>
            </Radio>
          </Space>
        </Radio.Group>

        {pubMode === 'selected' && (
          <>
            <Select
              mode="multiple"
              allowClear
              style={{ width: '100%' }}
              placeholder={students.length ? '搜索并勾选学生' : '还没有学生账号，先去「用户管理」创建'}
              value={pubIds}
              onChange={(v) => setPubIds(v)}
              optionFilterProp="label"
              maxTagCount="responsive"
              options={students.map((s) => ({ value: s.id, label: `${s.displayName}（${s.username}）` }))}
              notFoundContent="没有可选的学生"
            />
            <Space style={{ marginTop: 8 }} size={10} wrap>
              <Button size="small" onClick={() => setPubIds(students.map((s) => s.id))}>
                全选（{students.length} 人）
              </Button>
              <Button size="small" onClick={() => setPubIds([])}>
                清空
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已选 {pubIds.length} 人
              </Typography.Text>
            </Space>
          </>
        )}
      </Modal>

      {/* ---------- 随机练习 ---------- */}
      <Modal
        title="随机练习"
        open={practiceOpen}
        onOk={startPractice}
        onCancel={() => setPracticeOpen(false)}
        okText="开始"
        cancelText="取消"
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="练习卷只算自己的成绩，不会出现在「试卷」列表里"
          description="练习同样会计时和判分，但可以从「我的答卷」里随时回看解析。"
        />
        <Form form={practiceForm} layout="vertical">
          <Form.Item name="categoryId" label="分类" tooltip="留空则从整个题库随机抽">
            <Select allowClear placeholder="全部分类" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Form.Item name="count" label="题目数量（1–100）" rules={[{ required: true }]} tooltip="题目不够时会提示缺多少">
            <InputNumber min={1} max={100} />
          </Form.Item>
          <Form.Item name="durationMin" label="时长（分钟）" tooltip="到点自动交卷">
            <InputNumber min={1} max={1440} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---------- 试卷预览（考生视角） ---------- */}
      <PaperPreviewModal
        open={previewOpen}
        preview={preview}
        loading={previewLoading}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
