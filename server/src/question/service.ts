import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { contentHash, normalizeLoose, validateQuestionDraft, type QuestionDraft } from './validate.js';

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
 * 说明：宽松比对会拉一次 id/stem/type（题库规模在万级以内，可接受；仅在新增/编辑/导入时触发）。
 */
export async function findDuplicate(db: Db, stem: string, excludeId?: number): Promise<DuplicateHit | null> {
  const hash = contentHash(stem);
  let exactQuery = db
    .selectFrom('question')
    .select(['id', 'stem', 'type'])
    .where('content_hash', '=', hash);
  if (excludeId != null) exactQuery = exactQuery.where('id', '!=', excludeId);
  const exact = await exactQuery.executeTakeFirst();
  if (exact) return { ...exact, match: 'exact' };

  const key = normalizeLoose(stem);
  if (!key) return null;

  let allQuery = db.selectFrom('question').select(['id', 'stem', 'type']);
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
  const res = await db
    .insertInto('question')
    .values({
      type: draft.type,
      stem: draft.stem.trim(),
      explanation: draft.explanation?.trim() || null,
      category_id: draft.categoryId ?? null,
      difficulty: draft.difficulty ?? 2,
      tags: draft.tags && draft.tags.length ? JSON.stringify(draft.tags) : null,
      status: 'active',
      content_hash: contentHash(draft.stem),
      created_by: userId,
      created_at: now,
      updated_at: now,
    })
    .executeTakeFirstOrThrow();
  const questionId = Number(res.insertId);

  const options = draft.options.map((o, i) => ({
    question_id: questionId,
    content: o.content.trim(),
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
  draft: QuestionDraft,
  userId: number | null,
  opts: { allowDuplicate?: boolean } = {},
): Promise<number> {
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
  draft: QuestionDraft,
  opts: { allowDuplicate?: boolean } = {},
): Promise<void> {
  const errors = validateQuestionDraft(draft);
  if (errors.length) throw new HttpError(400, errors.join('；'));

  if (!opts.allowDuplicate) {
    const dup = await findDuplicate(db, draft.stem, id);
    if (dup) throw duplicateError(dup);
  }

  await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom('question').select('id').where('id', '=', id).executeTakeFirst();
    if (!existing) throw new HttpError(404, '题目不存在');

    await trx
      .updateTable('question')
      .set({
        type: draft.type,
        stem: draft.stem.trim(),
        explanation: draft.explanation?.trim() || null,
        category_id: draft.categoryId ?? null,
        difficulty: draft.difficulty ?? 2,
        tags: draft.tags && draft.tags.length ? JSON.stringify(draft.tags) : null,
        content_hash: contentHash(draft.stem),
        updated_at: Date.now(),
      })
      .where('id', '=', id)
      .execute();

    await trx.deleteFrom('question_option').where('question_id', '=', id).execute();
    const options = draft.options.map((o, i) => ({
      question_id: id,
      content: o.content.trim(),
      is_correct: o.isCorrect ? 1 : 0,
      sort_order: i,
    }));
    if (options.length) {
      await trx.insertInto('question_option').values(options).execute();
    }
  });
}

export async function deleteQuestion(db: Db, id: number): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('question_option').where('question_id', '=', id).execute();
    await trx.deleteFrom('question').where('id', '=', id).execute();
  });
}

export interface QuestionDetail {
  id: number;
  type: string;
  stem: string;
  explanation: string | null;
  category_id: number | null;
  difficulty: number;
  tags: string[];
  status: string;
  created_at: number;
  updated_at: number;
  options: { id: number; content: string; isCorrect: boolean; sortOrder: number }[];
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
    explanation: q.explanation,
    category_id: q.category_id,
    difficulty: q.difficulty,
    tags: q.tags ? (JSON.parse(q.tags) as string[]) : [],
    status: q.status,
    created_at: q.created_at,
    updated_at: q.updated_at,
    options: options.map((o) => ({
      id: o.id,
      content: o.content,
      isCorrect: o.is_correct === 1,
      sortOrder: o.sort_order,
    })),
  };
}

export interface ListFilter {
  keyword?: string;
  categoryId?: number;
  difficulty?: number;
  type?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function listQuestions(
  db: Db,
  filter: ListFilter,
): Promise<{ items: { id: number; type: string; stem: string; difficulty: number; status: string; category_id: number | null; option_count: number; created_at: number }[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(Math.max(1, filter.pageSize ?? 20), 100);

  let base = db.selectFrom('question');
  if (filter.keyword) base = base.where('stem', 'like', `%${filter.keyword}%`);
  if (filter.categoryId != null) base = base.where('category_id', '=', filter.categoryId);
  if (filter.difficulty != null) base = base.where('difficulty', '=', filter.difficulty);
  if (filter.type) base = base.where('type', '=', filter.type as 'single' | 'multiple');
  if (filter.status) base = base.where('status', '=', filter.status as 'active' | 'archived');

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
      difficulty: q.difficulty,
      status: q.status,
      category_id: q.category_id,
      option_count: countMap.get(q.id) ?? 0,
      created_at: q.created_at,
    })),
  };
}
