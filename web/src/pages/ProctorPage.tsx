import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useAuth } from '../auth';
import PageHeader from '../components/PageHeader';
import {
  PROCTOR_STATUS_LABEL,
  VIOLATION_TYPE_LABEL,
  type ProctorEntry,
  type ProctorStatus,
  type ProctorView,
  type ViolationItem,
} from '../types';

/** 监考页刷新间隔。10 秒够看清「谁掉线了」，又不至于把服务器刷爆 */
const POLL_MS = 10_000;

const STATUS_COLOR: Record<ProctorStatus, string> = {
  'not-started': 'default',
  'in-progress': 'green',
  paused: 'orange',
  submitted: 'blue',
  expired: 'red',
};

function fmtClock(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtAgo(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 5) return '刚刚';
  if (sec < 60) return `${sec} 秒前`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} 分钟前`;
  return `${Math.floor(m / 60)} 小时前`;
}

function fmtRemain(sec: number | null): string {
  if (sec == null) return '—';
  if (sec <= 0) return '已到点';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 进行中的状态筛选键 */
type FilterKey = 'all' | 'live' | 'offline' | 'not-started' | 'done';

export default function ProctorPage() {
  const { paperId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isManager = user?.role === 'admin' || user?.role === 'teacher';

  const [data, setData] = useState<ProctorView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [className, setClassName] = useState('');
  const [keyword, setKeyword] = useState('');
  const [classes, setClasses] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // 违规明细
  const [violationFor, setViolationFor] = useState<ProctorEntry | null>(null);
  const [violations, setViolations] = useState<ViolationItem[]>([]);
  const [violationLoading, setViolationLoading] = useState(false);
  const [revokeNote, setRevokeNote] = useState('');
  const [actingId, setActingId] = useState<number | null>(null);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true);
      try {
        const res = await api.get<ProctorView>(`/api/papers/${paperId}/proctor`);
        setData(res);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (e) {
        if (!silent) setData(null);
        setError((e as Error).message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [paperId],
  );

  useEffect(() => {
    if (!isManager) {
      setLoading(false);
      return;
    }
    void load(false);
    api
      .get<string[]>('/api/users/classes')
      .then(setClasses)
      .catch(() => setClasses([]));
  }, [isManager, load]);

  // 静默轮询：不切 loading，表格不闪
  useEffect(() => {
    if (!isManager || !autoRefresh) return;
    const t = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(t);
  }, [isManager, autoRefresh, load]);

  const entries = useMemo(() => {
    if (!data) return [];
    let list = data.entries;
    if (className) list = list.filter((e) => (e.className ?? '') === className);
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.displayName.toLowerCase().includes(k) ||
          e.username.toLowerCase().includes(k) ||
          (e.studentNo ?? '').toLowerCase().includes(k),
      );
    }
    switch (filter) {
      case 'live':
        return list.filter((e) => e.status === 'in-progress' && e.online !== false);
      case 'offline':
        return list.filter((e) => e.status === 'in-progress' && e.online === false);
      case 'not-started':
        return list.filter((e) => e.status === 'not-started');
      case 'done':
        return list.filter((e) => e.status === 'submitted' || e.status === 'expired');
      default:
        return list;
    }
  }, [data, className, keyword, filter]);

  const openViolations = useCallback(async (entry: ProctorEntry) => {
    if (!entry.attemptId) return;
    setViolationFor(entry);
    setViolationLoading(true);
    setRevokeNote('');
    try {
      const res = await api.get<{ items: ViolationItem[] }>(`/api/attempts/${entry.attemptId}/violations`);
      setViolations(res.items);
    } catch (e) {
      message.error((e as Error).message);
      setViolations([]);
    } finally {
      setViolationLoading(false);
    }
  }, []);

  const act = useCallback(
    async (item: ViolationItem, action: 'revoke' | 'restore') => {
      if (!violationFor?.attemptId) return;
      setActingId(item.id);
      try {
        await api.post(
          `/api/attempts/${violationFor.attemptId}/violations/${item.id}/${action}`,
          action === 'revoke' ? { note: revokeNote.trim() || undefined } : {},
        );
        message.success(action === 'revoke' ? '已撤销这条违规' : '已恢复这条违规');
        const res = await api.get<{ items: ViolationItem[] }>(
          `/api/attempts/${violationFor.attemptId}/violations`,
        );
        setViolations(res.items);
        // 主表的违规计数也变了，立刻刷一次（不静默，让老师看到数字确实动了）
        await load(true);
      } catch (e) {
        message.error((e as Error).message);
      } finally {
        setActingId(null);
      }
    },
    [violationFor, revokeNote, load],
  );

  if (!isManager) {
    return (
      <div className="liti-page">
        <PageHeader title="实时监考" description="只有教师与管理员能进入监考视图。" />
        <Card>
          <Empty description="你没有进入监考的权限" />
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

  if (error && !data) {
    return (
      <div className="liti-page">
        <PageHeader title="实时监考" description="看谁在答、谁掉线、谁被记了违规" />
        <Card>
          <Empty description={error} />
        </Card>
      </div>
    );
  }

  const s = data!.summary;

  const columns = [
    {
      title: '学号',
      dataIndex: 'studentNo',
      width: 108,
      render: (v: string | null) => v || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '姓名',
      dataIndex: 'displayName',
      width: 130,
      render: (v: string, r: ProctorEntry) => (
        <div>
          <div>{v}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.username}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '班级',
      dataIndex: 'className',
      width: 140,
      render: (v: string | null) => v || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 128,
      render: (st: ProctorStatus, r: ProctorEntry) => (
        <Space size={4} wrap>
          <Tag color={STATUS_COLOR[st]} style={{ marginInlineEnd: 0 }}>
            {PROCTOR_STATUS_LABEL[st]}
          </Tag>
          {r.status === 'in-progress' && r.online === false && (
            <Tooltip title={`最近一次心跳在 ${fmtAgo(r.lastSeenSec)}`}>
              <Tag color="red" style={{ marginInlineEnd: 0 }}>
                掉线
              </Tag>
            </Tooltip>
          )}
          {r.status === 'in-progress' && r.online === true && <Badge status="processing" text="" />}
        </Space>
      ),
    },
    {
      title: '已答',
      dataIndex: 'answeredCount',
      width: 88,
      render: (v: number, r: ProctorEntry) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {v}
          <Typography.Text type="secondary">/{r.questionCount}</Typography.Text>
        </span>
      ),
    },
    {
      title: '剩余',
      dataIndex: 'remainingSec',
      width: 88,
      render: (v: number | null, r: ProctorEntry) =>
        r.status === 'paused' ? (
          <Tooltip title={`已暂停 ${fmtAgo(r.pausedSec)}`}>
            <Tag color="orange">暂停中</Tag>
          </Tooltip>
        ) : (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtRemain(v)}</span>
        ),
    },
    {
      title: '违规',
      dataIndex: 'violations',
      width: 96,
      render: (v: number, r: ProctorEntry) =>
        r.violationTotal === 0 ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Tag color={v > 0 ? 'red' : 'default'} style={{ cursor: r.attemptId ? 'pointer' : 'default' }}>
            {v}
            {r.violationTotal !== v && <span style={{ opacity: 0.65 }}>（已撤 {r.violationTotal - v}）</span>}
          </Tag>
        ),
    },
    {
      title: '最后心跳',
      dataIndex: 'lastSeenSec',
      width: 110,
      render: (v: number | null, r: ProctorEntry) =>
        r.status === 'in-progress' ? (
          <span style={{ color: v != null && v > 90 ? '#dc2626' : undefined }}>{fmtAgo(v)}</span>
        ) : r.submittedAt ? (
          <Typography.Text type="secondary">{fmtClock(r.submittedAt)} 交卷</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '成绩',
      dataIndex: 'score',
      width: 96,
      render: (v: number | null, r: ProctorEntry) => {
        if (r.status !== 'submitted' && r.status !== 'expired') return <Typography.Text type="secondary">—</Typography.Text>;
        // 未公布就是未公布，绝不能落到 0 —— 那是两件完全不同的事
        if (v == null) return <Tag>未公布</Tag>;
        return (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {v}
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              /{r.totalScore}
            </Typography.Text>
          </span>
        );
      },
    },
    {
      title: '操作',
      key: 'op',
      width: 96,
      fixed: 'right' as const,
      render: (_: unknown, r: ProctorEntry) =>
        r.attemptId && r.violationTotal > 0 ? (
          <Button size="small" type="link" onClick={() => void openViolations(r)} style={{ paddingInline: 0 }}>
            违规明细
          </Button>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
  ];

  return (
    <div className="liti-page">
      <PageHeader
        title="实时监考"
        description={`《${data!.paper.title}》· ${data!.paper.questionCount} 题 · 满分 ${data!.paper.totalScore} 分 · 应考 ${s.rosterCount} 人`}
        extra={
          <Space wrap>
            <Tooltip title={updatedAt ? `上次刷新 ${fmtClock(updatedAt)}` : ''}>
              <Space size={6}>
                <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  每 {POLL_MS / 1000} 秒自动刷新
                </Typography.Text>
              </Space>
            </Tooltip>
            <Button icon={<ReloadOutlined />} onClick={() => void load(false)}>
              刷新
            </Button>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/papers')}>
              返回
            </Button>
          </Space>
        }
      />

      {data!.warnings.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="考场提示"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data!.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          }
        />
      )}

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Card className="liti-stat-card">
            <Statistic title="应考" value={s.rosterCount} suffix="人" />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card className="liti-stat-card">
            {/* 在线人数放标题里：塞进 suffix 会让这张卡单独换行，六张卡高度就不齐了。
                括号而不是「·」，是因为值本身是「在场」人数 —— 写成「在场 · 在线 5」
                会被读成「在线 5 人」，再和旁边的掉线数一加就超过应考人数了。
                在场 = 在线 + 掉线 + 暂停，掉线单独有卡，暂停在列表里标橙色。 */}
            <Statistic title={`在场（在线 ${s.online}）`} value={s.inProgress + s.paused} suffix="人" />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card className="liti-stat-card">
            <Statistic
              title="掉线"
              value={s.offline + s.unknownSeen}
              suffix="人"
              valueStyle={{ color: s.offline + s.unknownSeen > 0 ? '#dc2626' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card className="liti-stat-card">
            <Statistic title="已交卷" value={s.submitted + s.expired} suffix="人" />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card className="liti-stat-card">
            <Statistic title="未开始" value={s.notStarted} suffix="人" />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card className="liti-stat-card">
            <Statistic
              title="违规"
              value={s.violationTotal}
              suffix={`次 · ${s.violationStudents} 人`}
              valueStyle={{ color: s.violationTotal > 0 ? '#dc2626' : undefined }}
            />
          </Card>
        </Col>
      </Row>

      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as FilterKey)}
            options={[
              { label: '全部', value: 'all' },
              { label: '在场', value: 'live' },
              { label: `掉线 ${s.offline + s.unknownSeen}`, value: 'offline' },
              { label: '未开始', value: 'not-started' },
              { label: '已结束', value: 'done' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜姓名 / 用户名 / 学号"
            style={{ width: 220 }}
            onSearch={setKeyword}
            onChange={(e) => !e.target.value && setKeyword('')}
          />
          <Select
            allowClear
            placeholder="全部班级"
            style={{ width: 160 }}
            value={className || undefined}
            onChange={(v) => setClassName(v ?? '')}
            options={classes.map((c) => ({ label: c, value: c }))}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            当前显示 {entries.length} 人
          </Typography.Text>
        </Space>

        <Table<ProctorEntry>
          rowKey="userId"
          size="small"
          dataSource={entries}
          columns={columns}
          scroll={{ x: 1080 }}
          pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200] }}
          locale={{ emptyText: <Empty description="没有符合条件的学生" /> }}
        />
      </Card>

      <Modal
        open={!!violationFor}
        title={violationFor ? `${violationFor.displayName} 的违规记录` : ''}
        onCancel={() => setViolationFor(null)}
        footer={
          <Button onClick={() => setViolationFor(null)}>关闭</Button>
        }
        width={640}
        destroyOnClose
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            撤销只影响次数统计，不改动已判的分数与交卷状态。撤销理由会记在记录上，事后可查。
          </Typography.Text>
          <Input
            placeholder="撤销理由（选填，例如：学生误触 F5，已确认）"
            value={revokeNote}
            onChange={(e) => setRevokeNote(e.target.value)}
            maxLength={200}
          />
          {violationLoading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Spin />
            </div>
          ) : violations.length === 0 ? (
            <Empty description="这条答卷没有违规记录" />
          ) : (
            <div>
              {violations.map((v) => (
                <div
                  key={v.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 0',
                    borderBottom: '1px solid rgba(0,0,0,0.06)',
                    opacity: v.revoked ? 0.55 : 1,
                  }}
                >
                  <Typography.Text style={{ fontVariantNumeric: 'tabular-nums', width: 76 }}>
                    {fmtClock(v.occurredAt)}
                  </Typography.Text>
                  <Tag color={v.revoked ? 'default' : 'red'} style={{ marginInlineEnd: 0 }}>
                    {VIOLATION_TYPE_LABEL[v.type] ?? v.type}
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1 }}>
                    {v.revoked
                      ? `已撤销${v.revokedByName ? `（${v.revokedByName}）` : ''}${v.revokeNote ? `：${v.revokeNote}` : ''}`
                      : ''}
                  </Typography.Text>
                  <Button
                    size="small"
                    danger={!v.revoked}
                    loading={actingId === v.id}
                    onClick={() => void act(v, v.revoked ? 'restore' : 'revoke')}
                  >
                    {v.revoked ? '恢复' : '撤销'}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 4 }}
            message="已经因为违规被强制交卷的答卷不会自动改回来"
            description="撤销只让次数退回去，让它不再占用额度；如果这名学生其实是被误判的，需要你在成绩册里另行处理（例如人工补录成绩）。"
          />
        </Space>
      </Modal>

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <SafetyCertificateOutlined /> 在线判定：学生答题页每 20 秒发一次心跳，超过 {Math.round(data!.offlineAfterMs / 1000)} 秒没收到即视为掉线。
          掉线不等于作弊，可能只是网络断了 —— 请结合实际确认。
        </Typography.Text>
      </div>
    </div>
  );
}
