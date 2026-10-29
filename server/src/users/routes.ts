import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';

export async function userRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  // 用户列表（仅管理员）
  app.get('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin');

    const rows = await db
      .selectFrom('user')
      .select(['id', 'username', 'display_name', 'role', 'status', 'created_at'])
      .orderBy('id', 'asc')
      .execute();

    return rows;
  });
}
