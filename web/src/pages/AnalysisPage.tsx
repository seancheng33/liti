import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ArrowLeftOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useAuth } from '../auth';
import PageHeader from '../components/PageHeader';
import { VERDICT_LABEL, type AnalysisQuestion, type PaperAnalysis, type QuestionVerdict } from '../types';

const VERDICT_COLOR: Record<QuestionVerdict, string> = {
  normal: 'default',
  'too-hard': 'orange',
  'too-easy': 'blue',
  'low-discrimination': 'gold',
  'check-answer': 'red',
};

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** P 值越低越该关注，颜色跟着走 */
function pColor(p: number): string {
  if (p >= 0.6) return '#16a34a';
  if (p >= 0.3) return '#fa8c16';
  return '#dc2626';
}

/** D 值 0.3 以上是好题，0.2 以下偏弱，负数说明大概率答案设错 */
function dColor(d: number | null): string | undefined {
  if (d == null) return undefined;
  if (d < 0) return '#dc2626';
  if (d < 0.2) return '#fa8c16';
  if (d >= 0.3) return '#16a34a';
  return undefined;
}

function fmtDuration(sec: number): string {
  if (sec <= 0) return '0 秒';
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} 分 ${s} 秒` : `${m} 分`;
}

export default function AnalysisPage() {
  const { paperId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isManager = user?.role === 'admin' || user?.role === 'teacher';

  const [data, setData] = useState<PaperAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [className, setClassName] = useState<string>('');
  /** 只看需要关注的题（非「正常」） */
  const [onlyIssues, setOnlyIssues] = useState(false);

  const load = useCallback(
    async (cls: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ paperId: String(paperId) });
        if (cls) qs.set('className', cls);
        const res = await api.get<PaperAnalysis>(`/api/attempts/analysis?${qs.toString()}`);
        setData(res);
      } catch (e) {
        setData(null);
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [paperId],
  );

  useEffect(() => {
    if (!isManager) {
      setLoading(false);
      return;
    }
    void load(className);
    // 班级下拉只在首次进页面拉一次
    api
      .get<string[]>('/api/users/classes')
      .then(setClasses)
      .catch(() => setClasses([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, paperId]);

  const questions = useMemo(() => {
    if (!data) return [];
    return onlyIssues ? data.questions.filter((q) => q.verdict !== 'normal') : data.questions;
  }, [data, onlyIssues]);

  const issueCount = useMemo(() => (data ? data.questions.filter((q) => q.verdict !== 'normal').length : 0), [data]);

  if (!isManager) {
    return (
      <div className="liti-page">
        <PageHeader title="逐题分析" description="只有教师与管理员能看逐题分析。" />
        <Card>
          <Empty description="你没有查看逐题分析的权限" />
        </Card>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ padding: 120, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="liti-page">
      <PageHeader
        title="逐题分析"
        description={
          data
            ? `《${data.paper.title}》· ${data.paper.questionCount} 题 · 满分 ${data.paper.totalScore} 分 · 及格线 ${data.paper.passScore} 分`
            : 'P 值（正确率）、D 值（区分度）、选项分布与分数段'
        }
        extra={
          <Space wrap>
            <Select
              value={className}
              onChange={(v) => {
                setClassName(v);
                void load(v);
              }}
              style={{ width: 180 }}
              placeholder="全部班级"
              allowClear
              options={[{ value: '', label: '全部班级' }, ...classes.map((c) => ({ value: c, label: c }))]}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void load(className)}>
              刷新
            </Button>
            <Button
              icon={<DownloadOutlined />}
              href={`/api/attempts/analysis/export?paperId=${paperId}${className ? `&className=${encodeURIComponent(className)}` : ''}`}
            >
              导出分析
            </Button>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/papers')}>
              返回试卷
            </Button>
          </Space>
        }
      />

      {error && (
        <Alert
          type="warning"
          showIcon
          message="没能生成分析"
          description={error}
          style={{ marginBottom: 16 }}
          action={
            <Button size="small" onClick={() => void load(className)}>
              重试
            </Button>
          }
        />
      )}

      {data && (
        <>
          {data.warnings.length > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="先看这几条"
              description={
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {data.warnings.map((w) => (
                    <li key={w} style={{ marginBottom: 2 }}>
                      {w}
                    </li>
                  ))}
                </ul>
              }
            />
          )}

          <Row gutter={[16, 16]}>
            <Col xs={12} sm={8} md={4}>
              <Card className="liti-stat-card">
                <Statistic
                  title="实考 / 应考"
                  value={data.summary.participantCount}
                  suffix={`/ ${data.summary.rosterCount}`}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card className="liti-stat-card">
                {/* 分母写成满分，比「57.5 (57.5%)」短，六个卡片才能保持等高单行 */}
                <Statistic title="平均分" value={data.summary.avgScore} suffix={`/ ${data.paper.totalScore}`} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card className="liti-stat-card">
                <Statistic title="及格率" value={`${Math.round(data.summary.passRate * 1000) / 10}%`} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card className="liti-stat-card">
                <Statistic title="中位数" value={data.summary.medianScore} />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card className="liti-stat-card">
                <Statistic
                  title="标准差"
                  value={data.summary.stdDev}
                  valueStyle={{ color: data.summary.stdDev >= 12 ? undefined : '#fa8c16' }}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Card className="liti-stat-card">
                <Statistic
                  title="平均用时"
                  value={data.summary.participantCount ? fmtDuration(data.summary.avgDurationSec) : '—'}
                />
              </Card>
            </Col>
          </Row>

          <Card
            title="分数分布"
            style={{ marginTop: 16 }}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                得分率 {data.summary.avgScorePercent}% · 及格 {data.summary.passCount} 人 · 最高{' '}
                {data.summary.maxScore} · 最低 {data.summary.minScore} · 缺考 {data.summary.absentCount} 人
              </Typography.Text>
            }
          >
            <ScoreHistogram buckets={data.scoreBuckets} total={data.summary.participantCount} />
          </Card>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} md={12}>
              <Card title="交卷情况" size="small">
                <Space size={[8, 8]} wrap>
                  {Object.entries(data.summary.reasonCounts)
                    .filter(([, c]) => c > 0)
                    .map(([k, c]) => (
                      <Tag key={k}>
                        {(
                          { manual: '正常交卷', timeout: '超时交卷', violation: '违规交卷', forced: '强制收卷' } as Record<
                            string,
                            string
                          >
                        )[k] ?? k}{' '}
                        {c} 人
                      </Tag>
                    ))}
                  {Object.values(data.summary.reasonCounts).every((c) => !c) && (
                    <Typography.Text type="secondary">还没有答卷</Typography.Text>
                  )}
                </Space>
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card title="考场纪律" size="small">
                {data.summary.violationTotal ? (
                  <Typography.Text>
                    切屏违规 <strong>{data.summary.violationTotal}</strong> 次，涉及{' '}
                    <strong>{data.summary.violationStudents}</strong> 人
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">没有记录到切屏违规</Typography.Text>
                )}
              </Card>
            </Col>
          </Row>

          <Card
            title={`逐题分析（${questions.length} 题）`}
            style={{ marginTop: 16 }}
            extra={
              <Space wrap size={[12, 8]}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {data.split.reliable
                    ? `D 值按总分前/后 ${Math.round(data.split.ratio * 100)}% 各 ${data.split.highCount} 人计算`
                    : '实考人数不足，D 值暂不计算'}
                </Typography.Text>
                <Segmented
                  size="small"
                  value={onlyIssues ? 'issues' : 'all'}
                  onChange={(v) => setOnlyIssues(v === 'issues')}
                  options={[
                    { label: `全部 ${data.questions.length}`, value: 'all' },
                    { label: `需关注 ${issueCount}`, value: 'issues' },
                  ]}
                />
              </Space>
            }
            styles={{ body: { padding: 0 } }}
          >
            <QuestionTable questions={questions} />
          </Card>

          <Card title="这些数字怎么读" style={{ marginTop: 16 }}>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
              <li>
                <strong>P 值（正确率）</strong>：答对人数 ÷ 实考人数。空白不答也算没拿到分，所以分母是全体考生，不是「答了的人」。
                一般 0.3–0.85 比较合适；低于 0.3 偏难，高于 0.9 偏易。
              </li>
              <li>
                <strong>D 值（区分度）</strong>：高分组正确率 − 低分组正确率。0.3 以上是好题，0.2 以下说明好学生和差学生答得差不多，
                该题对「拉开差距」没贡献。<strong>负数</strong>要特别当心 —— 差学生反而答对更多，通常是正确答案标反了。
              </li>
              <li>
                <strong>选项分布</strong>：每个选项被选中的次数。如果某个错误选项几乎没人选，说明这个干扰项是废的（学生一眼就排除了）；
                如果某个错误选项比正确答案还热门，那多半是个陷阱题，或者答案有问题。
              </li>
              <li>
                <strong>统计口径</strong>：只统计已交卷 / 已超时的答卷，每人取最近一次；进行中的答卷不算。
              </li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

/** 纯 CSS 直方图：不想为了几张柱子引一个图表库 */
function ScoreHistogram({ buckets, total }: { buckets: PaperAnalysis['scoreBuckets']; total: number }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  if (!total) return <Empty description="还没有已交卷的答卷" />;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 180 }}>
        {buckets.map((b) => {
          const h = (b.count / max) * 100;
          return (
            <div
              key={b.label}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
            >
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--liti-text-2, #666)', marginBottom: 4 }}>
                {b.count || ''}
              </div>
              <Tooltip title={`${b.label} 分：${b.count} 人`}>
                <div
                  style={{
                    height: `${h}%`,
                    minHeight: b.count ? 4 : 0,
                    background: b.count ? 'linear-gradient(180deg, #7aa7f8, #4b8bf5)' : 'transparent',
                    borderRadius: 4,
                    transition: 'height .25s ease',
                  }}
                />
              </Tooltip>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        {buckets.map((b) => (
          <div
            key={b.label}
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 11,
              color: 'var(--liti-text-3, #999)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function QuestionTable({ questions }: { questions: AnalysisQuestion[] }) {
  return (
    <Table<AnalysisQuestion>
      rowKey="questionId"
      dataSource={questions}
      pagination={questions.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
      locale={{ emptyText: '没有符合条件的题目' }}
      size="middle"
      scroll={{ x: 1020 }}
      expandable={{
        expandedRowRender: (q) => <OptionBars q={q} />,
        rowExpandable: (q) => q.options.length > 0,
      }}
      columns={[
        {
          title: '题号',
          dataIndex: 'orderNo',
          width: 64,
          render: (n: number) => <Typography.Text strong>{n}</Typography.Text>,
        },
        {
          title: '题干',
          dataIndex: 'stem',
          width: 300,
          render: (stem: string, q: AnalysisQuestion) => (
            <Space direction="vertical" size={0} style={{ maxWidth: 280 }}>
              <Typography.Text ellipsis={{ tooltip: stem }} style={{ maxWidth: 280 }}>
                {stem || '（纯图片题）'}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {q.type === 'multiple' ? '多选' : '单选'} · {q.categoryName ?? '未分类'} · {q.score} 分
                {q.hasImage ? ' · 含配图' : ''}
              </Typography.Text>
            </Space>
          ),
        },
        {
          title: '正确率 P',
          dataIndex: 'pValue',
          width: 150,
          sorter: (a: AnalysisQuestion, b: AnalysisQuestion) => a.pValue - b.pValue,
          render: (p: number) => (
            <Space size={6}>
              <span
                style={{
                  display: 'inline-block',
                  width: 60,
                  height: 6,
                  background: 'var(--liti-fill, #eef0f4)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    width: `${Math.round(p * 100)}%`,
                    height: '100%',
                    background: pColor(p),
                    borderRadius: 3,
                  }}
                />
              </span>
              <span style={{ fontSize: 12, color: pColor(p), fontVariantNumeric: 'tabular-nums' }}>{pct(p)}</span>
            </Space>
          ),
        },
        {
          title: '区分度 D',
          dataIndex: 'discrimination',
          width: 100,
          sorter: (a: AnalysisQuestion, b: AnalysisQuestion) =>
            (a.discrimination ?? -9) - (b.discrimination ?? -9),
          render: (d: number | null, q: AnalysisQuestion) =>
            d == null ? (
              <Tooltip title="实考人数不足，算不出可靠的 D 值">
                <Typography.Text type="secondary">—</Typography.Text>
              </Tooltip>
            ) : (
              <Tooltip
                title={`高分组正确率 ${q.highRate == null ? '—' : pct(q.highRate)}，低分组 ${q.lowRate == null ? '—' : pct(q.lowRate)}`}
              >
                <span style={{ color: dColor(d), fontVariantNumeric: 'tabular-nums', fontWeight: d < 0.2 ? 600 : 400 }}>
                  {d.toFixed(2)}
                </span>
              </Tooltip>
            ),
        },
        {
          title: '作答 / 未答',
          width: 110,
          render: (_: unknown, q: AnalysisQuestion) => (
            <Typography.Text style={{ fontSize: 12 }}>
              {q.answeredCount} / {q.blankCount > 0 ? <span style={{ color: '#fa8c16' }}>{q.blankCount}</span> : 0}
            </Typography.Text>
          ),
        },
        {
          title: '判断',
          dataIndex: 'verdict',
          width: 110,
          filters: (Object.keys(VERDICT_LABEL) as QuestionVerdict[]).map((k) => ({
            text: VERDICT_LABEL[k],
            value: k,
          })),
          onFilter: (value, q) => q.verdict === value,
          render: (v: QuestionVerdict) => <Tag color={VERDICT_COLOR[v]}>{VERDICT_LABEL[v]}</Tag>,
        },
        {
          title: '提示',
          dataIndex: 'flags',
          render: (flags: string[]) =>
            flags.length ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {flags.join('；')}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                正常
              </Typography.Text>
            ),
        },
      ]}
    />
  );
}

/** 展开行：选项分布横条 */
function OptionBars({ q }: { q: AnalysisQuestion }) {
  const max = Math.max(1, ...q.options.map((o) => o.count), q.blankCount);
  return (
    <div style={{ padding: '4px 8px 8px' }}>
      <Row gutter={[16, 8]}>
        <Col xs={24} lg={16}>
          {q.options.map((o) => (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  lineHeight: '22px',
                  textAlign: 'center',
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  background: o.isCorrect ? '#e8f7ee' : 'var(--liti-fill, #eef0f4)',
                  color: o.isCorrect ? '#16a34a' : 'inherit',
                  flex: '0 0 auto',
                }}
              >
                {o.label}
              </span>
              <Typography.Text ellipsis={{ tooltip: o.content }} style={{ width: 260, flex: '0 0 auto' }}>
                {o.content || '（图片选项）'}
              </Typography.Text>
              <span
                style={{ flex: 1, height: 8, background: 'var(--liti-fill, #eef0f4)', borderRadius: 4, overflow: 'hidden' }}
              >
                <span
                  style={{
                    display: 'block',
                    width: `${Math.round((o.count / max) * 100)}%`,
                    height: '100%',
                    background: o.isCorrect ? '#16a34a' : '#9aa7bd',
                    borderRadius: 4,
                  }}
                />
              </span>
              <span style={{ width: 86, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                {o.count} 人 {pct(o.rate)}
              </span>
              {o.isCorrect && <Tag color="success">正确</Tag>}
            </div>
          ))}
          {q.blankCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  lineHeight: '22px',
                  textAlign: 'center',
                  borderRadius: 4,
                  fontSize: 12,
                  background: 'var(--liti-fill, #eef0f4)',
                }}
              >
                —
              </span>
              <Typography.Text type="secondary" style={{ width: 260, flex: '0 0 auto' }}>
                未作答
              </Typography.Text>
              <span
                style={{ flex: 1, height: 8, background: 'var(--liti-fill, #eef0f4)', borderRadius: 4, overflow: 'hidden' }}
              >
                <span
                  style={{
                    display: 'block',
                    width: `${Math.round((q.blankCount / max) * 100)}%`,
                    height: '100%',
                    background: '#fa8c16',
                    borderRadius: 4,
                  }}
                />
              </span>
              <span style={{ width: 86, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                {q.blankCount} 人
              </span>
            </div>
          )}
        </Col>
        <Col xs={24} lg={8}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            高分组 {q.highRate == null ? '—' : pct(q.highRate)} · 低分组 {q.lowRate == null ? '—' : pct(q.lowRate)} ·
            D 值 {q.discrimination == null ? '—' : q.discrimination.toFixed(2)}
          </Typography.Text>
          {q.flags.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--liti-text-2, #666)' }}>
              {q.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </Col>
      </Row>
    </div>
  );
}
