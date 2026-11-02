import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';
import * as service from './service.js';
import { audit } from '../audit/service.js';
import { groupLabel } from '../audit/labels.js';

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
    const r = await service.createGroup(db, body, user.userId);
    await audit(db, request, {
      action: 'group.create',
      targetType: 'group',
      targetId: r.id,
      targetLabel: body.name,
      detail: { members: body.memberIds?.length ?? 0 },
    });
    return r;
  });

  app.put('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    const body = groupSchema.partial().parse(request.body);
    const before = await groupLabel(db, Number(id));
    await service.updateGroup(db, Number(id), { name: body.name, remark: body.remark });
    await audit(db, request, {
      action: 'group.update',
      targetType: 'group',
      targetId: Number(id),
      targetLabel: body.name ?? before,
      detail: body.name && body.name !== before ? { renamedFrom: before } : null,
    });
    return { ok: true };
  });

  app.delete('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    // 删组会连带清掉「哪些试卷用它做了可见范围」，破坏力不小，名字先抄下来
    const label = await groupLabel(db, Number(id));
    await service.deleteGroup(db, Number(id));
    await audit(db, request, {
      action: 'group.delete',
      targetType: 'group',
      targetId: Number(id),
      targetLabel: label,
    });
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
    const before = await service.getGroupMembers(db, Number(id));
    const r = await service.setGroupMembers(db, Number(id), body.userIds);
    // 记「从几个变几个」而不是全名单：名单可能上百人，日志里塞不下也没人看
    await audit(db, request, {
      action: 'group.members',
      targetType: 'group',
      targetId: Number(id),
      targetLabel: await groupLabel(db, Number(id)),
      detail: { from: before.userIds.length, to: r.userIds.length },
    });
    return r;
  });
}
