import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { Config } from '../config.js';
import { verifyPassword, hashPassword } from './password.js';
import { createSession, deleteSession, SESSION_COOKIE_NAME } from './session.js';
import { HttpError } from '../http-error.js';
import { authenticate } from '../plugins/auth.js';
import { parsePrefs, serializePrefs } from '../user-prefs.js';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

const profileSchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  theme: z.string().min(1).max(32).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(6).max(128),
});

export async function authRoutes(
  app: FastifyInstance,
  opts: { db: Db; config: Config },
): Promise<void> {
  const { db, config } = opts;

  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await db
      .selectFrom('user')
      .selectAll()
      .where('username', '=', body.username)
      .where('provider', '=', 'local')
      .executeTakeFirst();

    if (!user || !user.password_hash || !(await verifyPassword(user.password_hash, body.password))) {
      throw new HttpError(401, '用户名或密码错误');
    }
    if (user.status !== 'active') {
      throw new HttpError(403, '账号已停用');
    }

    const session = await createSession(db, {
      userId: user.id,
      ttlMs: config.SESSION_TTL_MS,
      ip: request.ip,
      ua: request.headers['user-agent'],
    });

    reply.setCookie(SESSION_COOKIE_NAME, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(config.SESSION_TTL_MS / 1000),
    });

    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    };
  });

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) {
      await deleteSession(db, token);
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (request) => {
    const user = authenticate(request);
    const row = await db
      .selectFrom('user')
      .select(['id', 'username', 'display_name', 'role', 'status', 'prefs'])
      .where('id', '=', user.userId)
      .executeTakeFirst();
    if (!row) throw new HttpError(401, '会话已失效，请重新登录');

    return {
      userId: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      // 未设置过主题时不返回该字段，前端保持本地/默认主题
      theme: parsePrefs(row.prefs).theme,
    };
  });

  // 本人修改显示名 / 界面主题
  app.put('/profile', async (request) => {
    const user = authenticate(request);
    const body = profileSchema.parse(request.body);

    const row = await db.selectFrom('user').selectAll().where('id', '=', user.userId).executeTakeFirst();
    if (!row) throw new HttpError(404, '用户不存在');

    const prefs = parsePrefs(row.prefs);
    if (body.theme !== undefined) prefs.theme = body.theme;

    const displayName = body.displayName?.trim() || row.display_name;
    await db
      .updateTable('user')
      .set({ display_name: displayName, prefs: serializePrefs(prefs), updated_at: Date.now() })
      .where('id', '=', user.userId)
      .execute();

    return { ok: true, displayName, theme: prefs.theme };
  });

  // 本人修改密码（需校验当前密码）
  app.post('/change-password', async (request) => {
    const user = authenticate(request);
    const body = changePasswordSchema.parse(request.body);

    const row = await db.selectFrom('user').selectAll().where('id', '=', user.userId).executeTakeFirst();
    if (!row) throw new HttpError(404, '用户不存在');
    if (row.provider !== 'local' || !row.password_hash) {
      throw new HttpError(400, '该账号不支持修改本地密码');
    }
    if (!(await verifyPassword(row.password_hash, body.currentPassword))) {
      throw new HttpError(400, '当前密码不正确');
    }
    if (body.currentPassword === body.newPassword) {
      throw new HttpError(400, '新密码不能与当前密码相同');
    }

    await db
      .updateTable('user')
      .set({ password_hash: await hashPassword(body.newPassword), updated_at: Date.now() })
      .where('id', '=', user.userId)
      .execute();

    return { ok: true };
  });
}
