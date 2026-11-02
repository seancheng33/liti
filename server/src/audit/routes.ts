import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';
import { actionsByCategory, AUDIT_CATEGORY_LABEL } from './actions.js';
import * as service from './service.js';

const purgeSchema = z.object({
  /** 毫秒时间戳：删这个时间点之前的日志 */
  before: z.number().int().positive(),
});

/** 时间参数既收毫秒数也收 ISO 日期串：前端 DatePicker 给的是毫秒，手敲 URL 的人给的是日期 */
function parseTime(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : undefined;
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

/**
 * 审计日志。
 *
 * **只有管理员能看**，教师也不行 —— 日志里会出现「谁给谁重置了密码」「谁改了自己班级」
 * 这类横向信息，任课教师没有这个必要权限，学校也不会愿意。
 */
export async function auditRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  function buildQuery(raw: Record<string, unknown>): service.AuditQuery {
    return {
      action: str(raw.action),
      category: str(raw.category),
      severity: str(raw.severity),
      actorId: num(raw.actorId),
      targetType: str(raw.targetType),
      targetId: num(raw.targetId),
      keyword: str(raw.keyword),
      from: parseTime(raw.from),
      to: parseTime(raw.to),
      page: num(raw.page),
      pageSize: num(raw.pageSize),
    };
  }

  // 动作字典 + 筛选下拉选项。前端不硬编码中文标签，加动作只改后端
  app.get('/meta', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin');
    const actors = await service.listAuditActors(db);
    return {
      categories: actionsByCategory(),
      categoryLabel: AUDIT_CATEGORY_LABEL,
      actors,
      severities: [
        { key: 'normal', label: '日常' },
        { key: 'sensitive', label: '敏感' },
        { key: 'critical', label: '高危' },
      ],
      targetTypes: [
        { key: 'paper', label: '试卷' },
        { key: 'user', label: '账号' },
        { key: 'question', label: '题目' },
        { key: 'group', label: '分组' },
        { key: 'category', label: '分类' },
        { key: 'attempt', label: '答卷' },
        { key: 'setting', label: '设置' },
        { key: 'audit', label: '审计' },
      ],
    };
  });

  app.get('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin');
    return service.listAudit(db, buildQuery(request.query as Record<string, unknown>));
  });

  // 留档用：教委检查、校内申诉都要一份能带走的文件
  app.get('/export', async (request, reply) => {
    const user = authenticate(request);
    requireRole(user, 'admin');
    const { buffer, count } = await service.exportAuditCsv(db, buildQuery(request.query as Record<string, unknown>));
    await service.audit(db, request, {
      action: 'audit.export',
      targetType: 'audit',
      targetLabel: '导出审计日志',
      detail: { rows: count },
    });
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="liti-audit-${stamp}.csv"`);
    return reply.send(buffer);
  });

  app.post('/purge', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin');
    const body = purgeSchema.parse(request.body);
    const actor = { id: user.userId, name: user.displayName || user.username, role: user.role };
    return service.purgeAudit(db, body.before, actor, request.ip);
  });
}
