import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext, seedUser } from '../helpers.js';
import { createQuestion } from '../../src/question/service.js';
import type { AppContext } from '../../src/app.js';

let ctx: AppContext;
let teacherCookie: string;
let studentCookie: string;
let q1: number;
let q2: number;
let q3: number;
let paperId: number;

beforeAll(async () => {
  ctx = await createTestContext();
  await seedUser(ctx.db, { username: 'teacher', displayName: 'T', password: 'pw123456', role: 'teacher' });
  await seedUser(ctx.db, { username: 'student', displayName: 'S', password: 'pw123456', role: 'student' });
  teacherCookie = await login('teacher', 'pw123456');
  studentCookie = await login('student', 'pw123456');

  q1 = await createQuestion(ctx.db, { type: 'single', stem: 'Q1', options: [
    { content: 'A', isCorrect: false }, { content: 'B', isCorrect: true }, { content: 'C', isCorrect: false },
  ] }, null);
  q2 = await createQuestion(ctx.db, { type: 'single', stem: 'Q2', options: [
    { content: 'A', isCorrect: true }, { content: 'B', isCorrect: false },
  ] }, null);
  q3 = await createQuestion(ctx.db, { type: 'multiple', stem: 'Q3', options: [
    { content: 'A', isCorrect: true }, { content: 'B', isCorrect: true }, { content: 'C', isCorrect: false },
  ] }, null);

  const create = await ctx.app.inject({
    method: 'POST',
    url: '/api/papers',
    headers: { cookie: teacherCookie },
    payload: { title: '测试卷', mode: 'fixed', durationSec: 3600, questionIds: [q1, q2, q3] },
  });
  expect(create.statusCode).toBe(200);
  paperId = create.json().id;
  await ctx.app.inject({ method: 'POST', url: `/api/papers/${paperId}/publish`, headers: { cookie: teacherCookie } });
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

async function correctIds(qid: number): Promise<number[]> {
  const rows = await ctx.db.selectFrom('question_option').select('id').where('question_id', '=', qid).where('is_correct', '=', 1).execute();
  return rows.map((r) => r.id);
}

async function startAttempt(): Promise<number> {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/attempts', headers: { cookie: studentCookie }, payload: { paperId } });
  return res.json().id;
}

describe('答题流程', () => {
  it('学生可开始答卷并获取题目（不泄露答案）', async () => {
    const id = await startAttempt();
    const res = await ctx.app.inject({ method: 'GET', url: `/api/attempts/${id}`, headers: { cookie: studentCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('in_progress');
    expect(body.items).toHaveLength(3);
    // after_submit 模式下，答题中不泄露正确选项与解析
    for (const item of body.items) {
      expect(item.options.every((o: { isCorrect: boolean | null }) => o.isCorrect === null)).toBe(true);
      expect(item.explanation).toBeNull();
    }
  });

  it('作答并交卷后正确判分', async () => {
    const id = await startAttempt();
    const c1 = await correctIds(q1);
    const c2 = await correctIds(q2);
    const c3 = await correctIds(q3);

    // 答对全部
    await ctx.app.inject({ method: 'PATCH', url: `/api/attempts/${id}/answers`, headers: { cookie: studentCookie }, payload: { questionId: q1, selectedOptionIds: c1 } });
    await ctx.app.inject({ method: 'PATCH', url: `/api/attempts/${id}/answers`, headers: { cookie: studentCookie }, payload: { questionId: q2, selectedOptionIds: c2 } });
    await ctx.app.inject({ method: 'PATCH', url: `/api/attempts/${id}/answers`, headers: { cookie: studentCookie }, payload: { questionId: q3, selectedOptionIds: c3 } });

    const submit = await ctx.app.inject({ method: 'POST', url: `/api/attempts/${id}/submit`, headers: { cookie: studentCookie } });
    expect(submit.statusCode).toBe(200);

    const review = await ctx.app.inject({ method: 'GET', url: `/api/attempts/${id}`, headers: { cookie: studentCookie } });
    const body = review.json();
    expect(body.status).toBe('submitted');
    expect(body.score).toBe(3);
    expect(body.totalScore).toBe(3);
    expect(body.correctCount).toBe(3);
    // 交卷后解析可见
    for (const item of body.items) {
      expect(item.options.some((o: { isCorrect: boolean }) => o.isCorrect)).toBe(true);
    }
  });

  it('多选少选判错', async () => {
    const id = await startAttempt();
    const c3 = await correctIds(q3);
    // 只选一个正确项（多选需要全对）
    await ctx.app.inject({ method: 'PATCH', url: `/api/attempts/${id}/answers`, headers: { cookie: studentCookie }, payload: { questionId: q3, selectedOptionIds: [c3[0]] } });
    await ctx.app.inject({ method: 'POST', url: `/api/attempts/${id}/submit`, headers: { cookie: studentCookie } });

    const review = await ctx.app.inject({ method: 'GET', url: `/api/attempts/${id}`, headers: { cookie: studentCookie } });
    expect(review.json().correctCount).toBe(0);
  });

  it('切窗 3 次自动交卷', async () => {
    const id = await startAttempt();
    let autoSubmitted = false;
    for (let i = 0; i < 3; i++) {
      const res = await ctx.app.inject({ method: 'POST', url: `/api/attempts/${id}/violations`, headers: { cookie: studentCookie }, payload: { type: 'switch' } });
      autoSubmitted = res.json().autoSubmitted;
    }
    expect(autoSubmitted).toBe(true);

    const review = await ctx.app.inject({ method: 'GET', url: `/api/attempts/${id}`, headers: { cookie: studentCookie } });
    expect(review.json().status).toBe('submitted');
    expect(review.json().submitReason).toBe('violation');
  });

  it('超时后访问自动标记过期并判分', async () => {
    const id = await startAttempt();
    // 把 deadline 改为过去，模拟超时
    await ctx.db.updateTable('attempt').set({ deadline_at: Date.now() - 1000 }).where('id', '=', id).execute();

    const review = await ctx.app.inject({ method: 'GET', url: `/api/attempts/${id}`, headers: { cookie: studentCookie } });
    expect(review.json().status).toBe('expired');
    expect(review.json().submitReason).toBe('timeout');
  });

  it('他人答卷不可访问', async () => {
    const id = await startAttempt();
    const res = await ctx.app.inject({ method: 'GET', url: `/api/attempts/${id}`, headers: { cookie: teacherCookie } });
    expect(res.statusCode).toBe(403);
  });
});
