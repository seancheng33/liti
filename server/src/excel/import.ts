import ExcelJS from 'exceljs';
import type { Db } from '../db/index.js';
import { createQuestion } from '../question/service.js';
import {
  contentHash,
  normalizeLoose,
  validateQuestionDraft,
  type QuestionDraft,
  type QuestionOptionInput,
  type QuestionType,
} from '../question/validate.js';

export function mapQuestionType(v: string): QuestionType | null {
  const s = (v ?? '').trim().toLowerCase();
  if (['单选', '单选题', 'single', '1'].includes(s)) return 'single';
  if (['多选', '多选题', 'multiple', '2'].includes(s)) return 'multiple';
  return null;
}

function cellText(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') {
    const obj = v as { text?: unknown; richText?: { text: string }[] };
    if (obj.text != null) return String(obj.text).trim();
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join('').trim();
    return '';
  }
  return String(v).trim();
}

export interface ParsedRow {
  row: number;
  draft: QuestionDraft | null;
  categoryName: string;
  errors: string[];
}

export async function parseQuestionRows(buffer: Buffer): Promise<ParsedRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];

  const out: ParsedRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const typeRaw = cellText(row, 1);
    const stem = cellText(row, 2);
    if (!typeRaw && !stem && !cellText(row, 3) && !cellText(row, 9)) return;

    const type = mapQuestionType(typeRaw);
    const rawOptions = [3, 4, 5, 6, 7, 8].map((c) => cellText(row, c));
    const options = rawOptions.filter((o) => o !== '');
    const answerRaw = cellText(row, 9).toUpperCase().replace(/[^A-F]/g, '');

    const optionInputs: QuestionOptionInput[] = options.map((content, i) => ({
      content,
      isCorrect: answerRaw.includes(String.fromCharCode(65 + i)),
    }));

    const tagsRaw = cellText(row, 12);
    const tags = tagsRaw ? tagsRaw.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [];

    const draft: QuestionDraft = {
      type: type ?? 'single',
      stem,
      explanation: cellText(row, 10) || undefined,
      tags,
      options: optionInputs,
    };

    const errors: string[] = [];
    if (!type) errors.push('题型无效（应填写 单选/多选）');
    if (!answerRaw) errors.push('正确答案不能为空');
    // 分类列现在允许写新名字（导入时自动建），但 category.name 是 varchar(128)，超长会在入库时报错，提前拦下
    if (cellText(row, 11).length > 128) errors.push('分类名过长（最多 128 字）');
    errors.push(...validateQuestionDraft(draft));

    out.push({
      row: rowNumber,
      draft: errors.length ? null : draft,
      categoryName: cellText(row, 11),
      errors,
    });
  });

  return out;
}

export interface ImportOptions {
  dryRun: boolean;
  /** skip=跳过重复继续导入；strict=有任何问题整批不导入；allow=重复也照常导入 */
  mode: 'skip' | 'strict' | 'allow';
  filename: string;
  userId: number | null;
}

export interface ImportRowResult {
  row: number;
  ok: boolean;
  errors: string[];
  /** 判定为重复时，题库里已有题目的 ID */
  duplicateOf?: number;
}

export interface ImportSummary {
  total: number;
  success: number;
  failed: number;
  skippedDuplicates: number;
  /** 本次导入自动新建的分类名（dryRun 时是「将会新建」的名单） */
  createdCategories: string[];
  rows: ImportRowResult[];
}

export async function importQuestions(
  db: Db,
  parsed: ParsedRow[],
  opts: ImportOptions,
): Promise<ImportSummary> {
  const categories = await db.selectFrom('category').selectAll().execute();
  const categoryMap = new Map(categories.map((c) => [c.name, c.id]));

  // 一次性把题库里的题干读出来，建立「精确哈希 → id」「宽松键 → id」两张表
  const existingRows = await db.selectFrom('question').select(['id', 'stem']).execute();
  const byHash = new Map<string, number>();
  const byLoose = new Map<string, number>();
  for (const r of existingRows) {
    byHash.set(contentHash(r.stem), r.id);
    const k = normalizeLoose(r.stem);
    if (k) byLoose.set(k, r.id);
  }

  const rows: ImportRowResult[] = [];
  const toImport: { draft: QuestionDraft; categoryName: string }[] = [];
  /** 有效行里出现的不存在的分类名：正式导入时批量新建，dryRun 时只报告 */
  const missingCategories = new Set<string>();
  let invalid = 0;
  let skipped = 0;

  for (const p of parsed) {
    if (p.errors.length) {
      invalid++;
      rows.push({ row: p.row, ok: false, errors: p.errors });
      continue;
    }

    const draft = p.draft!;

    // 分类不存在不再拦行：记下来，循环结束后统一新建（v1.1.0 起的行为）
    if (p.categoryName && !categoryMap.has(p.categoryName)) {
      missingCategories.add(p.categoryName);
    }

    const hash = contentHash(draft.stem);
    const loose = normalizeLoose(draft.stem);
    const dupId = byHash.get(hash) ?? (loose ? byLoose.get(loose) : undefined);

    if (dupId != null && opts.mode !== 'allow') {
      skipped++;
      rows.push({ row: p.row, ok: false, duplicateOf: dupId, errors: [`与题库已有题目重复（ID ${dupId}）`] });
      continue;
    }

    // 同一批内部的重复也记下来，避免同表重复导入
    byHash.set(hash, dupId ?? -1);
    if (loose) byLoose.set(loose, dupId ?? -1);

    toImport.push({ draft, categoryName: p.categoryName });
    rows.push({ row: p.row, ok: true, errors: [] });
  }

  const hasProblems = invalid > 0 || skipped > 0;
  if (opts.mode === 'strict' && hasProblems) {
    return {
      total: parsed.length,
      success: 0,
      failed: invalid + skipped,
      skippedDuplicates: skipped,
      createdCategories: [],
      rows,
    };
  }

  // strict 被拦截时不建分类；dryRun 不动库，只把「将会新建」的名单报出去
  const createdCategories: string[] = [];
  if (opts.dryRun) {
    createdCategories.push(...missingCategories);
  } else if (missingCategories.size > 0) {
    const now = Date.now();
    for (const name of missingCategories) {
      const res = await db
        .insertInto('category')
        .values({ name, parent_id: null, sort: 0, created_at: now })
        .executeTakeFirstOrThrow();
      categoryMap.set(name, Number(res.insertId));
      createdCategories.push(name);
    }
  }

  if (!opts.dryRun) {
    for (const item of toImport) {
      // 查重已经在本函数内统一处理过（含 allow 模式），这里不再逐条重查；
      // 分类映射放在建分类之后，缺失的分类此时已经有 id 了
      const categoryId = item.categoryName ? (categoryMap.get(item.categoryName) ?? null) : null;
      await createQuestion(db, { ...item.draft, categoryId }, opts.userId, { allowDuplicate: true });
    }
    const now = Date.now();
    await db
      .insertInto('import_batch')
      .values({
        filename: opts.filename,
        total: parsed.length,
        success: toImport.length,
        failed: invalid + skipped,
        errors: JSON.stringify(rows.filter((r) => !r.ok)),
        created_by: opts.userId,
        created_at: now,
      })
      .execute();
  }

  return {
    total: parsed.length,
    success: toImport.length,
    failed: invalid + skipped,
    skippedDuplicates: skipped,
    createdCategories,
    rows,
  };
}
