import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';
import { exportAttemptsXlsx } from '../excel/export.js';
import { exportAnalysisXlsx } from '../excel/analysis.js';
import { analyzePaper } from './analysis.js';
import * as service from './service.js';

export async function attemptRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  /** 站点设置里的「学生自助练习」开关；没配置过就按开启算（与设置页默认值一致） */
  async function practiceEnabled(): Promise<boolean> {
    const row = await db
      .selectFrom('setting')
      .select('value')
      .where('key', '=', 'practice_enabled')
      .executeTakeFirst();
    return (row?.value ?? 'true') !== 'false';
  }

  app.get('/', async (request) => {
    const user = authenticate(request);
    const q = request.query as Record<string, unknown>;
    return service.listMyAttempts(
      db,
      user.userId,
      q.page != null ? Number(q.page) : 1,
      q.pageSize != null ? Number(q.pageSize) : 20,
    );
  });

  app.post('/', async (request) => {
    const user = authenticate(request);
    const body = z.object({ paperId: z.number().int() }).parse(request.body);
    const id = await service.startAttempt(db, body.paperId, user.userId);
    return { id };
  });

  // 成绩导出（管理员 / 教师）
  // 带 paperId = 导出这一场的成绩册（应考名单为主表，缺考也在表里）
  // 不带 = 全站答卷流水
  app.get('/export', async (request, reply) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const q = request.query as Record<string, unknown>;
    const paperId = q.paperId != null ? Number(q.paperId) : undefined;
    if (paperId != null && (!Number.isInteger(paperId) || paperId <= 0)) throw new HttpError(400, '试卷编号无效');
    // 按班导出：教务一学期会按班发好几轮成绩单
    const className = typeof q.className === 'string' && q.className.trim() ? q.className.trim() : undefined;
    const buf = await exportAttemptsXlsx(db, { paperId, className });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header(
      'Content-Disposition',
      `attachment; filename="${paperId != null ? `liti-scores-paper${paperId}` : 'liti-scores'}.xlsx"`,
    );
    return reply.send(buf);
  });

  // 逐题分析（P 值 / D 值 / 选项分布 / 分数段）。练习卷不适用，会返回 400
  app.get('/analysis', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const q = request.query as Record<string, unknown>;
    const paperId = Number(q.paperId);
    if (!Number.isInteger(paperId) || paperId <= 0) throw new HttpError(400, '请指定要分析的试卷');
    const className = typeof q.className === 'string' && q.className.trim() ? q.className.trim() : undefined;
    return analyzePaper(db, paperId, { className });
  });

  // 分析结果导出 xlsx（教研 / 年级组长要的是文件，不是网页）
  app.get('/analysis/export', async (request, reply) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const q = request.query as Record<string, unknown>;
    const paperId = Number(q.paperId);
    if (!Number.isInteger(paperId) || paperId <= 0) throw new HttpError(400, '请指定要分析的试卷');
    const className = typeof q.className === 'string' && q.className.trim() ? q.className.trim() : undefined;
    const buf = await exportAnalysisXlsx(db, paperId, className);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="liti-analysis-paper${paperId}.xlsx"`);
    return reply.send(buf);
  });

  // 自助练习：source=random 按分类随机抽；source=wrong 从本人错题库抽
  app.post('/practice', async (request) => {
    const user = authenticate(request);
    const body = z
      .object({
        source: z.enum(['random', 'wrong']).optional(),
        rules: z
          .array(
            z.object({
              categoryId: z.number().int().nullable().optional(),
              count: z.number().int().min(1),
            }),
          )
          .optional(),
        count: z.number().int().min(1).max(100).optional(),
        categoryId: z.number().int().nullable().optional(),
        durationSec: z.number().int().min(1).optional(),
      })
      .parse(request.body ?? {});

    const source = body.source === 'wrong' ? 'wrong' : 'random';
    if (source === 'random' && !body.rules?.length) {
      throw new HttpError(400, '随机练习需要指定抽题规则（分类与题量）');
    }
    // 站点设置里关掉「学生自助练习」就真的不让开 —— 否则只是前端把按钮藏了，接口照样能调
    if (user.role === 'student' && !(await practiceEnabled())) {
      throw new HttpError(403, '本站已关闭学生自助练习，请联系老师');
    }

    const id = await service.startPractice(db, user.userId, {
      source,
      rules: body.rules?.map((r) => ({ categoryId: r.categoryId ?? undefined, count: r.count })),
      count: body.count,
      categoryId: body.categoryId ?? null,
      durationSec: body.durationSec ?? 3600,
    });
    return { id };
  });

  app.patch('/:id/answers', async (request) => {
    const user = authenticate(request);
    const { id } = request.params as { id: string };
    const body = z.object({ questionId: z.number().int(), selectedOptionIds: z.array(z.number().int()) }).parse(request.body);
    await service.saveAnswer(db, Number(id), user.userId, body.questionId, body.selectedOptionIds);
    return { ok: true };
  });

  // 题目标记（答题卡上的小旗）
  app.patch('/:id/flag', async (request) => {
    const user = authenticate(request);
    const { id } = request.params as { id: string };
    const body = z.object({ questionId: z.number().int(), flagged: z.boolean() }).parse(request.body);
    return service.setFlag(db, Number(id), user.userId, body.questionId, body.flagged);
  });

  // 暂停 / 继续：暂停时计时停止，题面由服务端屏蔽
  app.post('/:id/pause', async (request) => {
    const user = authenticate(request);
    const { id } = request.params as { id: string };
    return service.pauseAttempt(db, Number(id), user.userId);
  });

  app.post('/:id/resume', async (request) => {
    const user = authenticate(request);
    const { id } = request.params as { id: string };
    return service.resumeAttempt(db, Number(id), user.userId);
  });

  app.post('/:id/violations', async (request) => {
    const user = authenticate(request);
    const { id } = request.params as { id: string };
    const body = z.object({ type: z.string().optional() }).parse(request.body ?? {});
    return service.reportViolation(db, Number(id), user.userId, body.type ?? 'switch');
  });

  app.post('/:id/submit', async (request) => {
    const user = authenticate(request);
    const { id } = request.params as { id: string };
    await service.submitAttempt(db, Number(id), user.userId);
    return { ok: true };
  });

  app.get('/:id', async (request) => {
    const user = authenticate(request);
    const { id } = request.params as { id: string };
    return service.getAttemptReview(db, Number(id), user.userId);
  });
}
