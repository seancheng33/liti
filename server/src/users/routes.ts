import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { Role } from '../db/types.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole, type AuthUser } from '../rbac.js';
import { HttpError } from '../http-error.js';
import { hashPassword } from '../auth/password.js';
import { generateResetCode, sha256hex, RESET_CODE_TTL_MS } from '../auth/reset.js';
import { groupNamesByUser, purgeUserFromGroups } from '../group/service.js';
import { buildStudentTemplate, parseStudentRows, DEFAULT_STUDENT_PASSWORD } from '../excel/student.js';
import { purgeUserWrong } from '../wrong/service.js';
import { audit } from '../audit/service.js';
import { userLabel } from '../audit/labels.js';

const studentNoField = z
  .string()
  .max(32)
  .regex(/^[a-zA-Z0-9_-]*$/, '学号只能包含字母、数字、下划线和连字符')
  .nullish();
const classField = z.string().max(64).nullish();

const createUserSchema = z.object({
  username: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_.-]+$/, '用户名只能包含字母、数字、下划线、点和连字符'),
  displayName: z.string().min(1).max(64),
  password: z.string().min(6).max(128),
  role: z.enum(['admin', 'teacher', 'student']),
  studentNo: studentNoField,
  className: classField,
});

const updateUserSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  role: z.enum(['admin', 'teacher', 'student']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  studentNo: studentNoField,
  className: classField,
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

/** 学号在全校唯一：两个学生同一个学号，成绩册当场对不上人 */
async function assertStudentNoFree(db: Db, studentNo: string | null | undefined, excludeId?: number): Promise<void> {
  const no = studentNo?.trim();
  if (!no) return;
  let q = db.selectFrom('user').select('id').where('student_no', '=', no);
  if (excludeId != null) q = q.where('id', '!=', excludeId);
  const hit = await q.executeTakeFirst();
  if (hit) throw new HttpError(409, `学号 ${no} 已被其他账号占用`);
}

export async function userRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  // 用户列表：管理员看全部；教师只看学生
  app.get('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');

    let q = db
      .selectFrom('user')
      .select(['id', 'username', 'display_name', 'role', 'status', 'provider', 'created_at', 'student_no', 'class_name']);
    if (user.role !== 'admin') q = q.where('role', '=', 'student');

    const rows = await q.orderBy('id', 'asc').execute();
    const groupMap = await groupNamesByUser(db);

    return rows.map((r) => ({
      ...r,
      studentNo: r.student_no,
      className: r.class_name,
      groups: groupMap.get(r.id) ?? [],
    }));
  });

  // 学生名册（教师也要用：发布试卷时挑可见学生、建分组时挑人）
  // 只给 id / 用户名 / 显示名，不暴露密码哈希、会话等任何敏感字段
  app.get('/students', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');

    const rows = await db
      .selectFrom('user')
      .select(['id', 'username', 'display_name', 'student_no', 'class_name'])
      .where('role', '=', 'student')
      .where('status', '=', 'active')
      .orderBy('id', 'asc')
      .execute();

    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      studentNo: r.student_no,
      className: r.class_name,
    }));
  });

  // 班级列表（按班导出成绩、按班筛选学生都要用）
  app.get('/classes', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const rows = await db
      .selectFrom('user')
      .select('class_name')
      .where('role', '=', 'student')
      .where('class_name', 'is not', null)
      .distinct()
      .execute();
    return rows
      .map((r) => r.class_name as string)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  });

  // 学生名单导入模板（和导入一样只给教师/管理员）
  app.get('/template', async (request, reply) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const buf = await buildStudentTemplate();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="students-template.xlsx"');
    return reply.send(buf);
  });

  /**
   * 学生批量导入。
   *
   * 与题库导入不同：这里**逐行独立提交**，一行出错不连累其他行。
   * 一个学期的名单几十上百人，因为第 37 行学号重复整批回滚，老师会疯。
   * 结果里逐行说明「建好了 / 跳过了（为什么）/ 失败（为什么）」。
   */
  app.post('/import', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const q = request.query as { dryRun?: string };
    const dryRun = q.dryRun === 'true' || q.dryRun === '1';

    const body = request.body;
    if (!Buffer.isBuffer(body)) throw new HttpError(400, '请求体必须为 xlsx 二进制内容');

    const rows = await parseStudentRows(body);
    if (!rows.length) throw new HttpError(400, '表格里没有数据（第 2 行起为空）');
    if (rows.length > 1000) throw new HttpError(400, '一次最多导入 1000 行');

    const usernames = [...new Set(rows.map((r) => r.username).filter(Boolean))];
    const studentNos = [...new Set(rows.map((r) => r.studentNo).filter((x): x is string => !!x))];

    const dupUsers = usernames.length
      ? await db.selectFrom('user').select('username').where('username', 'in', usernames).execute()
      : [];
    const dupNos = studentNos.length
      ? await db
          .selectFrom('user')
          .select('student_no')
          .where('student_no', 'in', studentNos)
          .execute()
      : [];
    const takenUsers = new Set(dupUsers.map((u) => u.username));
    const takenNos = new Set(dupNos.map((u) => u.student_no as string));

    const groups = await db.selectFrom('student_group').select(['id', 'name']).execute();
    const groupIdByName = new Map(groups.map((g) => [g.name, g.id]));

    const result = {
      dryRun,
      total: rows.length,
      created: 0,
      skipped: 0,
      failed: 0,
      warnings: [] as { row: number; message: string }[],
      errors: [] as { row: number; message: string }[],
      // 新账号的初始密码（只在导入结果里回显一次，方便老师发给学生）
      defaultPassword: DEFAULT_STUDENT_PASSWORD,
      ids: [] as number[],
    };

    const seenUser = new Set<string>();
    const seenNo = new Set<string>();
    // argon2 一次约几十毫秒，1000 行逐行 hash 会把请求拖到超时；
    // 绝大多数人用同一个默认密码，按明文缓存哈希即可
    const hashCache = new Map<string, string>();
    const now = Date.now();

    for (const r of rows) {
      if (r.errors.length) {
        result.failed += 1;
        result.errors.push({ row: r.row, message: r.errors.join('；') });
        continue;
      }
      if (takenUsers.has(r.username) || seenUser.has(r.username)) {
        result.skipped += 1;
        result.warnings.push({ row: r.row, message: `用户名 ${r.username} 已存在，跳过` });
        continue;
      }
      if (r.studentNo && (takenNos.has(r.studentNo) || seenNo.has(r.studentNo))) {
        result.skipped += 1;
        result.warnings.push({ row: r.row, message: `学号 ${r.studentNo} 已被占用，跳过` });
        continue;
      }
      seenUser.add(r.username);
      if (r.studentNo) seenNo.add(r.studentNo);

      if (dryRun) {
        result.created += 1;
        continue;
      }

      let hash = hashCache.get(r.password);
      if (!hash) {
        hash = await hashPassword(r.password);
        hashCache.set(r.password, hash);
      }

      const res = await db
        .insertInto('user')
        .values({
          username: r.username,
          display_name: r.displayName,
          password_hash: hash,
          role: 'student',
          provider: 'local',
          external_id: null,
          status: 'active',
          student_no: r.studentNo,
          class_name: r.className,
          created_at: now,
          updated_at: now,
        })
        .executeTakeFirstOrThrow();
      const uid = Number(res.insertId);
      result.ids.push(uid);
      result.created += 1;

      // 分组按名字匹配，只挂已存在的组（不自动建组：组名写错就冒出个空组更难收拾）
      for (const name of r.groupNames) {
        const gid = groupIdByName.get(name);
        if (!gid) {
          result.warnings.push({ row: r.row, message: `分组「${name}」不存在，已忽略` });
          continue;
        }
        await db.insertInto('student_group_member').values({ group_id: gid, user_id: uid, created_at: now }).execute();
      }
    }

    if (!dryRun) {
      // 预检不写日志：它不改任何数据，记下来只会让「谁导了名单」这条线索变模糊
      await audit(db, request, {
        action: 'user.import',
        targetType: 'user',
        targetLabel: `${result.created} 个新账号（共 ${result.total} 行）`,
        detail: {
          total: result.total,
          created: result.created,
          skipped: result.skipped,
          failed: result.failed,
        },
      });
    }

    return result;
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
    await assertStudentNoFree(db, body.studentNo);

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
        student_no: body.studentNo?.trim() || null,
        class_name: body.className?.trim() || null,
        created_at: now,
        updated_at: now,
      })
      .executeTakeFirstOrThrow();
    const newId = Number(res.insertId);
    await audit(db, request, {
      action: 'user.create',
      targetType: 'user',
      targetId: newId,
      targetLabel: `${body.displayName}（${body.username}）`,
      detail: { role: body.role, studentNo: body.studentNo ?? null, className: body.className ?? null },
    });
    return { id: newId };
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

    // studentNo / className 传 null 表示清空，传 undefined（不传）表示保持原值
    const nextStudentNo = body.studentNo === undefined ? target.student_no : body.studentNo?.trim() || null;
    if (nextStudentNo !== target.student_no) await assertStudentNoFree(db, nextStudentNo, target.id);

    const nextDisplayName = body.displayName ?? target.display_name;
    const nextRole = body.role ?? target.role;
    const nextStatus = body.status ?? target.status;
    const nextClassName = body.className === undefined ? target.class_name : body.className?.trim() || null;

    // 只记真正变了的字段：逐字段不落地记一遍「张三→张三」没人看得下去
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (nextDisplayName !== target.display_name) changes.displayName = { from: target.display_name, to: nextDisplayName };
    if (nextRole !== target.role) changes.role = { from: target.role, to: nextRole };
    if (nextStatus !== target.status) changes.status = { from: target.status, to: nextStatus };
    if (nextStudentNo !== target.student_no) changes.studentNo = { from: target.student_no, to: nextStudentNo };
    if (nextClassName !== target.class_name) changes.className = { from: target.class_name, to: nextClassName };

    await db
      .updateTable('user')
      .set({
        display_name: nextDisplayName,
        role: nextRole,
        status: nextStatus,
        student_no: nextStudentNo,
        class_name: nextClassName,
        updated_at: Date.now(),
      })
      .where('id', '=', Number(id))
      .execute();

    // 停用即踢下线：会话留着也没用了，顺手清掉，别指望每次请求都去查 status
    if (body.status === 'disabled') {
      await db.deleteFrom('session').where('user_id', '=', Number(id)).execute();
    }

    if (Object.keys(changes).length > 0) {
      await audit(db, request, {
        action: 'user.update',
        targetType: 'user',
        targetId: target.id,
        targetLabel: `${nextDisplayName}（${target.username}）`,
        detail: { changes },
      });
    }

    return { ok: true };
  });

  // 签发一次性重置码（找回密码用）：教师/管理员生成，学生登录取码设新密码
  app.post('/:id/reset-code', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');
    const { id } = request.params as { id: string };

    const target = await db.selectFrom('user').selectAll().where('id', '=', Number(id)).executeTakeFirst();
    if (!target) throw new HttpError(404, '用户不存在');
    assertTeacherMayManage(user, target);
    if (target.provider !== 'local' || !target.password_hash) {
      throw new HttpError(400, '该账号不支持本地密码重置');
    }

    const now = Date.now();
    // 同一账号同时只认最新签发的那一条：把旧的未用码作废，缩小穷举面
    await db
      .updateTable('password_reset')
      .set({ used_at: now })
      .where('user_id', '=', target.id)
      .where('used_at', 'is', null)
      .execute();

    const code = generateResetCode(8);
    await db
      .insertInto('password_reset')
      .values({
        user_id: target.id,
        token_hash: sha256hex(code),
        expires_at: now + RESET_CODE_TTL_MS,
        created_by: user.userId,
        created_at: now,
      })
      .execute();

    // 只回显明文码这一次；不记码本身，只记「谁给谁签了、什么时候失效」
    await audit(db, request, {
      action: 'user.reset-code',
      targetType: 'user',
      targetId: target.id,
      targetLabel: `${target.display_name}（${target.username}）`,
      detail: { username: target.username, expiresAt: now + RESET_CODE_TTL_MS },
    });

    return { code, expiresAt: now + RESET_CODE_TTL_MS };
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

    const label = await userLabel(db, target.id);

    await db
      .updateTable('user')
      .set({ password_hash: await hashPassword(body.password), updated_at: Date.now() })
      .where('id', '=', Number(id))
      .execute();

    // 重置密码后必须把该账号的会话全部作废：否则学生密码被改了，
    // 他手上那个旧会话还能继续答题、看成绩，等于没改
    await db.deleteFrom('session').where('user_id', '=', Number(id)).execute();

    // 不记密码内容，只记「谁重置了谁的密码」—— 详情里出现明文就是安全事故
    await audit(db, request, {
      action: 'user.reset-password',
      targetType: 'user',
      targetId: target.id,
      targetLabel: label,
    });

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

    // 必须在删除之前把名字抄下来 —— 删完就再也查不到这是谁了，
    // 而「谁删了哪个账号」恰恰是这条日志唯一的价值
    const label = await userLabel(db, target.id);
    const counts = await db
      .selectFrom('attempt')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('user_id', '=', Number(id))
      .executeTakeFirst();

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

    // 删账号连带删掉他的答卷，这个破坏力必须留痕
    await audit(db, request, {
      action: 'user.delete',
      targetType: 'user',
      targetId: target.id,
      targetLabel: label,
      detail: { deletedAttempts: Number(counts?.c ?? 0) },
    });

    return { ok: true };
  });
}
