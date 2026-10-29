import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { contentHash, validateQuestionDraft, type QuestionDraft } from './validate.js';

type AnyDb = Kysely<Database> | Transaction<Database>;

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

export async function createQuestion(db: Db, draft: QuestionDraft, userId: number | null): Promise<number> {
  const errors = validateQuestionDraft(draft);
  if (errors.length) throw new HttpError(400, errors.join('；'));
  return db.transaction().execute((trx) => insertQuestion(trx, draft, userId));
}

export async function updateQuestion(db: Db, id: number, draft: QuestionDraft): Promise<void> {
  const errors = validateQuestionDraft(draft);
  if (errors.length) throw new HttpError(400, errors.join('；'));

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
