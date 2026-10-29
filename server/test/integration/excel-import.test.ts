import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestContext, seedUser } from '../helpers.js';
import type { AppContext } from '../../src/app.js';

let ctx: AppContext;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestContext();
  await seedUser(ctx.db, { username: 't1', displayName: 'T', password: 'pw123456', role: 'teacher' });
  cookie = await login();
  await ctx.db.insertInto('category').values({ name: '数学', parent_id: null, sort: 0, created_at: Date.now() }).execute();
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

async function buildXlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const header = ['题型', '题干', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '正确答案', '解析', '分类', '难度', '标签'];
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('Excel 导入', () => {
  it('模板下载返回 xlsx', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/questions/template', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.rawPayload.length).toBeGreaterThan(100);
  });

  it('预校验 dryRun 返回逐行结果', async () => {
    const buf = await buildXlsx([
      header,
      ['单选', '1+1=?', '1', '2', '3', '4', '', '', 'B', '', '数学', '易', ''],
      ['单选', '无效题', '1', '2', '', '', '', '', 'AB', '', '数学', '', ''],
    ]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/questions/import?dryRun=true',
      headers: { cookie, 'content-type': XLSX },
      payload: buf,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.success).toBe(1);
    expect(body.failed).toBe(1);
  });

  it('正式导入写入题目与批次记录', async () => {
    const buf = await buildXlsx([
      header,
      ['单选', '2+2=?', '2', '3', '4', '5', '', '', 'D', '', '数学', '中', ''],
      ['多选', '哪些是偶数?', '1', '2', '3', '4', '', '', 'BD', '', '数学', '中', ''],
    ]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/questions/import',
      headers: { cookie, 'content-type': XLSX },
      payload: buf,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(2);
    expect(body.failed).toBe(0);

    const batch = await ctx.db.selectFrom('import_batch').selectAll().orderBy('id', 'desc').executeTakeFirst();
    expect(batch).toBeTruthy();
    expect(batch!.success).toBe(2);
    expect(batch!.total).toBe(2);
  });

  it('重复题干被跳过', async () => {
    const buf = await buildXlsx([
      header,
      ['单选', '2+2=?', '2', '3', '4', '5', '', '', 'D', '', '数学', '中', ''],
    ]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/questions/import',
      headers: { cookie, 'content-type': XLSX },
      payload: buf,
    });
    const body = res.json();
    expect(body.skippedDuplicates).toBe(1);
    expect(body.success).toBe(0);
  });

  it('严格模式遇错误整体回滚', async () => {
    const buf = await buildXlsx([
      header,
      ['单选', '新题A', '1', '2', '', '', '', '', 'A', '', '数学', '', ''],
      ['单选', '坏题', '1', '2', '', '', '', '', 'AB', '', '数学', '', ''],
    ]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/questions/import?mode=strict',
      headers: { cookie, 'content-type': XLSX },
      payload: buf,
    });
    const body = res.json();
    expect(body.success).toBe(0);

    const q = await ctx.db.selectFrom('question').select('id').where('stem', '=', '新题A').executeTakeFirst();
    expect(q).toBeUndefined();
  });

  it('分类不存在时报错', async () => {
    const buf = await buildXlsx([
      header,
      ['单选', '分类题', '1', '2', '', '', '', '', 'A', '', '不存在的分类', '', ''],
    ]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/questions/import?dryRun=true',
      headers: { cookie, 'content-type': XLSX },
      payload: buf,
    });
    const body = res.json();
    expect(body.failed).toBe(1);
    expect(body.rows[0].errors.join()).toContain('分类不存在');
  });
});
