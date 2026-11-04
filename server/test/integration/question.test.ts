import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext, seedUser } from '../helpers.js';
import type { AppContext } from '../../src/app.js';

let ctx: AppContext;

beforeAll(async () => {
  ctx = await createTestContext();
  await seedUser(ctx.db, { username: 't1', displayName: 'Teacher', password: 'pw123456', role: 'teacher' });
  await seedUser(ctx.db, { username: 's1', displayName: 'Student', password: 'pw123456', role: 'student' });
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

const singleQ = {
  type: 'single',
  stem: '1+1=?',
  explanation: '等于2',
  difficulty: 1,
  tags: ['数学'],
  options: [
    { content: '1', isCorrect: false },
    { content: '2', isCorrect: true },
    { content: '3', isCorrect: false },
    { content: '4', isCorrect: false },
  ],
};

describe('题库 CRUD', () => {
  it('教师可创建题目', async () => {
    const cookie = await login('t1', 'pw123456');
    const res = await ctx.app.inject({ method: 'POST', url: '/api/questions', headers: { cookie }, payload: singleQ });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBeGreaterThan(0);
  });

  it('学生创建题目返回 403', async () => {
    const cookie = await login('s1', 'pw123456');
    const res = await ctx.app.inject({ method: 'POST', url: '/api/questions', headers: { cookie }, payload: singleQ });
    expect(res.statusCode).toBe(403);
  });

  it('题目详情包含选项与标签', async () => {
    const cookie = await login('t1', 'pw123456');
    const create = await ctx.app.inject({ method: 'POST', url: '/api/questions', headers: { cookie }, payload: { ...singleQ, allowDuplicate: true } });
    const id = create.json().id;

    const res = await ctx.app.inject({ method: 'GET', url: `/api/questions/${id}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.options).toHaveLength(4);
    expect(body.options.filter((o: { isCorrect: boolean }) => o.isCorrect)).toHaveLength(1);
    expect(body.tags).toEqual(['数学']);
  });

  it('列表返回总数', async () => {
    const cookie = await login('t1', 'pw123456');
    const res = await ctx.app.inject({ method: 'GET', url: '/api/questions', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('无效题目返回 400', async () => {
    const cookie = await login('t1', 'pw123456');
    const bad = { ...singleQ, options: [{ content: 'A', isCorrect: true }, { content: 'B', isCorrect: true }] };
    const res = await ctx.app.inject({ method: 'POST', url: '/api/questions', headers: { cookie }, payload: bad });
    expect(res.statusCode).toBe(400);
  });

  it('教师可更新题目', async () => {
    const cookie = await login('t1', 'pw123456');
    const create = await ctx.app.inject({ method: 'POST', url: '/api/questions', headers: { cookie }, payload: { ...singleQ, allowDuplicate: true } });
    const id = create.json().id;

    const updated = { ...singleQ, stem: '更新后的题干', options: [
      { content: 'x', isCorrect: false },
      { content: 'y', isCorrect: true },
    ]};
    const res = await ctx.app.inject({ method: 'PUT', url: `/api/questions/${id}`, headers: { cookie }, payload: updated });
    expect(res.statusCode).toBe(200);

    const detail = await ctx.app.inject({ method: 'GET', url: `/api/questions/${id}`, headers: { cookie } });
    expect(detail.json().stem).toBe('更新后的题干');
    expect(detail.json().options).toHaveLength(2);
  });

  it('教师可删除题目', async () => {
    const cookie = await login('t1', 'pw123456');
    const create = await ctx.app.inject({ method: 'POST', url: '/api/questions', headers: { cookie }, payload: { ...singleQ, allowDuplicate: true } });
    const id = create.json().id;

    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/questions/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);

    const detail = await ctx.app.inject({ method: 'GET', url: `/api/questions/${id}`, headers: { cookie } });
    // 软删除 = status 置 archived：列表与组卷集合里不再出现，但详情仍可追溯
    //（旧卷里引用的题要能点开看，否则历史成绩没法复盘）
    expect(detail.statusCode).toBe(200);
  });
});

describe('编辑题目不影响已交卷的选项快照', () => {
  it('只改解析时，选项 id 与内容保持不变（历史答卷按旧 id 取内容）', async () => {
    const cookie = await login('t1', 'pw123456');
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/questions',
      headers: { cookie },
      payload: { ...singleQ, allowDuplicate: true },
    });
    const id = create.json().id;

    const before = await ctx.app.inject({ method: 'GET', url: `/api/questions/${id}`, headers: { cookie } });
    const optsBefore = before.json().options;

    // 教师只改解析，选项原样带回（编辑表单就是这么做全量提交的）
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/questions/${id}`,
      headers: { cookie },
      payload: { ...singleQ, explanation: '修正后的解析', allowDuplicate: true },
    });
    expect(res.statusCode).toBe(200);

    const after = await ctx.app.inject({ method: 'GET', url: `/api/questions/${id}`, headers: { cookie } });
    const optsAfter = after.json().options;

    expect(after.json().explanation).toBe('修正后的解析');
    expect(optsAfter).toHaveLength(optsBefore.length);
    // 关键断言：id 不变——交卷快照 attempt_item.option_order/selected 存的是这些 id，
    // 重建选项会让旧 id 全部失配，历史解析页选项变空白
    expect(optsAfter.map((o: { id: number }) => o.id)).toEqual(optsBefore.map((o: { id: number }) => o.id));
    expect(optsAfter.map((o: { content: string }) => o.content)).toEqual(optsBefore.map((o: { content: string }) => o.content));
    expect(optsAfter.map((o: { isCorrect: boolean }) => o.isCorrect)).toEqual(optsBefore.map((o: { isCorrect: boolean }) => o.isCorrect));
  });

  it('增删选项时，保留的选项 id 不变，新增的在尾部，减少的从尾部删', async () => {
    const cookie = await login('t1', 'pw123456');
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/questions',
      headers: { cookie },
      payload: { ...singleQ, allowDuplicate: true },
    });
    const id = create.json().id;
    const before = await ctx.app.inject({ method: 'GET', url: `/api/questions/${id}`, headers: { cookie } });
    const idsBefore = before.json().options.map((o: { id: number }) => o.id);

    // 4 个选项加到 5 个：原 4 个 id 保留，新增第 5 个
    const five = await ctx.app.inject({
      method: 'PUT',
      url: `/api/questions/${id}`,
      headers: { cookie },
      payload: {
        ...singleQ,
        options: [...singleQ.options, { content: '5', isCorrect: false }],
        allowDuplicate: true,
      },
    });
    expect(five.statusCode).toBe(200);
    let detail = await ctx.app.inject({ method: 'GET', url: `/api/questions/${id}`, headers: { cookie } });
    let opts = detail.json().options;
    expect(opts).toHaveLength(5);
    expect(opts.slice(0, 4).map((o: { id: number }) => o.id)).toEqual(idsBefore);
    expect(opts[4].content).toBe('5');

    // 5 个减到 2 个：前 2 个 id 保留，其余删除
    const two = await ctx.app.inject({
      method: 'PUT',
      url: `/api/questions/${id}`,
      headers: { cookie },
      payload: {
        ...singleQ,
        options: [
          { content: '1', isCorrect: false },
          { content: '2', isCorrect: true },
        ],
        allowDuplicate: true,
      },
    });
    expect(two.statusCode).toBe(200);
    detail = await ctx.app.inject({ method: 'GET', url: `/api/questions/${id}`, headers: { cookie } });
    opts = detail.json().options;
    expect(opts).toHaveLength(2);
    expect(opts.map((o: { id: number }) => o.id)).toEqual(idsBefore.slice(0, 2));
  });
});
