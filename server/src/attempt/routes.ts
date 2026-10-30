import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { authenticate } from '../plugins/auth.js';
import * as service from './service.js';

export async function attemptRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

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

  app.post('/practice', async (request) => {
    const user = authenticate(request);
    const body = z
      .object({
        rules: z.array(
          z.object({
            categoryId: z.number().int().nullable().optional(),
            difficulty: z.number().int().min(1).max(3).nullable().optional(),
            count: z.number().int().min(1),
          }),
        ),
        durationSec: z.number().int().min(1).optional(),
      })
      .parse(request.body);
    const rules = body.rules.map((r) => ({
      categoryId: r.categoryId ?? undefined,
      difficulty: r.difficulty ?? undefined,
      count: r.count,
    }));
    const id = await service.startPractice(db, user.userId, rules, body.durationSec ?? 3600);
    return { id };
  });

  app.patch('/:id/answers', async (request) => {
    const user = authenticate(request);
    const { id } = request.params as { id: string };
    const body = z.object({ questionId: z.number().int(), selectedOptionIds: z.array(z.number().int()) }).parse(request.body);
    await service.saveAnswer(db, Number(id), user.userId, body.questionId, body.selectedOptionIds);
    return { ok: true };
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
