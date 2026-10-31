import type { Role } from './db/types.js';
import { HttpError } from './http-error.js';

export interface AuthUser {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  status: string;
  theme?: string;
}

export function requireRole(user: AuthUser, ...roles: Role[]): AuthUser {
  if (user.status !== 'active') {
    throw new HttpError(403, '账号已停用');
  }
  if (roles.length > 0 && !roles.includes(user.role)) {
    throw new HttpError(403, '无权限执行此操作');
  }
  return user;
}
