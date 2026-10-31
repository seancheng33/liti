import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { fisherYates, MAX_PAPER_QUESTIONS, validatePaperInput, type PaperInput, type RandomRule } from './validate.js';

type AnyDb = Kysely<Database> | Transaction<Database>;

export interface SampleRule {
  /** 留空表示从整个题库抽 */
  categoryId?: number;
  count: number;
}

export async function sampleQuestionIds(db: AnyDb, rules: SampleRule[]): Promise<number[]> {
  const picked: number[] = [];
  const pickedSet = new Set<number>();
  for (const rule of rules) {
    let q = db.selectFrom('question').select('id').where('status', '=', 'active');
    if (rule.categoryId != null) q = q.where('category_id', '=', rule.categoryId);
    const ids = (await q.execute()).map((r) => r.id).filter((id) => !pickedSet.has(id));

    if (ids.length < rule.count) {
      const scope = rule.categoryId != null ? '该分类' : '题库';
      throw new HttpError(400, `${scope}题目不足：需抽 ${rule.count} 题，但仅剩 ${ids.length} 题可抽`);
    }
    for (const id of fisherYates(ids).slice(0, rule.count)) {
      picked.push(id);
      pickedSet.add(id);
    }
  }
  return picked;
}

export async function previewRandom(db: Db, rules: SampleRule[]): Promise<{ questionIds: number[] }> {
  const total = rules.reduce((s, r) => s + r.count, 0);
  if (total < 1 || total > MAX_PAPER_QUESTIONS) throw new HttpError(400, `题量须在 1–${MAX_PAPER_QUESTIONS} 之间`);
  const ids = await sampleQuestionIds(db, rules);
  return { questionIds: ids };
}

async function insertPaper(db: AnyDb, input: PaperInput, userId: number | null, questionIds: number[]): Promise<number> {
  const now = Date.now();
  const res = await db
    .insertInto('paper')
    .values({
      title: input.title.trim(),
      mode: input.mode,
      question_count: questionIds.length,
      duration_sec: input.durationSec,
      pass_score: input.passScore ?? 60,
      review_mode: input.reviewMode ?? 'after_submit',
      shuffle_options: input.shuffleOptions === false ? 0 : 1,
      random_config: input.mode === 'random' ? JSON.stringify(input.randomRules ?? []) : null,
      status: 'draft',
      practice: 0,
      created_by: userId,
      created_at: now,
      updated_at: now,
    })
    .executeTakeFirstOrThrow();
  const paperId = Number(res.insertId);

  if (questionIds.length) {
    await db
      .insertInto('paper_item')
      .values(questionIds.map((qid, i) => ({ paper_id: paperId, question_id: qid, order_no: i + 1, score: 1 })))
      .execute();
  }
  return paperId;
}

/** 把组卷入参解析成最终题号数组（随机抽样或手选校验） */
export async function resolveQuestionIds(db: Db, input: PaperInput): Promise<number[]> {
  if (input.mode === 'random') {
    const rules: SampleRule[] = (input.randomRules ?? []).map((r: RandomRule) => ({
      categoryId: r.categoryId ?? undefined,
      count: r.count,
    }));
    return sampleQuestionIds(db, rules);
  }
  const ids = [...new Set(input.questionIds ?? [])];
  const existing = await db.selectFrom('question').select('id').where('id', 'in', ids).where('status', '=', 'active').execute();
  const existingIds = new Set(existing.map((r) => r.id));
  const missing = ids.filter((id) => !existingIds.has(id));
  if (missing.length) throw new HttpError(400, `题目不存在或已归档: ${missing.join(',')}`);
  return ids;
}

export async function createPaper(db: Db, input: PaperInput, userId: number | null): Promise<number> {
  const errors = validatePaperInput(input);
  if (errors.length) throw new HttpError(400, errors.join('；'));

  const questionIds = await resolveQuestionIds(db, input);
  return db.transaction().execute((trx) => insertPaper(trx, input, userId, questionIds));
}

export async function getPaperDetail(db: Db, id: number) {
  const paper = await db.selectFrom('paper').selectAll().where('id', '=', id).executeTakeFirst();
  if (!paper) return null;
  const items = await db.selectFrom('paper_item').selectAll().where('paper_id', '=', id).orderBy('order_no', 'asc').execute();
  return {
    ...paper,
    random_config: paper.random_config ? JSON.parse(paper.random_config) : null,
    items,
  };
}

export async function listPapers(db: Db, opts: { page?: number; pageSize?: number; status?: string }) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(Math.max(1, opts.pageSize ?? 20), 100);
  let base = db.selectFrom('paper').where('practice', '=', 0);
  if (opts.status) base = base.where('status', '=', opts.status as 'draft' | 'published' | 'archived');
  const total = Number((await base.select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow()).c);
  const items = await base.selectAll().orderBy('id', 'desc').limit(pageSize).offset((page - 1) * pageSize).execute();
  return { total, items };
}

export async function setPaperStatus(db: Db, id: number, status: 'draft' | 'published' | 'archived'): Promise<void> {
  const existing = await db.selectFrom('paper').select('id').where('id', '=', id).executeTakeFirst();
  if (!existing) throw new HttpError(404, '试卷不存在');
  await db.updateTable('paper').set({ status, updated_at: Date.now() }).where('id', '=', id).execute();
}

export async function deletePaper(db: Db, id: number): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('paper_item').where('paper_id', '=', id).execute();
    await trx.deleteFrom('paper').where('id', '=', id).execute();
  });
}
