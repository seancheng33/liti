import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { parseImageList } from '../media.js';

type AnyDb = Kysely<Database> | Transaction<Database>;

/**
 * 错题库：**每个用户一份，靠 user_id 隔离**。
 * 所有对外函数第一个参数永远是「当前登录用户」，不接受外部传入的 userId，
 * 免得哪天某个路由手滑把别人的 id 传进来。
 *
 * 语义：
 * - 答错 → wrong_count+1，resolved_at 置空（再错一次就重新回到错题本）
 * - 答对 → resolved_at 置上（"已订正"），记录保留
 * 记录不做物理删除，只在用户手动移除时才删 —— 学生自己说"这题我懂了"才算数。
 */

export interface WrongQuestionItem {
  id: number;
  questionId: number;
  type: string;
  stem: string;
  images: string[];
  categoryId: number | null;
  categoryName: string | null;
  wrongCount: number;
  firstWrongAt: number;
  lastWrongAt: number;
  resolved: boolean;
  resolvedAt: number | null;
}

export interface ListWrongOptions {
  page?: number;
  pageSize?: number;
  categoryId?: number | null;
  /** active=还没订正（默认）；resolved=已订正；all=全部 */
  status?: 'active' | 'resolved' | 'all';
  keyword?: string;
}

/** 判分时调用：这道题答错了 */
export async function recordWrong(
  db: AnyDb,
  userId: number,
  questionId: number,
  attemptId: number,
  now = Date.now(),
): Promise<void> {
  const existing = await db
    .selectFrom('wrong_question')
    .select(['id', 'wrong_count'])
    .where('user_id', '=', userId)
    .where('question_id', '=', questionId)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable('wrong_question')
      .set({
        wrong_count: existing.wrong_count + 1,
        last_wrong_at: now,
        last_attempt_id: attemptId,
        // 订正过又错了 → 重新回到错题本
        resolved_at: null,
        updated_at: now,
      })
      .where('id', '=', existing.id)
      .execute();
    return;
  }

  await db
    .insertInto('wrong_question')
    .values({
      user_id: userId,
      question_id: questionId,
      wrong_count: 1,
      first_wrong_at: now,
      last_wrong_at: now,
      last_attempt_id: attemptId,
      resolved_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

/** 判分时调用：这道题答对了 → 从"待订正"里移出去（记录留着） */
export async function recordCorrect(db: AnyDb, userId: number, questionId: number, now = Date.now()): Promise<void> {
  await db
    .updateTable('wrong_question')
    .set({ resolved_at: now, updated_at: now })
    .where('user_id', '=', userId)
    .where('question_id', '=', questionId)
    .where('resolved_at', 'is', null)
    .execute();
}

export async function listWrongQuestions(
  db: Db,
  userId: number,
  opts: ListWrongOptions = {},
): Promise<{ items: WrongQuestionItem[]; total: number; activeTotal: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(Math.max(1, opts.pageSize ?? 20), 100);
  const status = opts.status ?? 'active';

  const build = () => {
    // 题目可能已被软删除（archived），错题本里照样要显示 —— 学生是靠它复习的
    let q = db
      .selectFrom('wrong_question as wq')
      .innerJoin('question as q', 'q.id', 'wq.question_id')
      .leftJoin('category as c', 'c.id', 'q.category_id')
      .where('wq.user_id', '=', userId);
    if (status === 'resolved') q = q.where('wq.resolved_at', 'is not', null);
    else if (status !== 'all') q = q.where('wq.resolved_at', 'is', null);
    if (opts.categoryId != null) q = q.where('q.category_id', '=', opts.categoryId);
    if (opts.keyword) q = q.where('q.stem', 'like', `%${opts.keyword}%`);
    return q;
  };

  const countRow = await build()
    .select((eb) => eb.fn.countAll().as('c'))
    .executeTakeFirstOrThrow();
  const total = Number(countRow.c);

  // 待订正总数：首页/练习中心要显示「你有 N 道错题」
  const activeRow = await db
    .selectFrom('wrong_question')
    .select((eb) => eb.fn.countAll().as('c'))
    .where('user_id', '=', userId)
    .where('resolved_at', 'is', null)
    .executeTakeFirstOrThrow();

  const rows = await build()
    .select([
      'wq.id as id',
      'wq.question_id as question_id',
      'wq.wrong_count as wrong_count',
      'wq.first_wrong_at as first_wrong_at',
      'wq.last_wrong_at as last_wrong_at',
      'wq.resolved_at as resolved_at',
      'q.type as type',
      'q.stem as stem',
      'q.images as images',
      'q.category_id as category_id',
      'c.name as category_name',
    ])
    .orderBy('wq.last_wrong_at', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute();

  return {
    total,
    activeTotal: Number(activeRow.c),
    items: rows.map((r) => ({
      id: r.id,
      questionId: r.question_id,
      type: r.type,
      stem: r.stem,
      images: parseImageList(r.images),
      categoryId: r.category_id,
      categoryName: r.category_name ?? null,
      wrongCount: r.wrong_count,
      firstWrongAt: r.first_wrong_at,
      lastWrongAt: r.last_wrong_at,
      resolved: r.resolved_at != null,
      resolvedAt: r.resolved_at,
    })),
  };
}

/**
 * 错题详情：带选项、正确答案与解析。
 * 学生看自己错过的题，给答案与解析是学习用途；这些题必然出现在**已交卷**的答卷里
 * （错题只在判分时写入），所以不存在提前泄题。
 */
export async function getWrongQuestionDetail(db: Db, userId: number, questionId: number) {
  const wq = await db
    .selectFrom('wrong_question')
    .selectAll()
    .where('user_id', '=', userId)
    .where('question_id', '=', questionId)
    .executeTakeFirst();
  if (!wq) throw new HttpError(404, '错题不存在');

  const q = await db
    .selectFrom('question')
    .leftJoin('category as c', 'c.id', 'question.category_id')
    .select([
      'question.id as id',
      'question.type as type',
      'question.stem as stem',
      'question.images as images',
      'question.explanation as explanation',
      'question.category_id as category_id',
      'question.status as status',
      'c.name as category_name',
    ])
    .where('question.id', '=', questionId)
    .executeTakeFirst();
  if (!q) throw new HttpError(404, '题目不存在');

  const options = await db
    .selectFrom('question_option')
    .select(['id', 'content', 'images', 'is_correct', 'sort_order'])
    .where('question_id', '=', questionId)
    .orderBy('sort_order', 'asc')
    .execute();

  return {
    questionId,
    type: q.type,
    stem: q.stem,
    images: parseImageList(q.images),
    explanation: q.explanation,
    categoryId: q.category_id,
    categoryName: q.category_name ?? null,
    status: q.status,
    wrongCount: wq.wrong_count,
    firstWrongAt: wq.first_wrong_at,
    lastWrongAt: wq.last_wrong_at,
    resolved: wq.resolved_at != null,
    options: options.map((o) => ({
      id: o.id,
      content: o.content,
      images: parseImageList(o.images),
      isCorrect: o.is_correct === 1,
    })),
  };
}

/** 学生手动移除（"这题我懂了"，或者题目已被删掉不想再看到） */
export async function removeWrongQuestion(db: Db, userId: number, questionId: number): Promise<void> {
  await db
    .deleteFrom('wrong_question')
    .where('user_id', '=', userId)
    .where('question_id', '=', questionId)
    .execute();
}

export async function batchRemoveWrong(db: Db, userId: number, questionIds: number[]): Promise<{ removed: number }> {
  const ids = [...new Set(questionIds)];
  if (!ids.length) return { removed: 0 };
  const res = await db
    .deleteFrom('wrong_question')
    .where('user_id', '=', userId)
    .where('question_id', 'in', ids)
    .executeTakeFirst();
  return { removed: Number(res.numDeletedRows ?? 0) };
}

/**
 * 从错题库里抽题（做错题练习卷用）。
 * 只抽「还没订正 + 题目仍在题库（active）」的 —— 归档题抽出来会没法判分展示。
 */
export async function sampleWrongQuestionIds(
  db: Db,
  userId: number,
  count: number,
  categoryId?: number | null,
): Promise<number[]> {
  let q = db
    .selectFrom('wrong_question as wq')
    .innerJoin('question as q', 'q.id', 'wq.question_id')
    .select('wq.question_id as question_id')
    .where('wq.user_id', '=', userId)
    .where('wq.resolved_at', 'is', null)
    .where('q.status', '=', 'active');
  if (categoryId != null) q = q.where('q.category_id', '=', categoryId);

  const rows = await q.execute();
  const ids = rows.map((r) => r.question_id);
  if (!ids.length) {
    throw new HttpError(400, '你的错题本里还没有待订正的题目，先去练几道吧');
  }
  if (ids.length < count) {
    throw new HttpError(400, `错题本里只有 ${ids.length} 道待订正的题，不够 ${count} 道（可以先把题量调小）`);
  }
  // 洗牌：每次练同样的顺序容易变成背题
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, count);
}

/** 错题按分类汇总（练习中心给个「哪块最弱」的小提示） */
export async function wrongByCategory(
  db: Db,
  userId: number,
): Promise<{ categoryId: number | null; categoryName: string; count: number }[]> {
  const rows = await db
    .selectFrom('wrong_question as wq')
    .innerJoin('question as q', 'q.id', 'wq.question_id')
    .leftJoin('category as c', 'c.id', 'q.category_id')
    .select(['q.category_id as category_id', 'c.name as category_name', (eb) => eb.fn.countAll().as('c')])
    .where('wq.user_id', '=', userId)
    .where('wq.resolved_at', 'is', null)
    .where('q.status', '=', 'active')
    .groupBy(['q.category_id', 'c.name'])
    .execute();

  return rows
    .map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name ?? '未分类',
      count: Number(r.c),
    }))
    .sort((a, b) => b.count - a.count);
}

/** 删除用户时清掉他的错题库 */
export async function purgeUserWrong(db: AnyDb, userId: number): Promise<void> {
  await db.deleteFrom('wrong_question').where('user_id', '=', userId).execute();
}
