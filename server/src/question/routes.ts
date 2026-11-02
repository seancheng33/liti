import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';
import * as service from './service.js';
import { buildTemplate } from '../excel/template.js';
import { exportQuestionsXlsx } from '../excel/export.js';
import { importQuestions, parseQuestionRows } from '../excel/import.js';
import { audit } from '../audit/service.js';
import { questionLabel } from '../audit/labels.js';

const imageListSchema = z.array(z.string().max(500)).max(9).optional();
const optionSchema = z.object({
  // 长度都以「人能读的长度」为界：题库是给人看的，几十万字符只会把页面和导出拖死
  content: z.string().max(2000).default(''),
  isCorrect: z.boolean(),
  images: imageListSchema,
});
const questionSchema = z.object({
  type: z.enum(['single', 'multiple']),
  stem: z.string().max(5000).default(''),
  images: imageListSchema,
  explanation: z.string().max(20000).optional().nullable(),
  categoryId: z.number().int().nullable().optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
  options: z.array(optionSchema).min(2).max(6),
  /** 明确知道重复仍要新增/覆盖时传 true */
  allowDuplicate: z.boolean().optional(),
});

const duplicateCheckSchema = z.object({
  stem: z.string().min(1).max(5000),
  excludeId: z.number().int().optional(),
});

/** 题干当标签时的预览：压平空白、截断，别让一行日志被长题干撑成三屏 */
function stemPreview(stem: string, max = 60): string {
  const s = (stem ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '（空题干）';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export async function questionRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  // 模板下载（静态路径，优先于 /:id）
  app.get('/template', async (_request, reply) => {
    const buf = await buildTemplate();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="liti-question-template.xlsx"');
    return reply.send(buf);
  });

  // Excel 导入
  app.post('/import', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');

    const q = request.query as { dryRun?: string; mode?: string; filename?: string };
    const dryRun = q.dryRun === 'true' || q.dryRun === '1';
    const mode = q.mode === 'strict' ? 'strict' : q.mode === 'allow' ? 'allow' : 'skip';

    const body = request.body;
    if (!Buffer.isBuffer(body)) {
      throw new HttpError(400, '请求体必须为 xlsx 二进制内容');
    }

    const parsed = await parseQuestionRows(body);
    const summary = await importQuestions(db, parsed, {
      dryRun,
      mode,
      filename: q.filename ?? 'import.xlsx',
      userId: user.userId,
    });
    if (!dryRun) {
      await audit(db, request, {
        action: 'question.import',
        targetType: 'question',
        targetId: null,
        targetLabel: q.filename ?? 'import.xlsx',
        detail: {
          total: summary.total,
          success: summary.success,
          failed: summary.failed,
          skippedDuplicates: summary.skippedDuplicates,
          mode,
        },
      });
    }
    return summary;
  });

  // Excel 导出：列结构与导入模板一致（导出→改→导入 闭环）
  app.get('/export', async (request, reply) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const q = request.query as Record<string, unknown>;
    const status: 'active' | 'archived' | 'all' =
      q.status === 'archived' || q.status === 'all' ? q.status : 'active';

    const { buffer, count, truncated } = await exportQuestionsXlsx(db, {
      keyword: typeof q.keyword === 'string' && q.keyword ? q.keyword : undefined,
      categoryId: q.categoryId != null && q.categoryId !== '' ? Number(q.categoryId) : null,
      type: typeof q.type === 'string' && q.type ? q.type : undefined,
      status,
    });

    // 题库整包导出等于把试卷内容带走，属于要留痕的敏感读操作
    await audit(db, request, {
      action: 'question.export',
      targetType: 'question',
      targetLabel: `导出 ${count} 题${truncated ? '（已截断）' : ''}`,
      detail: { count, truncated, status, categoryId: q.categoryId ?? null },
    });

    const stamp = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const name = `liti-questions-${stamp.getFullYear()}${p(stamp.getMonth() + 1)}${p(stamp.getDate())}-${p(stamp.getHours())}${p(stamp.getMinutes())}.xlsx`;
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return reply.send(buffer);
  });

  app.get('/', async (request) => {
    const user = authenticate(request);
    // 题库管理是老师/管理员的功能：学生能翻题库等于提前看到题干，考试公平性没了
    requireRole(user, 'admin', 'teacher');
    const q = request.query as Record<string, unknown>;
    return service.listQuestions(db, {
      keyword: typeof q.keyword === 'string' ? q.keyword : undefined,
      categoryId: q.categoryId != null ? Number(q.categoryId) : undefined,
      type: typeof q.type === 'string' ? q.type : undefined,
      status: typeof q.status === 'string' ? q.status : undefined,
      page: q.page != null ? Number(q.page) : 1,
      pageSize: q.pageSize != null ? Number(q.pageSize) : 20,
    });
  });

  app.post('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { allowDuplicate, ...body } = questionSchema.parse(request.body);
    const id = await service.createQuestion(db, body, user.userId, { allowDuplicate });
    await audit(db, request, {
      action: 'question.create',
      targetType: 'question',
      targetId: id,
      targetLabel: stemPreview(body.stem),
      detail: { type: body.type, categoryId: body.categoryId ?? null, allowDuplicate: !!allowDuplicate },
    });
    return { id };
  });

  // 查重预检（新增/编辑题目时前端实时提示）
  app.post('/check-duplicate', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const body = duplicateCheckSchema.parse(request.body);
    const duplicate = await service.findDuplicate(db, body.stem, body.excludeId);
    return { duplicate };
  });

  app.get('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    const q = await service.getQuestionDetail(db, Number(id));
    if (!q) throw new HttpError(404, '题目不存在');
    return q;
  });

  app.put('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    const { allowDuplicate, ...body } = questionSchema.parse(request.body);
    const before = await questionLabel(db, Number(id));
    await service.updateQuestion(db, Number(id), body, { allowDuplicate });
    await audit(db, request, {
      action: 'question.update',
      targetType: 'question',
      targetId: Number(id),
      // 改题干就等于换了一道题，前后都留一眼，事后能判断「被改的是不是同一道」
      targetLabel: `${stemPreview(body.stem)}${before && before !== stemPreview(body.stem) ? `（原：${before}）` : ''}`,
      detail: { type: body.type, categoryId: body.categoryId ?? null },
    });
    return { ok: true };
  });

  // 批量操作：改分类 / 删除（软删除）
  app.post('/batch', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const body = z
      .object({
        ids: z.array(z.number().int()).min(1, '至少选一道题'),
        action: z.enum(['delete', 'category']),
        categoryId: z.number().int().nullable().optional(),
      })
      .parse(request.body);

    if (body.action === 'delete') {
      const r = await service.batchDeleteQuestions(db, body.ids);
      await audit(db, request, {
        action: 'question.batch-delete',
        targetType: 'question',
        targetLabel: `归档 ${r.archived} 题`,
        detail: { requested: body.ids.length, archived: r.archived, usedInPapers: r.usedInPapers },
      });
      return r;
    }
    const r = await service.batchSetCategory(db, body.ids, body.categoryId ?? null);
    await audit(db, request, {
      action: 'question.batch-category',
      targetType: 'question',
      targetLabel: `改分类 ${r.updated} 题`,
      detail: { requested: body.ids.length, updated: r.updated, categoryId: body.categoryId ?? null },
    });
    return r;
  });

  app.delete('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    const label = await questionLabel(db, Number(id));
    const r = await service.deleteQuestion(db, Number(id));
    await audit(db, request, {
      action: 'question.delete',
      targetType: 'question',
      targetId: Number(id),
      targetLabel: label,
      detail: { usedInPapers: r.usedInPapers },
    });
    return r;
  });
}
