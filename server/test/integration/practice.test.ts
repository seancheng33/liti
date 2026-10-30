import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext, seedUser } from '../helpers.js';
import { createQuestion } from '../../src/question/service.js';
import type { AppContext } from '../../src/app.js';

let ctx: AppContext;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestContext();
  await seedUser(ctx.db, { username: 's1', displayName: 'Student', password: 'pw123456', role: 'student' });
  cookie = await login();
  for (let i = 1; i <= 5; i++) {
    await createQuestion(ctx.db, {
      type: 'single',
      stem: `练习题${i}`,
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

async function login(): Promise<string> {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 's1', password: 'pw123456' } });
  const sc = res.headers['set-cookie'];
  const c = Array.isArray(sc) ? sc[0] : sc;
  return (c ?? '').split(';')[0];
}

describe('学生自助练习', () => {
  it('创建练习答卷并即时显示解析', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/attempts/practice',
      headers: { cookie },
      payload: { rules: [{ count: 3 }] },
    });
    expect(res.statusCode).toBe(200);
    const attemptId = res.json().id;
    expect(attemptId).toBeGreaterThan(0);

    // 练习卷不进入试卷列表
    const list = await ctx.app.inject({ method: 'GET', url: '/api/papers', headers: { cookie } });
    expect(list.json().total).toBe(0);

    // 练习模式（immediate）答题中即显示正确项
    const review = await ctx.app.inject({ method: 'GET', url: `/api/attempts/${attemptId}`, headers: { cookie } });
    const rb = review.json();
    expect(rb.reviewMode).toBe('immediate');
    expect(rb.items).toHaveLength(3);
    for (const item of rb.items) {
      expect(item.options.every((o: { isCorrect: boolean | null }) => o.isCorrect !== null)).toBe(true);
    }
  });

  it('题量越界返回 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/attempts/practice',
      headers: { cookie },
      payload: { rules: [{ count: 101 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('题库不足返回 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/attempts/practice',
      headers: { cookie },
      payload: { rules: [{ count: 100 }] },
    });
    expect(res.statusCode).toBe(400);
  });
});
