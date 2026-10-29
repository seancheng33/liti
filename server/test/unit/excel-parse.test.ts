import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseQuestionRows, mapQuestionType, mapDifficulty } from '../../src/excel/import.js';

async function buildXlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const header = ['题型', '题干', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '正确答案', '解析', '分类', '难度', '标签'];

describe('mapQuestionType 题型映射', () => {
  it('映射单选', () => {
    expect(mapQuestionType('单选')).toBe('single');
    expect(mapQuestionType('单选题')).toBe('single');
    expect(mapQuestionType('single')).toBe('single');
    expect(mapQuestionType('1')).toBe('single');
  });
  it('映射多选', () => {
    expect(mapQuestionType('多选')).toBe('multiple');
    expect(mapQuestionType('多选题')).toBe('multiple');
  });
  it('非法返回 null', () => {
    expect(mapQuestionType('判断')).toBeNull();
  });
});

describe('mapDifficulty 难度映射', () => {
  it('映射易中难', () => {
    expect(mapDifficulty('易')).toBe(1);
    expect(mapDifficulty('中')).toBe(2);
    expect(mapDifficulty('难')).toBe(3);
    expect(mapDifficulty('2')).toBe(2);
    expect(mapDifficulty('')).toBeNull();
  });
});

describe('parseQuestionRows Excel 解析', () => {
  it('解析合法单选行', async () => {
    const buf = await buildXlsx([
      header,
      ['单选', '1+1=?', '1', '2', '3', '4', '', '', 'B', '等于2', '', '易', '数学'],
    ]);
    const rows = await parseQuestionRows(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].draft?.type).toBe('single');
    expect(rows[0].draft?.options[1].isCorrect).toBe(true);
    expect(rows[0].draft?.difficulty).toBe(1);
    expect(rows[0].draft?.tags).toEqual(['数学']);
  });

  it('解析合法多选行', async () => {
    const buf = await buildXlsx([
      header,
      ['多选', '哪些是偶数?', '1', '2', '3', '4', '', '', 'BD', '', '', '中', ''],
    ]);
    const rows = await parseQuestionRows(buf);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].draft?.type).toBe('multiple');
    const correct = rows[0].draft!.options.filter((o) => o.isCorrect).map((o) => o.content);
    expect(correct).toEqual(['2', '4']);
  });

  it('单选两个答案报错', async () => {
    const buf = await buildXlsx([
      header,
      ['单选', 'q', 'a', 'b', 'c', 'd', '', '', 'AB', '', '', '', ''],
    ]);
    const rows = await parseQuestionRows(buf);
    expect(rows[0].errors.join()).toContain('仅有一个');
  });

  it('题型非法报错', async () => {
    const buf = await buildXlsx([
      header,
      ['判断', 'q', 'a', 'b', '', '', '', '', 'A', '', '', '', ''],
    ]);
    const rows = await parseQuestionRows(buf);
    expect(rows[0].errors.join()).toContain('题型无效');
  });

  it('空行被跳过', async () => {
    const buf = await buildXlsx([
      header,
      ['单选', 'q', 'a', 'b', '', '', '', '', 'A', '', '', '', ''],
      new Array(13).fill(''),
      new Array(13).fill(''),
    ]);
    const rows = await parseQuestionRows(buf);
    expect(rows).toHaveLength(1);
  });
});
