import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';
import { getStats } from './service.js';

export async function statsRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.get('/overview', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    return getStats(db);
  });
}
