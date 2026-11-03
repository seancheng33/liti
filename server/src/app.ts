import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { authRoutes } from './auth/routes.js';
import { userRoutes } from './users/routes.js';
import { categoryRoutes } from './category/routes.js';
import { questionRoutes } from './question/routes.js';
import { paperRoutes } from './paper/routes.js';
import { attemptRoutes } from './attempt/routes.js';
import { wrongRoutes } from './wrong/routes.js';
import { groupRoutes } from './group/routes.js';
import { statsRoutes } from './stats/routes.js';
import { settingRoutes } from './settings/routes.js';
import { publicRoutes } from './public/routes.js';
import { demoRoutes } from './demo/routes.js';
import { uploadRoutes } from './upload/routes.js';
import { auditRoutes } from './audit/routes.js';
import { HttpError } from './http-error.js';
import { resolveUploadDir } from './media.js';
import { webDistPath } from './paths.js';
import { SESSION_COOKIE_NAME, deleteExpiredSessions, getSessionByToken } from './auth/session.js';
import { parsePrefs } from './user-prefs.js';

export interface AppContext {
  app: FastifyInstance;
  db: Db;
  config: Config;
}

export async function buildApp(db: Db, config: Config): Promise<AppContext> {
  const app = Fastify({ logger: config.NODE_ENV !== 'test', trustProxy: config.TRUST_PROXY });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: '请求参数错误', details: error.issues });
    }
    if (error instanceof HttpError) {
      return reply
        .code(error.statusCode)
        .send({ error: error.message, ...(error.details !== undefined ? { details: error.details } : {}) });
    }
    // fastify-static / @fastify/send 抛的是带 statusCode 的 HTTP 错误（例如路径穿越的 403），
    // 不接住就会被兜成 500，既误导排错又把错误日志刷满
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const msg = status === 404 ? 'Not Found' : status === 403 ? 'Forbidden' : '请求无效';
      return reply.code(status).send({ error: msg });
    }
    request.log.error(error);
    console.error('[unhandled-error]', error);
    return reply.code(500).send({ error: '服务器内部错误' });
  });

  // xlsx 二进制体解析
  app.addContentTypeParser(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  await app.register(fastifyCookie);
  app.decorateRequest('authUser', null);

  // 基础安全响应头（不引 helmet，几个头手写更可控）
  // - nosniff：防止浏览器把上传的图片按 HTML/JS 猜类型执行
  // - X-Frame-Options：防点击劫持（考试页面被套进 iframe 里钓鱼）
  // - Referrer-Policy：跨站跳转时不把带 token 的 URL 漏出去
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    return payload;
  });

  // 会话解析（根级钩子，作用于所有路由）
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (!token) return;

    const row = await getSessionByToken(db, token);
    if (!row || row.expiresAt <= Date.now()) return;

    request.authUser = {
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
      status: row.status,
      theme: parsePrefs(row.prefs).theme,
    };
  });

  // 低频清理过期会话，避免每次请求全表扫描
  app.addHook('onRequest', async () => {
    if (Math.random() < 0.01) {
      await deleteExpiredSessions(db).catch(() => {});
    }
  });

  await app.register(authRoutes, { db, config, prefix: '/api/auth' });
  await app.register(userRoutes, { db, prefix: '/api/users' });
  await app.register(categoryRoutes, { db, prefix: '/api/categories' });
  await app.register(questionRoutes, { db, prefix: '/api/questions' });
  await app.register(paperRoutes, { db, prefix: '/api/papers' });
  await app.register(attemptRoutes, { db, prefix: '/api/attempts' });
  await app.register(wrongRoutes, { db, prefix: '/api/wrong-questions' });
  await app.register(groupRoutes, { db, prefix: '/api/groups' });
  await app.register(statsRoutes, { db, prefix: '/api/stats' });
  await app.register(settingRoutes, { db, prefix: '/api/settings' });
  await app.register(publicRoutes, { db, prefix: '/api/public' });
  // 演示站的一键登录。注册这一步就卡在开关上：DEMO_MODE 关着的时候
  // /api/demo/* 根本不存在，请求直接 404，不存在「handler 里忘了判断」的余地
  if (config.DEMO_MODE) {
    await app.register(demoRoutes, { db, config, prefix: '/api/demo' });
  }
  await app.register(auditRoutes, { db, prefix: '/api/audit' });
  await app.register(uploadRoutes, { config, prefix: '/api/uploads' });

  // 题目配图等上传文件（和 SPA 静态资源共用 fastify-static，第二次注册不再装饰 reply）
  const uploadRoot = resolveUploadDir(config.UPLOAD_DIR);
  await app.register(fastifyStatic, {
    root: uploadRoot,
    prefix: '/uploads/',
    decorateReply: false,
    maxAge: '7d',
  });

  // 生产模式托管前端静态资源（SPA 回退到 index.html）
  if (existsSync(webDistPath)) {
    await app.register(fastifyStatic, { root: webDistPath, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/uploads/')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // 健康检查：根路径给容器/反代用，/api/health 给运维脚本用（文档里两种都出现过，统一都通）
  const healthHandler = async () => ({ ok: true, time: Date.now() });
  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  app.addHook('onClose', async () => {
    await db.destroy();
  });

  return { app, db, config };
}
