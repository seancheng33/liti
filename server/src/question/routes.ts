import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';
import * as service from './service.js';
import { buildTemplate } from '../excel/template.js';
import { importQuestions, parseQuestionRows } from '../excel/import.js';

const optionSchema = z.object({ content: z.string().min(1), isCorrect: z.boolean() });
const questionSchema = z.object({
  type: z.enum(['single', 'multiple']),
  stem: z.string().min(1),
  explanation: z.string().optional().nullable(),
  categoryId: z.number().int().nullable().optional(),
  difficulty: z.number().int().min(1).max(3).nullable().optional(),
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

  app.get('/', async (request) => {
    authenticate(request);
    const q = request.query as Record<string, unknown>;
    return service.listQuestions(db, {
      keyword: typeof q.keyword === 'string' ? q.keyword : undefined,
      categoryId: q.categoryId != null ? Number(q.categoryId) : undefined,
      difficulty: q.difficulty != null ? Number(q.difficulty) : undefined,
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

  app.delete('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    await service.deleteQuestion(db, Number(id));
    return { ok: true };
  });
}
