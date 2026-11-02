import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { Config } from '../config.js';
import { verifyPassword, hashPassword } from './password.js';
import { createSession, deleteSession, SESSION_COOKIE_NAME } from './session.js';
import { HttpError } from '../http-error.js';
import { authenticate } from '../plugins/auth.js';
import { parsePrefs, serializePrefs } from '../user-prefs.js';
import { audit, writeAudit } from '../audit/service.js';
import { sha256hex } from './reset.js';

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

// ---------- 登录失败限流 ----------
// 内存滑动窗口就够了：单容器单进程，内网部署也没有多实例需求。
// 不引第三方限流库，是为了让镜像少一个依赖。
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
/** 同一个「用户名 + IP」允许的失败次数 */
const LOGIN_MAX_FAILS = 8;
/** 同一个 IP 在窗口内允许的失败总数：挡住「换着用户名撞库」 */
const LOGIN_MAX_FAILS_PER_IP = 30;
interface FailBucket {
  count: number;
  resetAt: number;
}
const loginFails = new Map<string, FailBucket>();
const ipFails = new Map<string, FailBucket>();

/** 按「用户名 + 来源 IP」计数：只按 IP 会被同一个办公网出口连坐，只按用户名又挡不住撞库换号 */
function failKey(username: string, ip: string): string {
  return `${username.toLowerCase()}|${ip}`;
}

function bump(map: Map<string, FailBucket>, key: string): void {
  const now = Date.now();
  const b = map.get(key);
  if (!b || b.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    b.count++;
  }
  // 顺手清扫过期条目，别让表无限长
  if (map.size > 5000) {
    for (const [k, v] of map) if (v.resetAt <= now) map.delete(k);
  }
}

/** 这个桶还需要等多少秒；0 表示没被限 */
function remainSec(map: Map<string, FailBucket>, key: string, limit: number): number {
  const b = map.get(key);
  if (!b) return 0;
  const left = b.resetAt - Date.now();
  if (left <= 0) {
    map.delete(key);
    return 0;
  }
  return b.count >= limit ? Math.ceil(left / 1000) : 0;
}

/** 返回还需要等多少秒；0 表示没被限 */
function throttleRemainSec(username: string, ip: string): number {
  return Math.max(remainSec(loginFails, failKey(username, ip), LOGIN_MAX_FAILS), remainSec(ipFails, ip, LOGIN_MAX_FAILS_PER_IP));
}

function noteLoginFail(username: string, ip: string): void {
  bump(loginFails, failKey(username, ip));
  bump(ipFails, ip);
}

// 用户不存在时也跑一次 argon2，抹掉「有没有这个账号」的响应时间差
let timingHash: string | null = null;
async function dummyPasswordHash(): Promise<string> {
  if (!timingHash) timingHash = await hashPassword('liti-dummy-password-for-timing');
  return timingHash;
}

// ---------- 找回密码：兑换端限流 ----------
// 重置码本身有 8 位 base32 + 单次有效 + 30 分钟过期的组合保护，但要挡住「对着一个用户名穷举」，
// 再叠一层跟登录同款的内存滑动窗口。单容器单进程，内网部署没有多实例需求。
const RESET_WINDOW_MS = 10 * 60 * 1000;
/** 同一个「用户名 + IP」允许的失败次数 */
const RESET_MAX_FAILS = 5;
/** 同一个 IP 在窗口内允许的失败总数 */
const RESET_MAX_FAILS_PER_IP = 20;
const resetFails = new Map<string, FailBucket>();
const resetIpFails = new Map<string, FailBucket>();

function resetRemainSec(username: string, ip: string): number {
  return Math.max(remainSec(resetFails, failKey(username, ip), RESET_MAX_FAILS), remainSec(resetIpFails, ip, RESET_MAX_FAILS_PER_IP));
}

function noteResetFail(username: string, ip: string): void {
  bump(resetFails, failKey(username, ip));
  bump(resetIpFails, ip);
}

export async function authRoutes(
  app: FastifyInstance,
  opts: { db: Db; config: Config },
): Promise<void> {
  const { db, config } = opts;

  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const key = failKey(body.username, request.ip);
    const waitSec = throttleRemainSec(body.username, request.ip);
    if (waitSec > 0) {
      reply.header('Retry-After', String(waitSec));
      throw new HttpError(429, `密码错误次数过多，请 ${Math.ceil(waitSec / 60)} 分钟后再试`);
    }

    const user = await db
      .selectFrom('user')
      .selectAll()
      .where('username', '=', body.username)
      .where('provider', '=', 'local')
      .executeTakeFirst();

    // 账号不存在时也照样算一次哈希：否则「查无此人」会明显更快，等于送了个用户名枚举信标
    const hash = user?.password_hash ?? (await dummyPasswordHash());
    const passwordOk = await verifyPassword(hash, body.password);

    if (!user || !passwordOk) {
      noteLoginFail(body.username, request.ip);
      // 登录失败要留痕：撞库、离职老师的号还在被人试、学生互相猜密码，
      // 都只能从这条记录里看出来。密码本身当然不进日志，只记「为什么失败」。
      // 量不会失控 —— 上面那层限流到点就 429 了，走到这里之前已经截住。
      await writeAudit(db, {
        actor: { id: user?.id ?? null, name: user?.display_name || body.username, role: user?.role ?? null },
        action: 'auth.login-failed',
        targetType: 'user',
        targetId: user?.id ?? null,
        targetLabel: body.username,
        detail: { username: body.username, reason: user ? 'bad-password' : 'no-such-user' },
        ip: request.ip,
      });
      throw new HttpError(401, '用户名或密码错误');
    }
    if (user.status !== 'active') {
      await writeAudit(db, {
        actor: { id: user.id, name: user.display_name || user.username, role: user.role },
        action: 'auth.login-failed',
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.username,
        detail: { username: user.username, reason: 'disabled' },
        ip: request.ip,
      });
      throw new HttpError(403, '账号已停用');
    }

    loginFails.delete(key);

    const session = await createSession(db, {
      userId: user.id,
      ttlMs: config.SESSION_TTL_MS,
      ip: request.ip,
      ua: request.headers['user-agent'],
    });

    // 这里还没有 authUser（会话刚建），所以显式传 actor
    await writeAudit(db, {
      actor: { id: user.id, name: user.display_name || user.username, role: user.role },
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.display_name,
      ip: request.ip,
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
      // 会话还有效才记一条；过期后重复登出不必刷屏
      if (request.authUser) {
        await audit(db, request, {
          action: 'auth.logout',
          targetType: 'user',
          targetId: request.authUser.userId,
          targetLabel: request.authUser.displayName,
        });
      }
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

    // 只换主题不记日志 —— 那是界面偏好，不是管理动作，记了全是噪音
    if (displayName !== row.display_name) {
      await audit(db, request, {
        action: 'auth.profile-update',
        targetType: 'user',
        targetId: user.userId,
        targetLabel: displayName,
        detail: { field: 'displayName', from: row.display_name, to: displayName },
      });
    }

    return { ok: true, displayName, theme: prefs.theme };
  });

  // 本人修改密码（需校验当前密码）
  app.post('/change-password', async (request, reply) => {
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

    // 改完密码把这个账号的会话全作废，再给当前这台设备重发一个 ——
    // 否则「密码泄露了，我改个密码」根本踢不掉对方手上那个会话。
    await db.deleteFrom('session').where('user_id', '=', user.userId).execute();
    const fresh = await createSession(db, {
      userId: user.userId,
      ttlMs: config.SESSION_TTL_MS,
      ip: request.ip,
      ua: request.headers['user-agent'],
    });
    reply.setCookie(SESSION_COOKIE_NAME, fresh.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(config.SESSION_TTL_MS / 1000),
    });

    // 学生说「我密码被人改了」时，这条日志能区分是本人改的还是老师重置的
    await audit(db, request, {
      action: 'auth.change-password',
      targetType: 'user',
      targetId: user.userId,
      targetLabel: row.display_name,
    });

    return { ok: true };
  });

  // 凭重置码改密码（公开接口，未登录也能调）：学生锁死密码后自助解开
  app.post('/reset-password', async (request) => {
    const body = z
      .object({
        username: z.string().min(1).max(64),
        code: z.string().min(4).max(32),
        newPassword: z.string().min(6).max(128),
      })
      .parse(request.body);

    const waitSec = resetRemainSec(body.username, request.ip);
    if (waitSec > 0) {
      throw new HttpError(429, `重置尝试次数过多，请 ${Math.ceil(waitSec / 60)} 分钟后再试`);
    }

    const user = await db
      .selectFrom('user')
      .selectAll()
      .where('username', '=', body.username)
      .where('provider', '=', 'local')
      .executeTakeFirst();

    const hash = sha256hex(body.code.toUpperCase().trim());
    const now = Date.now();
    // 只认「属于这个用户 + 哈希对得上 + 没用过 + 没过期」的最新一条
    const row = user
      ? await db
          .selectFrom('password_reset')
          .selectAll()
          .where('user_id', '=', user.id)
          .where('token_hash', '=', hash)
          .where('used_at', 'is', null)
          .where('expires_at', '>', now)
          .orderBy('created_at', 'desc')
          .executeTakeFirst()
      : undefined;

    if (!user || !user.password_hash || !row) {
      noteResetFail(body.username, request.ip);
      // 原因只写进审计，不向客户端透露（避免借「用户不存在」「码过期」做枚举）
      let reason = user ? 'no-match' : 'no-such-user';
      if (user?.password_hash) {
        const anyRow = await db
          .selectFrom('password_reset')
          .selectAll()
          .where('user_id', '=', user.id)
          .where('token_hash', '=', hash)
          .executeTakeFirst();
        if (anyRow) reason = anyRow.used_at != null ? 'used' : Number(anyRow.expires_at) <= now ? 'expired' : 'no-match';
      }
      await writeAudit(db, {
        actor: { id: user?.id ?? null, name: user?.display_name || body.username, role: user?.role ?? null },
        action: 'auth.reset-failed',
        targetType: 'user',
        targetId: user?.id ?? null,
        targetLabel: body.username,
        detail: { username: body.username, reason },
        ip: request.ip,
      });
      throw new HttpError(400, '重置码无效或已失效');
    }

    // 校验通过：改密码 + 标记已用 + 清掉该账号全部会话（同后台重置的处置）
    await db
      .updateTable('user')
      .set({ password_hash: await hashPassword(body.newPassword), updated_at: now })
      .where('id', '=', user.id)
      .execute();
    await db.updateTable('password_reset').set({ used_at: now }).where('id', '=', row.id).execute();
    await db.deleteFrom('session').where('user_id', '=', user.id).execute();

    await writeAudit(db, {
      actor: { id: user.id, name: user.display_name || user.username, role: user.role },
      action: 'auth.reset-password',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.display_name,
      ip: request.ip,
    });

    return { ok: true };
  });
}
