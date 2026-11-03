import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext, seedUser } from '../helpers.js';
import { createQuestion } from '../../src/question/service.js';
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

  for (let i = 1; i <= 3; i++) {
    await createQuestion(ctx.db, {
      type: 'single',
      stem: `统计题${i}`,
      difficulty: i,
      options: [
        { content: 'A', isCorrect: false },
        { content: 'B', isCorrect: true },
      ],
    }, null);
  }
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

describe('统计报表', () => {
  it('教师可查看统计概览', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/stats/overview', headers: { cookie: teacherCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.questionCount).toBeGreaterThanOrEqual(3);
    expect(body.questionByType.single).toBeGreaterThanOrEqual(3);
    expect(typeof body.correctRate).toBe('number');
  });

  it('学生查看统计返回 403', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/stats/overview', headers: { cookie: studentCookie } });
    expect(res.statusCode).toBe(403);
  });
});
