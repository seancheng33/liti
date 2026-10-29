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
  return request.authUser;
}
