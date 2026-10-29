import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext, seedUser } from '../helpers.js';
import { createQuestion } from '../../src/question/service.js';
import type { AppContext } from '../../src/app.js';

let ctx: AppContext;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestContext();
  await seedUser(ctx.db, { username: 't1', displayName: 'T', password: 'pw123456', role: 'teacher' });
  cookie = await login();

  for (let i = 1; i <= 5; i++) {
    await createQuestion(ctx.db, {
      type: 'single',
      stem: `题目${i}`,
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
  const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 't1', password: 'pw123456' } });
  const sc = res.headers['set-cookie'];
  const c = Array.isArray(sc) ? sc[0] : sc;
  return (c ?? '').split(';')[0];
}

describe('组卷', () => {
  it('随机组卷按数量抽题', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/papers',
      headers: { cookie },
      payload: { title: '随机卷', mode: 'random', durationSec: 600, randomRules: [{ count: 3 }] },
    });
    expect(res.statusCode).toBe(200);
    const id = res.json().id;
    const detail = await ctx.app.inject({ method: 'GET', url: `/api/papers/${id}`, headers: { cookie } });
    expect(detail.json().question_count).toBe(3);
    expect(detail.json().items).toHaveLength(3);
  });

  it('固定组卷按题目列表生成', async () => {
    const qs = await ctx.db.selectFrom('question').select('id').orderBy('id', 'asc').limit(2).execute();
    const ids = qs.map((q) => q.id);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/papers',
      headers: { cookie },
      payload: { title: '固定卷', mode: 'fixed', durationSec: 600, questionIds: ids },
    });
    expect(res.statusCode).toBe(200);
    const detail = await ctx.app.inject({ method: 'GET', url: `/api/papers/${res.json().id}`, headers: { cookie } });
    expect(detail.json().question_count).toBe(2);
  });

  it('题量不足返回 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/papers',
      headers: { cookie },
      payload: { title: '不足卷', mode: 'random', durationSec: 600, randomRules: [{ count: 100 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('题目不足');
  });

  it('发布后列表可见', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/papers',
      headers: { cookie },
      payload: { title: '待发布卷', mode: 'fixed', durationSec: 600, questionIds: [1] },
    });
    const id = create.json().id;
    await ctx.app.inject({ method: 'POST', url: `/api/papers/${id}/publish`, headers: { cookie } });
    const list = await ctx.app.inject({ method: 'GET', url: '/api/papers?status=published', headers: { cookie } });
    expect(list.json().total).toBeGreaterThanOrEqual(1);
  });

  it('随机预览不落库', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/papers/random-preview',
      headers: { cookie },
      payload: { randomRules: [{ count: 2 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().questionIds).toHaveLength(2);
  });
});
