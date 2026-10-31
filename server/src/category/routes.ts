import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';
import { HttpError } from '../http-error.js';

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

  // 编辑分类
  app.put('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    const body = categorySchema.parse(request.body);
    const existing = await db.selectFrom('category').select('id').where('id', '=', Number(id)).executeTakeFirst();
    if (!existing) throw new HttpError(404, '分类不存在');
    await db
      .updateTable('category')
      .set({ name: body.name, parent_id: body.parentId ?? null, sort: body.sort ?? 0 })
      .where('id', '=', Number(id))
      .execute();
    return { ok: true };
  });

  // 删除分类（若分类下还有题目则拒绝）
  app.delete('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    const existing = await db.selectFrom('category').select('id').where('id', '=', Number(id)).executeTakeFirst();
    if (!existing) throw new HttpError(404, '分类不存在');
    const used = await db.selectFrom('question').select('id').where('category_id', '=', Number(id)).executeTakeFirst();
    if (used) throw new HttpError(400, '该分类下还有题目，无法删除');
    await db.deleteFrom('category').where('id', '=', Number(id)).execute();
    return { ok: true };
  });
}
