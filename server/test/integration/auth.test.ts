import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext, seedUser } from '../helpers.js';
import type { AppContext } from '../../src/app.js';

let ctx: AppContext;

beforeAll(async () => {
  ctx = await createTestContext();
  await seedUser(ctx.db, { username: 'alice', displayName: 'Alice', password: 'pw123456', role: 'student' });
  await seedUser(ctx.db, { username: 'root', displayName: 'Root', password: 'root123456', role: 'admin' });
});

afterAll(async () => {
  await ctx.app.close();
});

function login(username: string, password: string) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
}

function cookieOf(res: any): string {
  const sc = res.headers['set-cookie'];
  const cookie = Array.isArray(sc) ? sc[0] : sc;
  return (cookie ?? '').split(';')[0];
}

describe('认证流程', () => {
  it('未登录访问 /me 返回 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('正确密码登录成功并设置会话 Cookie', async () => {
    const res = await login('alice', 'pw123456');
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe('alice');
    expect(res.json().role).toBe('student');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('错误密码返回 401', async () => {
    const res = await login('alice', 'wrong-password');
    expect(res.statusCode).toBe(401);
  });

  it('不存在的用户返回 401', async () => {
    const res = await login('nobody', 'whatever');
    expect(res.statusCode).toBe(401);
  });

  it('携带会话 Cookie 可访问 /me', async () => {
    const loginRes = await login('alice', 'pw123456');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieOf(loginRes) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe('alice');
  });

  it('登出后会话失效', async () => {
    const loginRes = await login('alice', 'pw123456');
    const cookie = cookieOf(loginRes);
    const logoutRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logoutRes.statusCode).toBe(200);

    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(meRes.statusCode).toBe(401);
  });
});

describe('RBAC 权限', () => {
  it('学生访问 /api/users 返回 403', async () => {
    const loginRes = await login('alice', 'pw123456');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: cookieOf(loginRes) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('管理员访问 /api/users 返回用户列表', async () => {
    const loginRes = await login('root', 'root123456');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: cookieOf(loginRes) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
  });
});
