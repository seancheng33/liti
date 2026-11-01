import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../rbac.js';
import { HttpError } from '../http-error.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null;
  }
}

export function authenticate(request: FastifyRequest): AuthUser {
  if (!request.authUser) {
    throw new HttpError(401, '未登录');
  }
  // 停用账号必须立刻失效：会话是每次请求实时查库的，status 变了这里就能拦住。
  // 不能只靠 requireRole —— 学生常用的答题、错题本、成绩这些路由只走 authenticate，
  // 漏在这里就等于「老师停用了，学生照常考试」。
  if (request.authUser.status !== 'active') {
    throw new HttpError(403, '账号已停用');
  }
  return request.authUser;
}
