import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';
import { HttpError } from '../http-error.js';
import { hashPassword } from '../auth/password.js';

const createUserSchema = z.object({
  username: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_.-]+$/, '用户名只能包含字母、数字、下划线、点和连字符'),
  displayName: z.string().min(1).max(64),
  password: z.string().min(6).max(128),
  role: z.enum(['admin', 'teacher', 'student']),
});

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  role: z.enum(['admin', 'teacher', 'student']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(6).max(128),
});

export async function userRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  // 用户列表（仅管理员）
  app.get('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin');

    const rows = await db
      .selectFrom('user')
      .select(['id', 'username', 'display_name', 'role', 'status', 'provider', 'created_at'])
      .orderBy('id', 'asc')
      .execute();

    return rows;
  });

  // 创建用户（仅管理员）
  app.post('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin');
    const body = createUserSchema.parse(request.body);

    const existing = await db.selectFrom('user').select('id').where('username', '=', body.username).executeTakeFirst();
    if (existing) throw new HttpError(409, '用户名已存在');

    const now = Date.now();
    const res = await db
      .insertInto('user')
      .values({
        username: body.username,
        display_name: body.displayName,
        password_hash: await hashPassword(body.password),
        role: body.role,
        provider: 'local',
        external_id: null,
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      .executeTakeFirstOrThrow();
    return { id: Number(res.insertId) };
  });

  // 编辑用户（改显示名/角色/状态）
  app.put('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin');
    const { id } = request.params as { id: string };
    const body = updateUserSchema.parse(request.body);

    const target = await db.selectFrom('user').selectAll().where('id', '=', Number(id)).executeTakeFirst();
    if (!target) throw new HttpError(404, '用户不存在');

    // 防止管理员把自己降权/停用
    if (target.id === user.userId && (body.role && body.role !== 'admin')) {
      throw new HttpError(400, '不能修改自己的角色');
    }
    if (target.id === user.userId && body.status === 'disabled') {
      throw new HttpError(400, '不能停用自己的账号');
    }

    await db
      .updateTable('user')
      .set({
        display_name: body.displayName ?? target.display_name,
        role: body.role ?? target.role,
        status: body.status ?? target.status,
        updated_at: Date.now(),
      })
      .where('id', '=', Number(id))
      .execute();
    return { ok: true };
  });

  // 重置密码（仅管理员）
  app.post('/:id/reset-password', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin');
    const { id } = request.params as { id: string };
    const body = resetPasswordSchema.parse(request.body);

    const target = await db.selectFrom('user').select('id').where('id', '=', Number(id)).executeTakeFirst();
    if (!target) throw new HttpError(404, '用户不存在');

    await db
      .updateTable('user')
      .set({ password_hash: await hashPassword(body.password), updated_at: Date.now() })
      .where('id', '=', Number(id))
      .execute();
    return { ok: true };
  });

  // 删除用户（仅管理员，不能删自己）
  app.delete('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin');
    const { id } = request.params as { id: string };

    if (Number(id) === user.userId) throw new HttpError(400, '不能删除自己的账号');

    const target = await db.selectFrom('user').select('id').where('id', '=', Number(id)).executeTakeFirst();
    if (!target) throw new HttpError(404, '用户不存在');

    // 删除该用户的答卷及其关联数据
    await db.transaction().execute(async (trx) => {
      const attempts = await trx.selectFrom('attempt').select('id').where('user_id', '=', Number(id)).execute();
      const attemptIds = attempts.map((a) => a.id);
      if (attemptIds.length) {
        await trx.deleteFrom('attempt_item').where('attempt_id', 'in', attemptIds).execute();
        await trx.deleteFrom('attempt_violation').where('attempt_id', 'in', attemptIds).execute();
        await trx.deleteFrom('attempt').where('user_id', '=', Number(id)).execute();
      }
      await trx.deleteFrom('session').where('user_id', '=', Number(id)).execute();
      await trx.deleteFrom('user').where('id', '=', Number(id)).execute();
    });

    return { ok: true };
  });
}
