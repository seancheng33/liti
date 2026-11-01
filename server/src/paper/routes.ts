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
  audienceMode: z.enum(['all', 'selected']).optional(),
  audienceUserIds: z.array(z.number().int()).optional(),
  audienceGroupIds: z.array(z.number().int()).optional(),
});

const audienceSchema = z.object({
  audienceMode: z.enum(['all', 'selected']),
  audienceUserIds: z.array(z.number().int()).optional(),
  audienceGroupIds: z.array(z.number().int()).optional(),
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
      viewer: { userId: user.userId, role: user.role },
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
    const user = authenticate(request);
    const { id } = request.params as { id: string };
    const paperId = Number(id);
    if (!Number.isInteger(paperId) || paperId <= 0) throw new HttpError(400, '试卷编号无效');

    const p = await service.getPaperDetail(db, paperId);
    if (!p) throw new HttpError(404, '试卷不存在');

    // 学生只能看「自己创建的那份练习卷」或「已发布且确实可见的正式卷」。
    // 其余一律当成不存在 —— 否则拿自增 ID 遍历就能把草稿卷、别人的限定卷、
    // 别人的练习卷连可见名单一起翻出来。
    if (user.role === 'student') {
      const ownPractice = p.practice === 1 && p.created_by === user.userId;
      const visible =
        p.practice !== 1 &&
        p.status === 'published' &&
        (p.audience_mode === 'all' || (await service.paperVisibleTo(db, paperId, user.userId)));
      if (!ownPractice && !visible) throw new HttpError(404, '试卷不存在');

      // 可见名单和抽题规则是组卷老师才需要的信息，学生视角不给
      return { ...p, audience_user_ids: [], audience_group_ids: [], random_config: null, created_by: null };
    }
    return p;
  });

  // 试卷预览（管理员/教师，草稿也能看）
  app.get('/:id/preview', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    return previewPaperById(db, Number(id));
  });

  // 可见范围（发布弹窗里勾学生用）
  app.get('/:id/audience', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    return service.getPaperAudience(db, Number(id));
  });

  app.put('/:id/audience', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    const body = audienceSchema.parse(request.body);
    return service.setPaperAudience(
      db,
      Number(id),
      body.audienceMode,
      body.audienceUserIds ?? [],
      body.audienceGroupIds ?? [],
    );
  });

  app.post('/:id/publish', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    // 发布时可以顺带指定可见范围：不传就沿用试卷原有的 audience_mode
    const raw = request.body as unknown;
    if (raw && typeof raw === 'object') {
      const parsed = audienceSchema.partial().safeParse(raw);
      if (parsed.success && parsed.data.audienceMode) {
        await service.setPaperAudience(
          db,
          Number(id),
          parsed.data.audienceMode,
          parsed.data.audienceUserIds ?? [],
          parsed.data.audienceGroupIds ?? [],
        );
      }
    }
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
