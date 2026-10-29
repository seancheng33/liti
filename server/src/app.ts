import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { authRoutes } from './auth/routes.js';
import { userRoutes } from './users/routes.js';
import { HttpError } from './http-error.js';
import { SESSION_COOKIE_NAME, deleteExpiredSessions, getSessionByToken } from './auth/session.js';

export interface AppContext {
  app: FastifyInstance;
  db: Db;
  config: Config;
}

export async function buildApp(db: Db, config: Config): Promise<AppContext> {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: '请求参数错误', details: error.issues });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error(error);
    console.error('[unhandled-error]', error);
    return reply.code(500).send({ error: '服务器内部错误' });
  });

  await app.register(fastifyCookie);
  app.decorateRequest('authUser', null);

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

  app.get('/health', async () => ({ ok: true, time: Date.now() }));

  app.addHook('onClose', async () => {
    await db.destroy();
  });

  return { app, db, config };
}
