import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { AUDIT_ACTIONS, AUDIT_ACTION_KEYS, actionLabel, actionSeverity, type AuditCategory, type AuditSeverity } from './actions.js';
import { HttpError } from '../http-error.js';

/** detail 序列化后的上限。审计是给人读的摘要，不是数据备份，塞满一屏反而没人看 */
const DETAIL_MAX = 2000;
/** 对象名称快照上限，跟表结构 varchar(255) 对齐 */
const LABEL_MAX = 255;
const ACTOR_MAX = 128;

export interface AuditActor {
  id: number | null;
  name: string;
  role: string | null;
}

/** 系统动作（定时收卷、迁移）没有登录用户，统一记成这个名字 */
export const SYSTEM_ACTOR: AuditActor = { id: null, name: '系统', role: null };

export interface AuditEntry {
  actor: AuditActor;
  action: string;
  targetType?: string | null;
  targetId?: number | null;
  targetLabel?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

function clip(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const v = String(s).trim();
  if (!v) return null;
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function serializeDetail(detail: Record<string, unknown> | null | undefined): string | null {
  if (!detail) return null;
  let text: string;
  try {
    text = JSON.stringify(detail);
  } catch {
    return null;
  }
  if (text.length <= DETAIL_MAX) return text;
  // 截断时补一个标记，免得日后有人以为原文就这么短
  return `${text.slice(0, DETAIL_MAX - 20)}…(已截断)`;
}

/**
 * 写一条审计日志。
 *
 * ⚠️ **绝不向上抛异常**。审计是旁路：一张表写不进去，不能让「发布试卷」跟着失败
 * ——那等于用日志把主业务绑死了。失败只在服务端打一行错误，接口照常返回。
 * 代价是极端情况下会丢日志，这个取舍写在 docs/architecture.md 里。
 */
export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  const action = String(entry.action ?? '').trim();
  if (!action) return;
  if (!AUDIT_ACTIONS.has(action)) {
    // 允许写入未知动作（宁可记下也别丢），但开发期要能发现拼错了
    console.warn(`[audit] 未登记的动作键：${action}`);
  }

  try {
    await db
      .insertInto('audit_log')
      .values({
        at: Date.now(),
        actor_id: entry.actor.id,
        actor_name: clip(entry.actor.name, ACTOR_MAX) ?? '未知',
        actor_role: entry.actor.role,
        action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        target_label: clip(entry.targetLabel, LABEL_MAX),
        detail: serializeDetail(entry.detail),
        ip: clip(entry.ip, 64),
      })
      .execute();
  } catch (e) {
    console.error('[audit] 写入失败，已忽略：', action, e);
  }
}

/**
 * 路由里最常用的入口：操作人从 request.authUser 取，IP 从 request.ip 取。
 *
 * - 登录失败时还没有会话，用 writeAudit 显式传 actor
 * - 系统动作（定时任务没有 request）也用 writeAudit
 */
export async function audit(
  db: Db,
  request: FastifyRequest,
  entry: {
    action: string;
    targetType?: string | null;
    targetId?: number | null;
    targetLabel?: string | null;
    detail?: Record<string, unknown> | null;
  },
): Promise<void> {
  const u = request.authUser;
  await writeAudit(db, {
    actor: u ? { id: u.userId, name: u.displayName || u.username, role: u.role } : SYSTEM_ACTOR,
    ...entry,
    ip: request.ip,
  });
}

// ---------------- 查询 ----------------

export interface AuditQuery {
  action?: string;
  category?: string;
  severity?: string;
  actorId?: number;
  targetType?: string;
  targetId?: number;
  keyword?: string;
  /** 毫秒时间戳，含 */
  from?: number;
  to?: number;
  page?: number;
  pageSize?: number;
}

export interface AuditItem {
  id: number;
  at: number;
  actorId: number | null;
  actorName: string;
  actorRole: string | null;
  action: string;
  actionLabel: string;
  category: AuditCategory | null;
  severity: AuditSeverity;
  targetType: string | null;
  targetId: number | null;
  targetLabel: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
}

function parseDetail(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    // 早期数据或手工改过库：原样塞回去，别让一行坏数据把整页弄崩
    return { _raw: raw };
  }
}

function toItem(r: {
  id: number;
  at: number;
  actor_id: number | null;
  actor_name: string;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: number | null;
  target_label: string | null;
  detail: string | null;
  ip: string | null;
}): AuditItem {
  const meta = AUDIT_ACTIONS.get(r.action);
  return {
    id: r.id,
    at: r.at,
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorRole: r.actor_role,
    action: r.action,
    actionLabel: actionLabel(r.action),
    category: meta?.category ?? null,
    severity: actionSeverity(r.action),
    targetType: r.target_type,
    targetId: r.target_id,
    targetLabel: r.target_label,
    detail: parseDetail(r.detail),
    ip: r.ip,
  };
}

/**
 * 分类/分级筛选要翻译成动作白名单 —— action 是普通字符串列，没有外键可 join。
 * 返回 null = 不需要白名单（只按 action 或什么都不按）。
 * 返回空数组 = 该组合下一个动作都没有，调用方要直接短路成空结果，
 * 因为 `in ()` 是非法 SQL。
 */
function actionKeysOf(q: AuditQuery): string[] | null {
  if (!q.category && !q.severity) return null;
  return AUDIT_ACTION_KEYS.filter((k) => {
    const meta = AUDIT_ACTIONS.get(k);
    if (!meta) return false;
    if (q.action && k !== q.action) return false;
    if (q.category && meta.category !== q.category) return false;
    if (q.severity && meta.severity !== q.severity) return false;
    return true;
  });
}

/**
 * 关键字里只剔掉 `%` 和反斜杠，**保留下划线**。
 *
 * 为什么不像常见做法那样转义成 `\%`：两种库的默认转义行为不一致 ——
 * MySQL 默认把反斜杠当 ESCAPE 字符，SQLite 的 LIKE 没有默认 ESCAPE，
 * 写 `\%` 在 MySQL 匹配字面百分号、在 SQLite 变成「反斜杠 + 任意串」，
 * 同一个关键字两种结果比不支持通配符更糟。
 *
 * 为什么不能连下划线一起剔：学号、用户名、公告里全都有下划线
 * （`v12_123456`、`2024_001`），剔掉之后这些搜索全部失效 —— 这是实测出来的，
 * 第一版就是这么写的，C9 直接挂了。
 *
 * 剩下的 `_` 在 LIKE 里是「任意单字符」，最多多匹配几条，对搜索框无害；
 * 而 `%` 是「任意串」，会把筛选变成全表命中，必须剔掉。
 */
function sanitizeLike(s: string): string {
  return s.replace(/[%\\]/g, ' ').trim();
}

export async function listAudit(db: Db, q: AuditQuery): Promise<{ items: AuditItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 20));

  const keys = actionKeysOf(q);
  // 该筛选组合下不存在任何动作，别拼出 `in ()` 这种非法 SQL
  if (keys && keys.length === 0) return { items: [], total: 0, page, pageSize };

  const base = () => {
    let query = db.selectFrom('audit_log');
    if (q.action) query = query.where('action', '=', q.action);
    if (keys) query = query.where('action', 'in', keys);
    if (q.actorId != null) query = query.where('actor_id', '=', q.actorId);
    if (q.targetType) query = query.where('target_type', '=', q.targetType);
    if (q.targetId != null) query = query.where('target_id', '=', q.targetId);
    if (q.from != null) query = query.where('at', '>=', q.from);
    if (q.to != null) query = query.where('at', '<=', q.to);
    if (q.keyword) {
      const like = `%${sanitizeLike(q.keyword)}%`;
      query = query.where((eb) =>
        eb.or([eb('actor_name', 'like', like), eb('target_label', 'like', like), eb('detail', 'like', like)]),
      );
    }
    return query;
  };

  const totalRow = await base().select((eb) => eb.fn.countAll().as('c')).executeTakeFirst();
  const total = Number(totalRow?.c ?? 0);

  const rows = await base()
    .select(['id', 'at', 'actor_id', 'actor_name', 'actor_role', 'action', 'target_type', 'target_id', 'target_label', 'detail', 'ip'])
    .orderBy('at', 'desc')
    .orderBy('id', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute();

  return { items: rows.map(toItem), total, page, pageSize };
}

/** 筛选下拉用：出现过日志的操作人，按次数倒序 */
export async function listAuditActors(db: Db): Promise<{ actorId: number | null; actorName: string; count: number }[]> {
  const rows = await db
    .selectFrom('audit_log')
    .select((eb) => ['actor_id', 'actor_name', eb.fn.countAll().as('c')])
    .groupBy(['actor_id', 'actor_name'])
    .orderBy('c', 'desc')
    .limit(200)
    .execute();
  return rows.map((r) => ({ actorId: r.actor_id, actorName: r.actor_name, count: Number(r.c) }));
}

// ---------------- 导出 ----------------

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  // 管道符/引号/换行的标准 CSV 转义；顺带防 Excel 公式注入（= + - @ 开头）
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** 导出 CSV（不是 xlsx：留档交给 Excel 打开就行，省一个依赖分支） */
export async function exportAuditCsv(db: Db, q: AuditQuery): Promise<{ buffer: Buffer; count: number }> {
  const keys = actionKeysOf(q);
  if (keys && keys.length === 0) {
    return { buffer: Buffer.from('\uFEFF', 'utf8'), count: 0 };
  }
  let query = db
    .selectFrom('audit_log')
    .select(['at', 'actor_name', 'actor_role', 'action', 'target_type', 'target_id', 'target_label', 'detail', 'ip']);

  if (q.action) query = query.where('action', '=', q.action);
  if (keys) query = query.where('action', 'in', keys);
  if (q.actorId != null) query = query.where('actor_id', '=', q.actorId);
  if (q.targetType) query = query.where('target_type', '=', q.targetType);
  if (q.targetId != null) query = query.where('target_id', '=', q.targetId);
  if (q.from != null) query = query.where('at', '>=', q.from);
  if (q.to != null) query = query.where('at', '<=', q.to);
  if (q.keyword) {
    const like = `%${sanitizeLike(q.keyword)}%`;
    query = query.where((eb) =>
      eb.or([eb('actor_name', 'like', like), eb('target_label', 'like', like), eb('detail', 'like', like)]),
    );
  }

  // 上限 5 万行：再多多半是没加筛选条件，导出来也没人看得完，还容易把内存吃满
  const rows = await query.orderBy('at', 'desc').orderBy('id', 'desc').limit(50000).execute();

  const header = ['时间', '操作人', '角色', '动作', '分级', '对象类型', '对象ID', '对象名称', '详情', 'IP'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    const d = new Date(r.at);
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    lines.push(
      [
        stamp,
        r.actor_name,
        r.actor_role ?? '',
        actionLabel(r.action),
        actionSeverity(r.action),
        r.target_type ?? '',
        r.target_id ?? '',
        r.target_label ?? '',
        r.detail ?? '',
        r.ip ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  // BOM：不加的话 Excel 打开中文是乱码，这是最常见的「导出坏了」投诉
  return { buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8'), count: rows.length };
}

// ---------------- 清理 ----------------

/**
 * 删除 `before` 之前的日志。
 *
 * 清理动作本身必须留痕 —— 所以先写 audit.purge，再删旧记录，
 * 并且**永远不删 audit.purge 自己**（否则「谁清过日志」这件事先被清掉了）。
 */
export async function purgeAudit(db: Db, before: number, actor: AuditActor, ip?: string | null): Promise<{ deleted: number }> {
  if (!Number.isFinite(before) || before <= 0) throw new HttpError(400, '请指定要清理的时间点');
  if (before > Date.now()) throw new HttpError(400, '不能清理未来的日志');

  const row = await db
    .selectFrom('audit_log')
    .select((eb) => eb.fn.countAll().as('c'))
    .where('at', '<', before)
    .where('action', '!=', 'audit.purge')
    .executeTakeFirst();
  const count = Number(row?.c ?? 0);

  await writeAudit(db, {
    actor,
    action: 'audit.purge',
    targetType: 'audit',
    targetId: null,
    targetLabel: `清理 ${new Date(before).toLocaleString('zh-CN')} 之前的日志`,
    detail: { before, deleted: count },
    ip,
  });

  if (count > 0) {
    await db.deleteFrom('audit_log').where('at', '<', before).where('action', '!=', 'audit.purge').execute();
  }
  return { deleted: count };
}
