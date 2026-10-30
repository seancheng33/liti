import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext, seedUser } from '../helpers.js';
import type { AppContext } from '../../src/app.js';

let ctx: AppContext;
let teacherCookie: string;
let studentCookie: string;

beforeAll(async () => {
  ctx = await createTestContext();
  await seedUser(ctx.db, { username: 't1', displayName: 'T', password: 'pw123456', role: 'teacher' });
  await seedUser(ctx.db, { username: 's1', displayName: 'S', password: 'pw123456', role: 'student' });
  teacherCookie = await login('t1', 'pw123456');
  studentCookie = await login('s1', 'pw123456');
});

afterAll(async () => {
  await ctx.app.close();
});

async function login(username: string, password: string): Promise<string> {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  const sc = res.headers['set-cookie'];
  const c = Array.isArray(sc) ? sc[0] : sc;
  return (c ?? '').split(';')[0];
}

describe('成绩导出', () => {
  it('教师可导出 xlsx', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/attempts/export', headers: { cookie: teacherCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.rawPayload.length).toBeGreaterThan(100);
  });

  it('学生导出返回 403', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/attempts/export', headers: { cookie: studentCookie } });
    expect(res.statusCode).toBe(403);
  });

  it('未登录导出返回 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/attempts/export' });
    expect(res.statusCode).toBe(401);
  });
});
