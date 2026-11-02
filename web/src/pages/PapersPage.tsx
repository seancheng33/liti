import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  type MenuProps,
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
  MoreOutlined,
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
  type StudentGroup,
  type StudentOption,
} from '../types';

const STATUS_COLOR: Record<string, string> = { draft: 'default', published: 'green', archived: 'orange' };
const STATUS_LABEL: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' };

/** 毫秒时间戳 → "MM-DD HH:mm"，用服务端时区显示的同一套格式 */
function fmtShort(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 本地时间字符串 → 时间戳；解析不了返回 NaN */
function parseLocal(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

export default function PapersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exportTarget, setExportTarget] = useState<Paper | null>(null);
  const [exportClass, setExportClass] = useState<string>('');
  const [classes, setClasses] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [form] = Form.useForm();

  // 手选题目
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<Question[]>([]);

  // 预览
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PaperPreview | null>(null);

  // 发布 / 可见范围
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<Paper | null>(null);
  const [pubMode, setPubMode] = useState<'all' | 'selected'>('all');
  const [pubIds, setPubIds] = useState<number[]>([]);
  const [pubGroupIds, setPubGroupIds] = useState<number[]>([]);
  const [pubLoading, setPubLoading] = useState(false);

  const isManager = user?.role === 'admin' || user?.role === 'teacher';
  const isStudent = user?.role === 'student';
  const mode = Form.useWatch('mode', form);
  // 实时算总分：及格分是绝对分，不把总分摆在旁边，60 分到底合不合理根本看不出来
  const perScore = Form.useWatch('perQuestionScore', form) ?? 1;
  const passWatch = Form.useWatch('passScore', form);
  const watchedRules = Form.useWatch('randomRules', form) as PaperRule[] | undefined;
  const draftCount = mode === 'fixed' ? picked.length : (watchedRules ?? []).reduce((s, r) => s + (r?.count || 0), 0);
  const draftTotal = draftCount * (perScore || 1);
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
    // 学生名册与分组只有教师/管理员用得上（发布时挑人）
    if (isManager) {
      api.get<StudentOption[]>('/api/users/students').then(setStudents).catch(() => {});
      api.get<StudentGroup[]>('/api/groups').then(setGroups).catch(() => {});
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
      // 默认 10 分/题：10 题正好 100 分，学校习惯的百分制；题量变了总分跟着变
      perQuestionScore: 10,
      maxAttempts: MAX_ATTEMPTS_PER_PAPER,
      passScore: settings?.defaultPassScore ?? 60,
      publication: 'after_submit',
      shuffleOptions: true,
      allowStudentPause: true,
      startAt: undefined,
      endAt: undefined,
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

    // 四个选项落到两个字段上：review_mode 决定「什么时候给看」，analysis_published 决定「现在给不给」
    const pub = values.publication ?? 'after_submit';
    const reviewMode = pub === 'immediate' ? 'immediate' : pub === 'never' ? 'never' : 'after_submit';
    const analysisPublished = pub === 'after_submit' || pub === 'immediate';
    // 「考完统一公布」= 分数和解析都先压着，等老师在试卷列表点「公布」
    const resultsPublished = pub !== 'manual';

    if (values.passScore != null && draftTotal > 0 && values.passScore > draftTotal) {
      message.warning(`及格分 ${values.passScore} 分超过了满分 ${draftTotal} 分，这样没人能及格`);
      return null;
    }

    return {
      title: values.title,
      mode: values.mode,
      durationSec: values.durationMin * 60,
      perQuestionScore: values.perQuestionScore ?? 1,
      passScore: values.passScore,
      reviewMode,
      analysisPublished,
      resultsPublished,
      shuffleOptions: values.shuffleOptions,
      startAt: parseLocal(values.startAt),
      endAt: parseLocal(values.endAt),
      allowStudentPause: values.allowStudentPause !== false,
      maxAttempts: values.maxAttempts ?? MAX_ATTEMPTS_PER_PAPER,
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

  /** 打开发布 / 可见范围弹窗，先把该卷当前的名单读出来 */
  async function openPublish(paper: Paper) {
    setPublishTarget(paper);
    setPubMode(paper.audience_mode === 'selected' ? 'selected' : 'all');
    setPubIds(paper.audience_user_ids ?? []);
    setPubGroupIds(paper.audience_group_ids ?? []);
    setPublishOpen(true);
    try {
      const aud = await api.get<{
        audienceMode: 'all' | 'selected';
        audienceUserIds: number[];
        audienceGroupIds: number[];
      }>(`/api/papers/${paper.id}/audience`);
      setPubMode(aud.audienceMode);
      setPubIds(aud.audienceUserIds);
      setPubGroupIds(aud.audienceGroupIds ?? []);
    } catch {
      /* 草稿还没发布过，读不到就用默认值 */
    }
  }

  async function confirmPublish() {
    if (!publishTarget) return;
    if (pubMode === 'selected' && !pubIds.length && !pubGroupIds.length) {
      message.warning('选了「指定学生」就要至少勾一个学生或一个分组');
      return;
    }
    setPubLoading(true);
    try {
      const body = { audienceMode: pubMode, audienceUserIds: pubIds, audienceGroupIds: pubGroupIds };
      if (publishTarget.status === 'published') {
        await api.put(`/api/papers/${publishTarget.id}/audience`, body);
        message.success('可见范围已更新');
      } else {
        await api.post(`/api/papers/${publishTarget.id}/publish`, body);
        message.success(
          pubMode === 'selected'
            ? `已发布，可见范围：${pubIds.length} 名学生 + ${pubGroupIds.length} 个分组`
            : '已发布，所有学生可见',
        );
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

  /** 归档：卷子下线但成绩保留。有答卷的卷子不能删，只能走这里 */
  async function archive(id: number) {
    try {
      await api.post(`/api/papers/${id}/archive`);
      message.success('已归档：学生看不到这份卷子了，历史成绩保留');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  /** 放分 / 放解析：正式考试考完统一公布 */
  async function publishResults(paper: Paper, opts: { results?: boolean; analysis?: boolean }, label: string) {
    try {
      await api.post(`/api/papers/${paper.id}/publish-results`, opts);
      message.success(`${label}已公布，学生现在可以看了`);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  /** 强制收卷：这场考试立刻结束 */
  async function closeExam(paper: Paper) {
    try {
      const r = await api.post<{ closed: number }>(`/api/papers/${paper.id}/close`);
      message.success(`已收卷，${r.closed} 份进行中的答卷已判分`);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  /** 低频动作统一从「更多」下拉里点，避免一行挤八九个链接换行 */
  function onMore(key: string, r: Paper) {
    const confirm = (title: string, content: string, okText: string, onOk: () => Promise<void> | void, danger = false) =>
      Modal.confirm({ title, content, okText, cancelText: '取消', okButtonProps: { danger }, onOk });
    switch (key) {
      case 'publish':
      case 'audience':
        openPublish(r);
        break;
      case 'close':
        confirm('强制收卷？', '所有还在答题的考生会被立即判分结束，不可撤销', '收卷', () => closeExam(r));
        break;
      case 'results':
        confirm(
          '公布成绩？',
          '公布后学生就能看到自己的分数（答案仍按解析设置决定是否可见）',
          '公布',
          () => publishResults(r, { results: true }, '成绩'),
        );
        break;
      case 'analysis':
        confirm(
          '公布答案与解析？',
          '公布后学生能看到正确答案和解析，请确认所有场次都已考完',
          '公布',
          () => publishResults(r, { analysis: true }, '解析'),
        );
        break;
      case 'export':
        window.location.href = `/api/attempts/export?paperId=${r.id}`;
        break;
      case 'examAnalysis':
        navigate(`/analysis/${r.id}`);
        break;
      case 'proctor':
        navigate(`/proctor/${r.id}`);
        break;
      case 'exportClass':
        setExportClass('');
        setExportTarget(r);
        api
          .get<string[]>('/api/users/classes')
          .then(setClasses)
          .catch(() => setClasses([]));
        break;
      case 'archive':
        confirm('归档这份试卷？', '学生看不到它了，历史答卷与成绩全部保留', '归档', () => archive(r.id));
        break;
      case 'delete':
        confirm('确认删除该试卷？', '已有答卷的试卷不能删除，只能归档', '删除', () => remove(r.id), true);
        break;
      default:
        break;
    }
  }

  /** 这场考试的状态：未开始 / 进行中 / 已结束 / 不限时间 */
  function windowState(p: Paper): 'none' | 'before' | 'open' | 'after' {
    const now = Date.now();
    if (p.start_at == null && p.end_at == null) return 'none';
    if (p.start_at != null && now < p.start_at) return 'before';
    if (p.end_at != null && now >= p.end_at) return 'after';
    return 'open';
  }

  const columns = [
    {
      title: '试卷',
      dataIndex: 'title',
      width: 200,
      render: (title: string, r: Paper) => (
        // 列一多标题会被挤成逐字竖排，必须自己限宽 + 省略号
        <Space direction="vertical" size={0} style={{ maxWidth: 172 }}>
          <Typography.Text strong ellipsis={{ tooltip: title }}>
            {title}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            #{r.id}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '组卷',
      dataIndex: 'mode',
      width: 76,
      render: (m: string) => <Tag color={m === 'random' ? 'purple' : 'blue'}>{m === 'random' ? '随机' : '手选'}</Tag>,
    },
    {
      // 题量和总分拆两列时表格会横向溢出，合起来反而一眼看清「几题几分」
      title: '题量 · 总分',
      key: 'scale',
      width: 116,
      render: (_: unknown, r: Paper) => {
        const total = r.question_count * (r.per_question_score ?? 1);
        return (
          <Tooltip title={`每题 ${r.per_question_score ?? 1} 分 × ${r.question_count} 题`}>
            <span>
              {r.question_count} 题 · {total} 分
            </span>
          </Tooltip>
        );
      },
    },
    { title: '时长', dataIndex: 'duration_sec', width: 78, render: (d: number) => `${Math.round(d / 60)} 分钟` },
    {
      title: '考试时间',
      key: 'window',
      width: 172,
      render: (_: unknown, r: Paper) => {
        const st = windowState(r);
        if (st === 'none') return <Typography.Text type="secondary">不限（随时可考）</Typography.Text>;
        const color = st === 'before' ? 'default' : st === 'open' ? 'green' : 'orange';
        const label = st === 'before' ? '未开始' : st === 'open' ? '进行中' : '已结束';
        return (
          <Space direction="vertical" size={0}>
            <Tag color={color}>{label}</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.start_at ? fmtShort(r.start_at) : '随时'} ~ {r.end_at ? fmtShort(r.end_at) : '不限'}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '可见',
      dataIndex: 'audience_mode',
      width: 96,
      render: (m: string, r: Paper) =>
        m === 'selected' ? (
          <Tooltip title="只对点名的学生 / 分组可见，其他人看不到这份卷子">
            <Tag color="geekblue" icon={<TeamOutlined />}>
              {r.audience_count ?? 0} 人
              {(r.audience_group_count ?? 0) > 0 ? ` / ${r.audience_group_count} 组` : ''}
            </Tag>
          </Tooltip>
        ) : (
          <Tag>全部</Tag>
        ),
    },
    ...(isStudent
      ? [
          {
            title: '作答次数',
            key: 'attempts',
            width: 120,
            render: (_: unknown, r: Paper) => {
              const limit = r.max_attempts ?? MAX_ATTEMPTS_PER_PAPER;
              // 练习卷后端给 null，表示不限次数
              const left = r.remaining_attempts === null ? null : (r.remaining_attempts ?? limit);
              return (
                <Tooltip
                  title={
                    left === null
                      ? '练习卷不限作答次数'
                      : `这份试卷最多可作答 ${limit} 次，每次交卷后重新开始`
                  }
                >
                  <Typography.Text
                    type={left === null ? 'secondary' : left === 0 ? 'danger' : left <= 1 ? 'warning' : 'secondary'}
                  >
                    {left === null ? '不限次数' : left > 0 ? `还可答 ${left} 次` : '次数已用完'}
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
      width: 84,
      render: (s: string) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s] ?? s}</Tag>,
    },
    {
      title: '操作',
      key: 'op',
      width: 158,
      fixed: 'right' as const,
      render: (_: unknown, r: Paper) => {
        // null = 练习卷不限次数，不能当成 0 处理，否则按钮会被误禁
        const left = r.remaining_attempts === null ? Infinity : (r.remaining_attempts ?? r.max_attempts ?? MAX_ATTEMPTS_PER_PAPER);
        const open = windowState(r) !== 'after';
        // 只在管理员视角才需要那一堆低频动作
        const more: MenuProps['items'] = isManager
          ? [
              { key: 'publish', label: r.status === 'published' ? '可见范围' : '发布' },
              ...(r.status === 'published'
                ? [
                    { key: 'close', label: '强制收卷' },
                    ...(r.results_published === 0 ? [{ key: 'results', label: '公布成绩' }] : []),
                    ...(r.analysis_published === 0 && r.review_mode !== 'never'
                      ? [{ key: 'analysis', label: '公布答案与解析' }]
                      : []),
                  ]
                : []),
              { type: 'divider' as const },
              { key: 'proctor', label: '实时监考' },
              { key: 'examAnalysis', label: '逐题分析' },
              { key: 'export', label: '导出成绩（含缺考）' },
              { key: 'exportClass', label: '按班级导出成绩' },
              ...(r.status !== 'archived' ? [{ key: 'archive', label: '归档' }] : []),
              { type: 'divider' as const },
              { key: 'delete', label: '删除', danger: true },
            ]
          : [];
        return (
          <Space size={10}>
            <Tooltip title="考生视角看一遍卷面，不含答案">
              <a onClick={() => openPreview(r.id)}>预览</a>
            </Tooltip>
            {r.status === 'published' &&
              (left > 0 && open ? (
                <a onClick={() => startExam(r)}>开始答题</a>
              ) : (
                <Tooltip title={open ? `最多可作答 ${r.max_attempts ?? MAX_ATTEMPTS_PER_PAPER} 次，你已经用完了` : '考试已经结束'}>
                  <span style={{ color: '#bbb', cursor: 'not-allowed' }}>{open ? '次数已用完' : '已结束'}</span>
                </Tooltip>
              ))}
            {isManager && (
              <Dropdown
                menu={{ items: more, onClick: ({ key }) => onMore(key, r) }}
                trigger={['click']}
                placement="bottomRight"
              >
                <Tooltip title="更多操作（收卷 / 公布 / 导出 / 归档）">
                  <a style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <MoreOutlined /> 更多
                  </a>
                </Tooltip>
              </Dropdown>
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
        description="随机抽题可以指定分类，也可以直接从题库里手选题目组卷。建卷时可以设开考与结束时间（到点自动收卷）、每题分值、作答次数、学生能不能自己暂停。发布时可选让所有学生看到还是只给指定学生看；成绩可以考完再统一放。"
        extra={
          <>
            {showPractice && (
              <Button icon={<ThunderboltOutlined />} onClick={() => navigate('/practice')}>
                练习中心
              </Button>
            )}
            {isManager && (
              <Tooltip title="全站答卷流水；单场成绩册请用每行的「导出成绩」">
                <Button icon={<DownloadOutlined />} href="/api/attempts/export">
                  导出全部成绩
                </Button>
              </Tooltip>
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
          scroll={{ x: 1100 }}
          pagination={{ current: page, pageSize: 20, total, onChange: setPage, showSizeChanger: false }}
        />
      </Card>

      {/* ---------- 按班级导出成绩 ---------- */}
      <Modal
        title={`按班级导出：${exportTarget?.title ?? ''}`}
        open={!!exportTarget}
        onCancel={() => setExportTarget(null)}
        onOk={() => {
          const cls = exportClass ? `&className=${encodeURIComponent(exportClass)}` : '';
          window.location.href = `/api/attempts/export?paperId=${exportTarget!.id}${cls}`;
          setExportTarget(null);
        }}
        okText="导出"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          只导出所选班级的学生，缺考的人仍然占一行写「未参加」。不选班级则导出全部应考的人。
        </Typography.Paragraph>
        <Select
          style={{ width: '100%' }}
          allowClear
          placeholder="选择班级（不选 = 全部）"
          value={exportClass || undefined}
          onChange={(v) => setExportClass(v ?? '')}
          options={classes.map((c) => ({ value: c, label: c }))}
          notFoundContent="还没有学生填班级，可以到「用户管理」里补，或用名单导入一次性写进去"
        />
      </Modal>

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
              <InputNumber min={1} max={1440} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="perQuestionScore" label="每题分值" tooltip="总分 = 题量 × 每题分值，直接影响及格线怎么算">
              <InputNumber min={1} max={100} style={{ width: 110 }} addonAfter="分" />
            </Form.Item>
            <Form.Item name="passScore" label="及格分" tooltip="按总分算的绝对分：得满这个分才算及格">
              <InputNumber min={0} max={10000} style={{ width: 120 }} addonAfter="分" />
            </Form.Item>
            <Form.Item name="shuffleOptions" label="选项乱序" valuePropName="checked" tooltip="每个学生拿到的选项顺序不同，防抄袭">
              <Switch />
            </Form.Item>
          </Space>

          <Form.Item name="publication" label="成绩与解析" tooltip="决定学生什么时候能看到分数、什么时候能看到正确答案">
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="after_submit">交卷后公布</Radio.Button>
              <Radio.Button value="manual">考完统一公布</Radio.Button>
              <Radio.Button value="immediate">答题中即时反馈</Radio.Button>
              <Radio.Button value="never">永不公布</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <div style={{ marginTop: -12, marginBottom: 16 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              当前：{draftCount} 题 × {perScore || 1} 分 = 满分 {draftTotal} 分
              {draftTotal > 0 && passWatch != null
                ? `，及格线 ${passWatch} 分（${Math.round((Number(passWatch) / draftTotal) * 100)}%）`
                : ''}
            </Typography.Text>
          </div>

          <Card size="small" title="考试组织（正式考试建议填）" style={{ marginBottom: 16 }}>
            <Space size={16} wrap>
              <Form.Item name="startAt" label="开考时间" tooltip="不填 = 随时可考；填了以后学生提前点也进不去">
                <Input type="datetime-local" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="endAt" label="结束时间" tooltip="统一收卷：到点后所有答卷自动判分，谁的剩余时间都不会超过这个点">
                <Input type="datetime-local" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item
                name="allowStudentPause"
                label="学生可自行暂停"
                valuePropName="checked"
                tooltip="正式考试请关闭：能随时停表，就等于能随时出去查资料"
              >
                <Switch checkedChildren="允许" unCheckedChildren="禁止" />
              </Form.Item>
              <Form.Item
                name="maxAttempts"
                label="可作答次数"
                tooltip="一场正式考试请设 1：允许考两次就等于取最高分。练习卷（练习中心生成）不受这个限制"
              >
                <InputNumber min={1} max={99} style={{ width: 130 }} addonAfter="次" />
              </Form.Item>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              提示：正式统考建议「可作答次数 = 1、学生可自行暂停 = 关、成绩与解析 = 考完统一公布」。
            </Typography.Text>
          </Card>

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
          message="发布后学生才能作答，可以选择让所有学生看到，也可以只给点名的学生 / 分组看"
          description="不在范围内的学生连这份卷子都看不到（不是只挡住「开始答题」）。挂分组的好处是：往组里加人之后，这份卷子他立刻也能看到。"
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
                <span>指定学生 / 分组</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  只给下面勾选的学生，以及勾选分组里的学生看；两者取并集
                </Typography.Text>
              </Space>
            </Radio>
          </Space>
        </Radio.Group>

        {pubMode === 'selected' && (
          <>
            <div className="liti-field-label">按分组（推荐：一班、二班这样整组发）</div>
            <Select
              mode="multiple"
              allowClear
              style={{ width: '100%', marginBottom: 14 }}
              placeholder={groups.length ? '搜索并勾选分组' : '还没有分组，可以先到「学生分组」里建一个'}
              value={pubGroupIds}
              onChange={(v) => setPubGroupIds(v)}
              optionFilterProp="label"
              maxTagCount="responsive"
              options={groups.map((g) => ({ value: g.id, label: `${g.name}（${g.memberCount} 人）` }))}
              notFoundContent="没有可选的分组"
            />

            <div className="liti-field-label">再点名个别学生（可留空）</div>
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
                全选学生（{students.length} 人）
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setPubIds([]);
                  setPubGroupIds([]);
                }}
              >
                清空
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已选 {pubIds.length} 人 + {pubGroupIds.length} 个分组
              </Typography.Text>
            </Space>
          </>
        )}
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
