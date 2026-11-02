import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { DownloadOutlined, ReloadOutlined, SafetyCertificateOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import {
  AUDIT_SEVERITY_COLOR,
  AUDIT_SEVERITY_LABEL,
  AUDIT_TARGET_LABEL,
  type AuditItem,
  type AuditListResult,
  type AuditMeta,
} from '../types';

/** 时间范围只给预设，不做自定义日期区间 —— 自定义要在前端引 dayjs，为这一个筛选不值当 */
const RANGE_OPTIONS = [
  { value: 'all', label: '全部时间', days: 0 },
  { value: 'today', label: '今天', days: 1 },
  { value: '7d', label: '近 7 天', days: 7 },
  { value: '30d', label: '近 30 天', days: 30 },
  { value: '90d', label: '近 90 天', days: 90 },
];

const PURGE_OPTIONS = [
  { value: 90, label: '90 天前' },
  { value: 180, label: '180 天前' },
  { value: 365, label: '365 天前' },
];

const ROLE_LABEL: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生' };
const ROLE_COLOR: Record<string, string> = { admin: 'red', teacher: 'blue', student: 'green' };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 把 detail 压成一句人话，塞进表格那一列；完整内容在展开行里看 */
function detailSummary(detail: Record<string, unknown> | null): string {
  if (!detail) return '';
  const changes = (detail as { changes?: Record<string, { from?: unknown; to?: unknown }> }).changes;
  if (changes && typeof changes === 'object') {
    const parts = Object.entries(changes).map(([k, v]) => {
      const from = v?.from == null || v.from === '' ? '空' : String(v.from);
      const to = v?.to == null || v.to === '' ? '空' : String(v.to);
      return `${k}: ${from} → ${to}`;
    });
    return parts.join('；');
  }
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export default function AuditPage() {
  const [meta, setMeta] = useState<AuditMeta | null>(null);
  const [data, setData] = useState<AuditListResult | null>(null);
  const [loading, setLoading] = useState(false);

  const [category, setCategory] = useState<string | undefined>();
  const [action, setAction] = useState<string | undefined>();
  const [actorId, setActorId] = useState<number | undefined>();
  const [severity, setSeverity] = useState<string | undefined>();
  const [range, setRange] = useState<string>('30d');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeDays, setPurgeDays] = useState(180);
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    api
      .get<AuditMeta>('/api/audit/meta')
      .then(setMeta)
      .catch((e) => message.error((e as Error).message));
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    if (action) q.set('action', action);
    if (actorId != null) q.set('actorId', String(actorId));
    if (severity) q.set('severity', severity);
    if (keyword.trim()) q.set('keyword', keyword.trim());
    const opt = RANGE_OPTIONS.find((r) => r.value === range);
    if (opt && opt.days > 0) {
      // 「今天」从本地零点算起，跟人脑子里的一致
      const start = new Date();
      if (opt.days === 1) start.setHours(0, 0, 0, 0);
      else start.setDate(start.getDate() - opt.days);
      q.set('from', String(start.getTime()));
    }
    return q;
  }, [category, action, actorId, severity, keyword, range]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams(query);
      q.set('page', String(page));
      q.set('pageSize', String(pageSize));
      const r = await api.get<AuditListResult>(`/api/audit?${q.toString()}`);
      setData(r);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  // 换筛选条件时回到第一页，否则「筛完只剩 3 条却停在第 5 页」会看到空表
  useEffect(() => {
    setPage(1);
  }, [query]);

  // 选了分类就把动作下拉限制在该分类下，避免「分类=登录 + 动作=发布试卷」这种空组合
  const actionOptions = useMemo(() => {
    if (!meta) return [];
    const groups = category ? meta.categories.filter((c) => c.category === category) : meta.categories;
    return groups.map((g) => ({
      label: g.label,
      options: g.actions.map((a) => ({
        value: a.key,
        label: (
          <Space size={6}>
            <span>{a.label}</span>
            {a.severity !== 'normal' && (
              <Tag color={AUDIT_SEVERITY_COLOR[a.severity]} style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px' }}>
                {AUDIT_SEVERITY_LABEL[a.severity]}
              </Tag>
            )}
          </Space>
        ),
      })),
    }));
  }, [meta, category]);

  async function doPurge() {
    const before = Date.now() - purgeDays * 24 * 3600 * 1000;
    setPurging(true);
    try {
      const r = await api.post<{ deleted: number }>('/api/audit/purge', { before });
      message.success(`已清理 ${r.deleted} 条日志（这次清理动作本身已留痕）`);
      setPurgeOpen(false);
      setPage(1);
      load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setPurging(false);
    }
  }

  const exportUrl = `/api/audit/export?${query.toString()}`;

  return (
    <div className="liti-page">
      <PageHeader
        title="审计日志"
        description="谁在什么时候改了什么，全部记在这里。答题与违规流水不在此表 —— 答卷本身带时间戳，这里只记管理动作。"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => load()} loading={loading}>
              刷新
            </Button>
            <Button icon={<DownloadOutlined />} href={exportUrl}>
              导出 CSV
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={() => setPurgeOpen(true)}>
              清理旧日志
            </Button>
          </Space>
        }
      />

      <Card styles={{ body: { paddingBottom: 8 } }}>
        <Space wrap size={12}>
          <Select
            allowClear
            placeholder="全部类别"
            style={{ width: 150 }}
            value={category}
            onChange={(v) => {
              setCategory(v);
              setAction(undefined);
            }}
            options={meta?.categories.map((c) => ({ value: c.category, label: c.label })) ?? []}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部动作"
            style={{ width: 220 }}
            value={action}
            onChange={setAction}
            options={actionOptions}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部操作人"
            style={{ width: 190 }}
            value={actorId}
            onChange={setActorId}
            options={
              meta?.actors.map((a) => ({
                value: a.actorId as number,
                label: `${a.actorName}（${a.count}）`,
                disabled: a.actorId == null,
              })) ?? []
            }
          />
          <Select
            allowClear
            placeholder="全部分级"
            style={{ width: 130 }}
            value={severity}
            onChange={setSeverity}
            options={meta?.severities.map((s) => ({ value: s.key, label: s.label })) ?? []}
          />
          <Select style={{ width: 130 }} value={range} onChange={setRange} options={RANGE_OPTIONS} />
          <Input.Search
            allowClear
            placeholder="搜操作人 / 对象 / 详情"
            style={{ width: 260 }}
            onSearch={(v) => setKeyword(v)}
            onChange={(e) => {
              if (!e.target.value) setKeyword('');
            }}
          />
        </Space>
      </Card>

      <Card style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
        <Table<AuditItem>
          rowKey="id"
          dataSource={data?.items ?? []}
          loading={loading}
          size="middle"
          scroll={{ x: 1080 }}
          pagination={{
            current: page,
            pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100],
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          locale={{
            emptyText: <Empty description="这个条件下没有日志记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
          }}
          expandable={{
            // 只有带 detail 的行才给展开箭头，否则满屏都是点开什么都没有
            rowExpandable: (r) => !!r.detail,
            expandedRowRender: (r) => (
              <div style={{ padding: '4px 8px' }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  完整详情
                </Typography.Text>
                <pre
                  style={{
                    margin: '6px 0 0',
                    fontSize: 12,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {JSON.stringify(r.detail, null, 2)}
                </pre>
              </div>
            ),
          }}
          columns={[
            {
              title: '时间',
              dataIndex: 'at',
              width: 158,
              render: (v: number) => (
                <div style={{ lineHeight: 1.4 }}>
                  <div>{fmtDate(v)}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {fmtTime(v)}
                  </Typography.Text>
                </div>
              ),
            },
            {
              title: '操作人',
              dataIndex: 'actorName',
              width: 168,
              render: (_: unknown, r) => (
                <Space size={6}>
                  <span>{r.actorName}</span>
                  {r.actorRole && (
                    <Tag
                      color={ROLE_COLOR[r.actorRole] ?? 'default'}
                      style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px' }}
                    >
                      {ROLE_LABEL[r.actorRole] ?? r.actorRole}
                    </Tag>
                  )}
                </Space>
              ),
            },
            {
              title: '动作',
              dataIndex: 'actionLabel',
              width: 158,
              render: (_: unknown, r) => (
                <Tag color={AUDIT_SEVERITY_COLOR[r.severity]} style={{ marginInlineEnd: 0 }}>
                  {r.actionLabel}
                </Tag>
              ),
            },
            {
              title: '对象',
              dataIndex: 'targetLabel',
              width: 240,
              render: (_: unknown, r) => {
                if (!r.targetLabel && r.targetId == null) return <Typography.Text type="secondary">—</Typography.Text>;
                const typeName = r.targetType ? (AUDIT_TARGET_LABEL[r.targetType] ?? r.targetType) : '对象';
                return (
                  <div style={{ lineHeight: 1.4 }}>
                    <Tooltip title={r.targetLabel ?? ''}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.targetLabel ?? '—'}
                      </div>
                    </Tooltip>
                    {r.targetId != null && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {typeName} #{r.targetId}
                      </Typography.Text>
                    )}
                  </div>
                );
              },
            },
            {
              title: '详情',
              dataIndex: 'detail',
              ellipsis: true,
              render: (_: unknown, r) => {
                const s = detailSummary(r.detail);
                return s ? (
                  <Tooltip title={s}>
                    <span style={{ color: 'inherit' }}>{s}</span>
                  </Tooltip>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                );
              },
            },
            {
              title: 'IP',
              dataIndex: 'ip',
              width: 130,
              render: (v: string | null) =>
                v ? <Typography.Text style={{ fontSize: 12 }}>{v}</Typography.Text> : '—',
            },
          ]}
        />
      </Card>

      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined />
            清理旧审计日志
          </Space>
        }
        open={purgeOpen}
        onCancel={() => setPurgeOpen(false)}
        onOk={doPurge}
        okText="确认清理"
        okButtonProps={{ danger: true, loading: purging }}
        cancelText="取消"
        width={520}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="清理后不可恢复"
          description="审计日志是事后追责的唯一凭据。校内申诉、上级检查都可能倒查一年以前的操作，删之前请确认学校对留档期限的要求。"
        />
        <div style={{ marginBottom: 8 }}>删除以下时间点之前的全部日志：</div>
        <Radio.Group
          value={purgeDays}
          onChange={(e) => setPurgeDays(e.target.value)}
          options={PURGE_OPTIONS}
          optionType="button"
          buttonStyle="solid"
        />
        <div style={{ marginTop: 16 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            清理动作本身会记一条「清理审计日志」，并且这条记录永远不会被后续清理删掉。
          </Typography.Text>
        </div>
      </Modal>
    </div>
  );
}
