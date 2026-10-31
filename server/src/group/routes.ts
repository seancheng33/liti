import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';
import * as service from './service.js';

const groupSchema = z.object({
  name: z.string().min(1).max(64),
  remark: z.string().max(255).optional().nullable(),
  memberIds: z.array(z.number().int()).optional(),
});

const memberSchema = z.object({
  userIds: z.array(z.number().int()),
});

/** 学生分组（教师与管理员都能管，学生看不到） */
export async function groupRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.get('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    return service.listGroups(db);
  });

  app.post('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const body = groupSchema.parse(request.body);
    return service.createGroup(db, body, user.userId);
  });

  app.put('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    const body = groupSchema.partial().parse(request.body);
    await service.updateGroup(db, Number(id), { name: body.name, remark: body.remark });
    return { ok: true };
  });

  app.delete('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    await service.deleteGroup(db, Number(id));
    return { ok: true };
  });

  app.get('/:id/members', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    return service.getGroupMembers(db, Number(id));
  });

  // 覆盖式设置成员：前端勾完一次性提交
  app.put('/:id/members', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    const body = memberSchema.parse(request.body);
    return service.setGroupMembers(db, Number(id), body.userIds);
  });
}
