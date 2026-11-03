/**
 * 演示模式专用接口。**只在 DEMO_MODE=1 时才会被注册**（见 app.ts）。
 *
 * 提供两件事：
 * - GET  /api/demo/info   告诉前端「这是演示站」以及可以一键进哪几个角色
 * - POST /api/demo/login  免密码登录到演示账号
 *
 * 免密码登录是演示站的核心体验：让访客输 admin/admin123 会把一大半人挡在门外。
 * 代价是它等于把门拆了 —— 所以这个文件永远不能在生产实例上被注册，
 * 判断放在 app.ts 而不是路由内部，注册这一步就断掉，不存在「忘了在 handler 里检查」的可能。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import type { Config } from '../config.js';
import { createSession, SESSION_COOKIE_NAME } from '../auth/session.js';
import { HttpError } from '../http-error.js';
import { writeAudit } from '../audit/service.js';
import { ensureDemoScenario } from './seed.js';

/** 一键登录的入口角色。学生那个挑一个名字好记的 */
const ENTRIES = [
  {
    role: 'admin' as const,
    username: 'admin',
    label: '管理员',
    hint: '账号管理、站点设置、审计日志、全部题库与试卷',
  },
  {
    role: 'teacher' as const,
    username: 'teacher',
    label: '教师',
    hint: '建题库、组卷、开考、监考、成绩册与逐题分析',
  },
  {
    role: 'student' as const,
    username: 'stu01',
    label: '学生',
    hint: '答题、看成绩与解析、错题本、随机练习',
  },
];

/**
 * 一键登录的限流。演示站挂在公网上，一条 curl 循环能把 session 表刷到几十万行。
 * 只按 IP 计数、只在内存里，重启即清 —— 够用，也不必为它引依赖。
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const buckets = new Map<string, { count: number; resetAt: number }>();

function tooMany(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count++;
  if (buckets.size > 2000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  return b.count > MAX_PER_WINDOW;
}

/** 场景自检节流：一分钟最多查一次库，别每个请求都去数一遍答卷 */
let lastCheck = 0;

export async function demoRoutes(app: FastifyInstance, opts: { db: Db; config: Config }): Promise<void> {
  const { db, config } = opts;

  app.get('/info', async () => {
    if (Date.now() - lastCheck > 60_000) {
      lastCheck = Date.now();
      // 顺手保证「进行中的考试」里一直有人，否则监考页看起来是空的
      await ensureDemoScenario(db).catch(() => {});
    }

    const site = await db
      .selectFrom('setting')
      .select(['key', 'value'])
      .where('key', '=', 'site_name')
      .executeTakeFirst();

    return {
      demo: true,
      siteName: site?.value ?? '砺题 Liti',
      /** 数据多久还原一次，前端文案直接用它，避免两边各写一份数字 */
      resetHint: '演示数据每小时自动还原，随便点、随便改',
      accounts: ENTRIES.map((e) => ({ role: e.role, username: e.username, label: e.label, hint: e.hint })),
    };
  });

  app.post('/login', async (request: FastifyRequest, reply) => {
    if (tooMany(request.ip)) throw new HttpError(429, '点得太快了，歇一会儿再试');

    const { role } = (request.body ?? {}) as { role?: string };
    const entry = ENTRIES.find((e) => e.role === role);
    if (!entry) throw new HttpError(400, '只能以 admin / teacher / student 身份进入演示');

    const user = await db
      .selectFrom('user')
      .select(['id', 'username', 'display_name', 'role', 'status', 'prefs'])
      .where('username', '=', entry.username)
      .executeTakeFirst();
    if (!user || user.status !== 'active') {
      throw new HttpError(404, '演示账号还没准备好，稍后再试');
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

    // 演示登录也进审计：演示站是给别人看的，但它跑的是真的审计代码，
    // 有人点开日志页就能看到这一条，比预先编造的假日志可信
    await writeAudit(db, {
      actor: { id: user.id, name: user.display_name, role: user.role },
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.display_name,
      detail: { demo: true },
      ip: request.ip,
    });

    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    };
  });
}
