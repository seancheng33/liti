import { describe, it, expect } from 'vitest';
import { requireRole, type AuthUser } from '../../src/rbac.js';
import { HttpError } from '../../src/http-error.js';

const student: AuthUser = {
  userId: 1,
  username: 's',
  displayName: 'S',
  role: 'student',
  status: 'active',
};

function statusOf(fn: () => unknown): number {
  try {
    fn();
    return 200;
  } catch (e) {
    return (e as HttpError).statusCode;
  }
}

describe('requireRole 角色校验', () => {
  it('匹配角色时不抛错', () => {
    expect(requireRole(student, 'student')).toBe(student);
    expect(requireRole(student)).toBe(student);
  });

  it('角色不匹配时抛 403', () => {
    expect(statusOf(() => requireRole(student, 'admin'))).toBe(403);
  });

  it('停用账号抛 403', () => {
    const disabled = { ...student, status: 'disabled' as const };
    expect(statusOf(() => requireRole(disabled, 'student'))).toBe(403);
  });
});
