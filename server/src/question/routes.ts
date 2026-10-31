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

const imageListSchema = z.array(z.string()).optional();
const optionSchema = z.object({
  content: z.string().default(''),
  isCorrect: z.boolean(),
  images: imageListSchema,
});
const questionSchema = z.object({
  type: z.enum(['single', 'multiple']),
  stem: z.string().default(''),
  images: imageListSchema,
  explanation: z.string().optional().nullable(),
  categoryId: z.number().int().nullable().optional(),
  tags: z.array(z.string()).optional(),
  options: z.array(optionSchema).min(2).max(6),
  /** 明确知道重复仍要新增/覆盖时传 true */
  allowDuplicate: z.boolean().optional(),
});

const duplicateCheckSchema = z.object({
  stem: z.string().min(1),
  excludeId: z.number().int().optional(),
});

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
    return importQuestions(db, parsed, {
      dryRun,
      mode,
      filename: q.filename ?? 'import.xlsx',
      userId: user.userId,
    });
  });

  // Excel 导出：列结构与导入模板一致（导出→改→导入 闭环）
  app.get('/export', async (request, reply) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const q = request.query as Record<string, unknown>;
    const status: 'active' | 'archived' | 'all' =
      q.status === 'archived' || q.status === 'all' ? q.status : 'active';

    const { buffer } = await exportQuestionsXlsx(db, {
      keyword: typeof q.keyword === 'string' && q.keyword ? q.keyword : undefined,
      categoryId: q.categoryId != null && q.categoryId !== '' ? Number(q.categoryId) : null,
      type: typeof q.type === 'string' && q.type ? q.type : undefined,
      status,
    });

    const stamp = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const name = `liti-questions-${stamp.getFullYear()}${p(stamp.getMonth() + 1)}${p(stamp.getDate())}-${p(stamp.getHours())}${p(stamp.getMinutes())}.xlsx`;
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return reply.send(buffer);
  });

  app.get('/', async (request) => {
    authenticate(request);
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
    await service.updateQuestion(db, Number(id), body, { allowDuplicate });
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
      return service.batchDeleteQuestions(db, body.ids);
    }
    return service.batchSetCategory(db, body.ids, body.categoryId ?? null);
  });

  app.delete('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    return service.deleteQuestion(db, Number(id));
  });
}
