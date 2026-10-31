import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { parseImageList, serializeImageList } from '../media.js';
import { contentHash, normalizeDraftImages, normalizeLoose, validateQuestionDraft, type QuestionDraft } from './validate.js';

type AnyDb = Kysely<Database> | Transaction<Database>;

export interface DuplicateHit {
  id: number;
  stem: string;
  type: string;
  /** exact = 题干完全一致；similar = 忽略空格标点后一致 */
  match: 'exact' | 'similar';
}

/**
 * 查重：先按 content_hash 精确命中；未命中再用宽松归一化比对一次，
 * 把「同一题换了标点/空格」也算重复。
 * 题干为空（纯图片题）时不做查重，否则所有图片题都会撞同一个哈希。
 * 已删除（archived）的题目不参与查重 —— 删掉之后想重建同题不该被拦。
 */
export async function findDuplicate(db: Db, stem: string, excludeId?: number): Promise<DuplicateHit | null> {
  if (!stem || !stem.trim()) return null;

  const hash = contentHash(stem);
  let exactQuery = db
    .selectFrom('question')
    .select(['id', 'stem', 'type'])
    .where('content_hash', '=', hash)
    .where('status', '=', 'active');
  if (excludeId != null) exactQuery = exactQuery.where('id', '!=', excludeId);
  const exact = await exactQuery.executeTakeFirst();
  if (exact) return { ...exact, match: 'exact' };

  const key = normalizeLoose(stem);
  if (!key) return null;

  let allQuery = db.selectFrom('question').select(['id', 'stem', 'type']).where('status', '=', 'active');
  if (excludeId != null) allQuery = allQuery.where('id', '!=', excludeId);
  const rows = await allQuery.execute();
  const hit = rows.find((r) => normalizeLoose(r.stem) === key);
  return hit ? { ...hit, match: 'similar' } : null;
}

/** 命中重复时统一抛 409，details 带上已有题目，方便前端展示/跳转 */
export function duplicateError(dup: DuplicateHit): HttpError {
  const brief = dup.stem.length > 40 ? `${dup.stem.slice(0, 40)}…` : dup.stem;
  return new HttpError(409, `题库中已存在相同题目（ID ${dup.id}）：${brief}`, { duplicate: dup });
}

async function insertQuestion(db: AnyDb, draft: QuestionDraft, userId: number | null): Promise<number> {
  const now = Date.now();
  const stem = draft.stem.trim();
  const res = await db
    .insertInto('question')
    .values({
      type: draft.type,
      stem,
      images: serializeImageList(draft.images ?? []),
      explanation: draft.explanation?.trim() || null,
      category_id: draft.categoryId ?? null,
      tags: draft.tags && draft.tags.length ? JSON.stringify(draft.tags) : null,
      status: 'active',
      content_hash: contentHash(stem || `image:${(draft.images ?? []).join(',')}`),
      created_by: userId,
      created_at: now,
      updated_at: now,
    })
    .executeTakeFirstOrThrow();
  const questionId = Number(res.insertId);

  const options = draft.options.map((o, i) => ({
    question_id: questionId,
    content: o.content?.trim() ?? '',
    images: serializeImageList(o.images ?? []),
    is_correct: o.isCorrect ? 1 : 0,
    sort_order: i,
  }));
  if (options.length) {
    await db.insertInto('question_option').values(options).execute();
  }
  return questionId;
}

export async function createQuestion(
  db: Db,
  draftInput: QuestionDraft,
  userId: number | null,
  opts: { allowDuplicate?: boolean } = {},
): Promise<number> {
  const draft = normalizeDraftImages(draftInput);
  const errors = validateQuestionDraft(draft);
  if (errors.length) throw new HttpError(400, errors.join('；'));

  if (!opts.allowDuplicate) {
    const dup = await findDuplicate(db, draft.stem);
    if (dup) throw duplicateError(dup);
  }

  return db.transaction().execute((trx) => insertQuestion(trx, draft, userId));
}

export async function updateQuestion(
  db: Db,
  id: number,
  draftInput: QuestionDraft,
  opts: { allowDuplicate?: boolean } = {},
): Promise<void> {
  const draft = normalizeDraftImages(draftInput);
  const errors = validateQuestionDraft(draft);
  if (errors.length) throw new HttpError(400, errors.join('；'));

  if (!opts.allowDuplicate) {
    const dup = await findDuplicate(db, draft.stem, id);
    if (dup) throw duplicateError(dup);
  }

  await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom('question').select('id').where('id', '=', id).executeTakeFirst();
    if (!existing) throw new HttpError(404, '题目不存在');

    const stem = draft.stem.trim();
    await trx
      .updateTable('question')
      .set({
        type: draft.type,
        stem,
        images: serializeImageList(draft.images ?? []),
        explanation: draft.explanation?.trim() || null,
        category_id: draft.categoryId ?? null,
        tags: draft.tags && draft.tags.length ? JSON.stringify(draft.tags) : null,
        content_hash: contentHash(stem || `image:${(draft.images ?? []).join(',')}`),
        updated_at: Date.now(),
      })
      .where('id', '=', id)
      .execute();

    await trx.deleteFrom('question_option').where('question_id', '=', id).execute();
    const options = draft.options.map((o, i) => ({
      question_id: id,
      content: o.content?.trim() ?? '',
      images: serializeImageList(o.images ?? []),
      is_correct: o.isCorrect ? 1 : 0,
      sort_order: i,
    }));
    if (options.length) {
      await trx.insertInto('question_option').values(options).execute();
    }
  });
}

/** 单题删除的结果：让前端能提示「这题还在 N 份试卷里」 */
export interface ArchiveResult {
  archived: number;
  /** 这些题目被多少份试卷引用（含草稿卷与已发布卷） */
  usedInPapers: number;
}

/** 统计一批题目分别被哪些试卷引用（去重到试卷数） */
async function countUsedInPapers(db: Db, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const row = await db
    .selectFrom('paper_item')
    .select((eb) => eb.fn.countAll().as('c'))
    .where('question_id', 'in', ids)
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

/**
 * 删除题目 = **软删除**（status 置为 archived）。
 *
 * 为什么不做物理删除：paper_item / attempt_item 都只存 question_id，
 * 物理删掉之后历史试卷（尤其是已发布、还没人考的卷子）和已交卷的解析
 * 就再也拼不出题面了。归档之后题库列表看不见它，但凡是引用了它的试卷
 * 依然能正常预览、作答、判分、看解析。
 */
export async function deleteQuestion(db: Db, id: number): Promise<ArchiveResult> {
  const existing = await db.selectFrom('question').select(['id', 'status']).where('id', '=', id).executeTakeFirst();
  if (!existing) throw new HttpError(404, '题目不存在');

  const usedInPapers = await countUsedInPapers(db, [id]);
  if (existing.status !== 'archived') {
    await db.updateTable('question').set({ status: 'archived', updated_at: Date.now() }).where('id', '=', id).execute();
  }
  return { archived: 1, usedInPapers };
}

/** 批量删除（同样是软删除） */
export async function batchDeleteQuestions(db: Db, ids: number[]): Promise<ArchiveResult> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { archived: 0, usedInPapers: 0 };

  const rows = await db.selectFrom('question').select('id').where('id', 'in', unique).where('status', '=', 'active').execute();
  const activeIds = rows.map((r) => r.id);
  const usedInPapers = await countUsedInPapers(db, unique);

  if (activeIds.length) {
    await db.updateTable('question').set({ status: 'archived', updated_at: Date.now() }).where('id', 'in', activeIds).execute();
  }
  return { archived: activeIds.length, usedInPapers };
}

/** 批量改分类（categoryId = null 表示改成未分类） */
export async function batchSetCategory(db: Db, ids: number[], categoryId: number | null): Promise<{ updated: number }> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { updated: 0 };

  if (categoryId != null) {
    const cat = await db.selectFrom('category').select('id').where('id', '=', categoryId).executeTakeFirst();
    if (!cat) throw new HttpError(404, '分类不存在');
  }

  const result = await db
    .updateTable('question')
    .set({ category_id: categoryId, updated_at: Date.now() })
    .where('id', 'in', unique)
    .where('status', '=', 'active')
    .executeTakeFirst();
  return { updated: Number(result.numUpdatedRows ?? 0) };
}

export interface QuestionDetail {
  id: number;
  type: string;
  stem: string;
  images: string[];
  explanation: string | null;
  category_id: number | null;
  tags: string[];
  status: string;
  created_at: number;
  updated_at: number;
  options: { id: number; content: string; images: string[]; isCorrect: boolean; sortOrder: number }[];
}

export async function getQuestionDetail(db: Db, id: number): Promise<QuestionDetail | null> {
  const q = await db.selectFrom('question').selectAll().where('id', '=', id).executeTakeFirst();
  if (!q) return null;

  const options = await db
    .selectFrom('question_option')
    .selectAll()
    .where('question_id', '=', id)
    .orderBy('sort_order', 'asc')
    .execute();

  return {
    id: q.id,
    type: q.type,
    stem: q.stem,
    images: parseImageList(q.images),
    explanation: q.explanation,
    category_id: q.category_id,
    tags: q.tags ? (JSON.parse(q.tags) as string[]) : [],
    status: q.status,
    created_at: q.created_at,
    updated_at: q.updated_at,
    options: options.map((o) => ({
      id: o.id,
      content: o.content,
      images: parseImageList(o.images),
      isCorrect: o.is_correct === 1,
      sortOrder: o.sort_order,
    })),
  };
}

export interface ListFilter {
  keyword?: string;
  categoryId?: number;
  type?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface ListItem {
  id: number;
  type: string;
  stem: string;
  images: string[];
  status: string;
  category_id: number | null;
  option_count: number;
  created_at: number;
}

export async function listQuestions(
  db: Db,
  filter: ListFilter,
): Promise<{ items: ListItem[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(Math.max(1, filter.pageSize ?? 20), 100);

  let base = db.selectFrom('question');
  if (filter.keyword) base = base.where('stem', 'like', `%${filter.keyword}%`);
  if (filter.categoryId != null) base = base.where('category_id', '=', filter.categoryId);
  if (filter.type) base = base.where('type', '=', filter.type as 'single' | 'multiple');
  // 默认只看在用题目：删除是软删除（status=archived），不显式指定就按 active 过滤，
  // 想看归档的传 status=all
  if (filter.status !== 'all') {
    base = base.where('status', '=', (filter.status ?? 'active') as 'active' | 'archived');
  }

  const countRow = await base.select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  const total = Number(countRow.c);

  const items = await base
    .selectAll()
    .orderBy('id', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute();

  const ids = items.map((q) => q.id);
  let optionCounts: { question_id: number; cnt: number }[] = [];
  if (ids.length) {
    const rows = await db
      .selectFrom('question_option')
      .select(['question_id', (eb) => eb.fn.countAll().as('cnt')])
      .where('question_id', 'in', ids)
      .groupBy('question_id')
      .execute();
    optionCounts = rows.map((r) => ({ question_id: r.question_id, cnt: Number(r.cnt) }));
  }
  const countMap = new Map(optionCounts.map((r) => [r.question_id, r.cnt]));

  return {
    total,
    items: items.map((q) => ({
      id: q.id,
      type: q.type,
      stem: q.stem,
      images: parseImageList(q.images),
      status: q.status,
      category_id: q.category_id,
      option_count: countMap.get(q.id) ?? 0,
      created_at: q.created_at,
    })),
  };
}
