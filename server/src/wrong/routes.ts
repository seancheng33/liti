import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { authenticate } from '../plugins/auth.js';
import * as service from './service.js';

/**
 * 错题库接口。
 * **所有端点只操作「当前登录用户」自己的错题库** —— 没有 userId 参数，
 * 也不提供教师查看某学生错题本的接口（那是另一个需求，得单独设计权限）。
 */
export async function wrongRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.get('/', async (request) => {
    const user = authenticate(request);
    const q = request.query as Record<string, unknown>;
    const status = q.status === 'resolved' || q.status === 'all' ? q.status : 'active';
    return service.listWrongQuestions(db, user.userId, {
      status,
      categoryId: q.categoryId != null ? Number(q.categoryId) : undefined,
      keyword: typeof q.keyword === 'string' ? q.keyword : undefined,
      page: q.page != null ? Number(q.page) : 1,
      pageSize: q.pageSize != null ? Number(q.pageSize) : 20,
    });
  });

  // 练习中心用的汇总：待订正总数 + 按分类分布
  app.get('/summary', async (request) => {
    const user = authenticate(request);
    const list = await service.listWrongQuestions(db, user.userId, { page: 1, pageSize: 1 });
    const byCategory = await service.wrongByCategory(db, user.userId);
    return {
      activeTotal: list.activeTotal,
      byCategory,
      weakest: byCategory[0] ?? null,
    };
  });

  app.get('/:questionId', async (request) => {
    const user = authenticate(request);
    const { questionId } = request.params as { questionId: string };
    return service.getWrongQuestionDetail(db, user.userId, Number(questionId));
  });

  app.delete('/:questionId', async (request) => {
    const user = authenticate(request);
    const { questionId } = request.params as { questionId: string };
    await service.removeWrongQuestion(db, user.userId, Number(questionId));
    return { ok: true };
  });

  app.post('/batch-remove', async (request) => {
    const user = authenticate(request);
    const body = z.object({ questionIds: z.array(z.number().int()).min(1, '至少选一道题') }).parse(request.body);
    return service.batchRemoveWrong(db, user.userId, body.questionIds);
  });
}
