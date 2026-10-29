import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';

const categorySchema = z.object({
  name: z.string().min(1).max(128),
  parentId: z.number().int().nullable().optional(),
  sort: z.number().int().optional(),
});

export async function categoryRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  // 分类列表（扁平结构，前端可自行构建树）
  app.get('/', async (request) => {
    authenticate(request);
    const rows = await db
      .selectFrom('category')
      .selectAll()
      .orderBy('sort', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return rows;
  });

  app.post('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const body = categorySchema.parse(request.body);
    const now = Date.now();
    const res = await db
      .insertInto('category')
      .values({ name: body.name, parent_id: body.parentId ?? null, sort: body.sort ?? 0, created_at: now })
      .executeTakeFirstOrThrow();
    return { id: Number(res.insertId) };
  });
}
