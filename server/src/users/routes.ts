import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { Role } from '../db/types.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole, type AuthUser } from '../rbac.js';
import { HttpError } from '../http-error.js';
import { hashPassword } from '../auth/password.js';
import { groupNamesByUser, purgeUserFromGroups } from '../group/service.js';
import { purgeUserWrong } from '../wrong/service.js';

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

/**
 * 权限模型（v0.5 起）：
 * - 管理员：所有账号
 * - 教师：**只能管学生**。可以建学生、改学生资料、重置学生密码、停用/删除学生；
 *   但不能创建教师/管理员，不能碰别人的角色，也不能给自己提权。
 * 这条边界写在服务端，不能只靠前端把按钮藏起来。
 */
function assertTeacherMayManage(actor: AuthUser, target: { role: Role; id: number }): void {
  if (actor.role === 'admin') return;
  if (target.id === actor.userId) throw new HttpError(400, '请到「个人设置」里修改自己的资料');
  if (target.role !== 'student') throw new HttpError(403, '教师只能管理学生账号');
}

export async function userRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  // 用户列表：管理员看全部；教师只看学生
  app.get('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');

    let q = db.selectFrom('user').select(['id', 'username', 'display_name', 'role', 'status', 'provider', 'created_at']);
    if (user.role !== 'admin') q = q.where('role', '=', 'student');

    const rows = await q.orderBy('id', 'asc').execute();
    const groupMap = await groupNamesByUser(db);

    return rows.map((r) => ({ ...r, groups: groupMap.get(r.id) ?? [] }));
  });

  // 学生名册（教师也要用：发布试卷时挑可见学生、建分组时挑人）
  // 只给 id / 用户名 / 显示名，不暴露密码哈希、会话等任何敏感字段
  app.get('/students', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');

    const rows = await db
      .selectFrom('user')
      .select(['id', 'username', 'display_name'])
      .where('role', '=', 'student')
      .where('status', '=', 'active')
      .orderBy('id', 'asc')
      .execute();

    return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name }));
  });

  // 创建用户：管理员可建任意角色；教师只能建学生
  app.post('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const body = createUserSchema.parse(request.body);

    if (user.role !== 'admin' && body.role !== 'student') {
      throw new HttpError(403, '教师只能创建学生账号');
    }

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
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    const body = updateUserSchema.parse(request.body);

    const target = await db.selectFrom('user').selectAll().where('id', '=', Number(id)).executeTakeFirst();
    if (!target) throw new HttpError(404, '用户不存在');
    assertTeacherMayManage(user, target);

    // 教师不能把学生改成教师/管理员（提权），也不能改角色
    if (user.role !== 'admin' && body.role !== undefined && body.role !== 'student') {
      throw new HttpError(403, '教师不能修改账号角色');
    }

    // 防止管理员把自己降权/停用
    if (target.id === user.userId && body.role && body.role !== 'admin') {
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

    // 停用即踢下线：会话留着也没用了，顺手清掉，别指望每次请求都去查 status
    if (body.status === 'disabled') {
      await db.deleteFrom('session').where('user_id', '=', Number(id)).execute();
    }

    return { ok: true };
  });

  // 重置密码
  app.post('/:id/reset-password', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };
    const body = resetPasswordSchema.parse(request.body);

    const target = await db.selectFrom('user').select(['id', 'role']).where('id', '=', Number(id)).executeTakeFirst();
    if (!target) throw new HttpError(404, '用户不存在');
    assertTeacherMayManage(user, target);

    await db
      .updateTable('user')
      .set({ password_hash: await hashPassword(body.password), updated_at: Date.now() })
      .where('id', '=', Number(id))
      .execute();

    // 重置密码后必须把该账号的会话全部作废：否则学生密码被改了，
    // 他手上那个旧会话还能继续答题、看成绩，等于没改
    await db.deleteFrom('session').where('user_id', '=', Number(id)).execute();

    return { ok: true };
  });

  // 删除用户（不能删自己）
  app.delete('/:id', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };

    if (Number(id) === user.userId) throw new HttpError(400, '不能删除自己的账号');

    const target = await db.selectFrom('user').select(['id', 'role']).where('id', '=', Number(id)).executeTakeFirst();
    if (!target) throw new HttpError(404, '用户不存在');
    assertTeacherMayManage(user, target);

    // 删除该用户的答卷、错题库、分组归属
    await db.transaction().execute(async (trx) => {
      const attempts = await trx.selectFrom('attempt').select('id').where('user_id', '=', Number(id)).execute();
      const attemptIds = attempts.map((a) => a.id);
      if (attemptIds.length) {
        await trx.deleteFrom('attempt_item').where('attempt_id', 'in', attemptIds).execute();
        await trx.deleteFrom('attempt_violation').where('attempt_id', 'in', attemptIds).execute();
        await trx.deleteFrom('attempt').where('user_id', '=', Number(id)).execute();
      }
      await purgeUserWrong(trx, Number(id));
      await purgeUserFromGroups(trx, Number(id));
      await trx.deleteFrom('session').where('user_id', '=', Number(id)).execute();
      await trx.deleteFrom('paper_audience').where('user_id', '=', Number(id)).execute();
      await trx.deleteFrom('user').where('id', '=', Number(id)).execute();
    });

    return { ok: true };
  });
}
