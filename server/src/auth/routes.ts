import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { Config } from '../config.js';
import { verifyPassword } from './password.js';
import { createSession, deleteSession, SESSION_COOKIE_NAME } from './session.js';
import { HttpError } from '../http-error.js';
import { authenticate } from '../plugins/auth.js';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
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
    return authenticate(request);
  });
}
