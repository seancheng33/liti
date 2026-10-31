import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';
import { previewItemsInOrder, previewPaperById } from './preview.js';
import { validatePaperInput } from './validate.js';
import * as service from './service.js';

const ruleSchema = z.object({
  categoryId: z.number().int().nullable().optional(),
  count: z.number().int().min(1),
});
const paperSchema = z.object({
  title: z.string().min(1),
  mode: z.enum(['random', 'fixed']),
  durationSec: z.number().int().min(1),
  passScore: z.number().int().min(0).max(100).optional(),
  reviewMode: z.enum(['after_submit', 'immediate']).optional(),
  shuffleOptions: z.boolean().optional(),
  randomRules: z.array(ruleSchema).optional(),
  questionIds: z.array(z.number().int()).optional(),
});

export async function paperRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.post('/random-preview', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const body = request.body as { randomRules?: { categoryId?: number | null; count: number }[] };
    const rules = (body.randomRules ?? []).map((r) => ({
      categoryId: r.categoryId ?? undefined,
      count: r.count,
    }));
    return service.previewRandom(db, rules);
  });

  app.get('/', async (request) => {
    const user = authenticate(request);
    const q = request.query as Record<string, unknown>;
    // 学生只能看到已发布的卷子，草稿不外露
    const status = user.role === 'student' ? 'published' : typeof q.status === 'string' ? q.status : undefined;
    return service.listPapers(db, {
      status,
      page: q.page != null ? Number(q.page) : 1,
      pageSize: q.pageSize != null ? Number(q.pageSize) : 20,
    });
  });

  // 新建试卷时的「还没落库」预览：按当前表单入参临时抽题、组装题面
  app.post('/draft-preview', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const body = paperSchema.parse(request.body);
    const errors = validatePaperInput(body);
    if (errors.length) throw new HttpError(400, errors.join('；'));

    const questionIds = await service.resolveQuestionIds(db, body);
    return {
      title: body.title,
      questionCount: questionIds.length,
      durationSec: body.durationSec,
      passScore: body.passScore ?? 60,
      reviewMode: body.reviewMode ?? 'after_submit',
      shuffleOptions: body.shuffleOptions !== false,
      status: 'draft',
      items: await previewItemsInOrder(db, questionIds),
    };
  });

  app.post('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const body = paperSchema.parse(request.body);
    const id = await service.createPaper(db, body, user.userId);
    return { id };
  });

  app.get('/:id', async (request) => {
    authenticate(request);
    const { id } = request.params as { id: string };
    const p = await service.getPaperDetail(db, Number(id));
    if (!p) throw new HttpError(404, '试卷不存在');
    return p;
  });

  // 试卷预览（管理员/教师，草稿也能看）
  app.get('/:id/preview', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    return previewPaperById(db, Number(id));
  });

  app.post('/:id/publish', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    await service.setPaperStatus(db, Number(id), 'published');
    return { ok: true };
  });

  app.delete('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    await service.deletePaper(db, Number(id));
    return { ok: true };
  });
}
