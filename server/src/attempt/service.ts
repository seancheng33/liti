import type { Kysely, Selectable, Transaction } from 'kysely';
import type { Database, AttemptRow } from '../db/types.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { fisherYates } from '../paper/validate.js';

type AnyDb = Kysely<Database> | Transaction<Database>;

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export async function startAttempt(db: Db, paperId: number, userId: number): Promise<number> {
  const paper = await db.selectFrom('paper').selectAll().where('id', '=', paperId).executeTakeFirst();
  if (!paper) throw new HttpError(404, '试卷不存在');
  if (paper.status !== 'published') throw new HttpError(400, '试卷未发布，无法作答');

  const items = await db.selectFrom('paper_item').selectAll().where('paper_id', '=', paperId).orderBy('order_no', 'asc').execute();
  if (!items.length) throw new HttpError(400, '试卷没有题目');

  const totalScore = items.reduce((s, i) => s + i.score, 0);
  const now = Date.now();
  const deadlineAt = now + paper.duration_sec * 1000;

  return db.transaction().execute(async (trx) => {
    const res = await trx
      .insertInto('attempt')
      .values({
        paper_id: paperId,
        user_id: userId,
        started_at: now,
        deadline_at: deadlineAt,
        status: 'in_progress',
        score: 0,
        total_score: totalScore,
        correct_count: 0,
        created_at: now,
      })
      .executeTakeFirstOrThrow();
    const attemptId = Number(res.insertId);

    for (const item of items) {
      const options = await trx
        .selectFrom('question_option')
        .selectAll()
        .where('question_id', '=', item.question_id)
        .orderBy('sort_order', 'asc')
        .execute();
      let ordered = options.map((o) => o.id);
      if (paper.shuffle_options === 1) ordered = fisherYates(ordered);

      await trx
        .insertInto('attempt_item')
        .values({
          attempt_id: attemptId,
          question_id: item.question_id,
          order_no: item.order_no,
          option_order: JSON.stringify(ordered),
          selected: null,
          is_correct: null,
          score: 0,
          answered_at: null,
        })
        .execute();
    }
    return attemptId;
  });
}

async function gradeAttempt(db: Db, attemptId: number, reason: 'manual' | 'violation' | 'timeout', status: 'submitted' | 'expired'): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const attempt = await trx.selectFrom('attempt').selectAll().where('id', '=', attemptId).executeTakeFirst();
    if (!attempt || attempt.status !== 'in_progress') return;

    const items = await trx.selectFrom('attempt_item').selectAll().where('attempt_id', '=', attemptId).execute();
    const questionIds = items.map((i) => i.question_id);

    const correctMap = new Map<number, Set<number>>();
    if (questionIds.length) {
      const options = await trx
        .selectFrom('question_option')
        .selectAll()
        .where('question_id', 'in', questionIds)
        .where('is_correct', '=', 1)
        .execute();
      for (const o of options) {
        if (!correctMap.has(o.question_id)) correctMap.set(o.question_id, new Set());
        correctMap.get(o.question_id)!.add(o.id);
      }
    }

    const paperItems = await trx.selectFrom('paper_item').selectAll().where('paper_id', '=', attempt.paper_id).execute();
    const scoreMap = new Map(paperItems.map((p) => [p.question_id, p.score]));

    let score = 0;
    let correctCount = 0;
    for (const item of items) {
      const correct = correctMap.get(item.question_id) ?? new Set<number>();
      const selected: number[] = item.selected ? JSON.parse(item.selected) : [];
      const ok = setsEqual(new Set(selected), correct);
      const itemScore = ok ? (scoreMap.get(item.question_id) ?? 1) : 0;
      if (ok) correctCount++;
      score += itemScore;
      await trx
        .updateTable('attempt_item')
        .set({ is_correct: ok ? 1 : 0, score: itemScore })
        .where('id', '=', item.id)
        .execute();
    }

    await trx
      .updateTable('attempt')
      .set({ status, submitted_at: Date.now(), score, correct_count: correctCount, submit_reason: reason })
      .where('id', '=', attemptId)
      .execute();
  });
}

async function getAttempt(db: Db, attemptId: number): Promise<Selectable<AttemptRow> | undefined> {
  return db.selectFrom('attempt').selectAll().where('id', '=', attemptId).executeTakeFirst();
}

export async function saveAnswer(
  db: Db,
  attemptId: number,
  userId: number,
  questionId: number,
  selectedOptionIds: number[],
): Promise<void> {
  const attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new HttpError(404, '答卷不存在');
  if (attempt.user_id !== userId) throw new HttpError(403, '无权操作此答卷');
  if (attempt.status !== 'in_progress') throw new HttpError(400, '答卷已结束');
  if (Date.now() > attempt.deadline_at) {
    await gradeAttempt(db, attemptId, 'timeout', 'expired');
    throw new HttpError(400, '已超过答题时间');
  }

  const item = await db
    .selectFrom('attempt_item')
    .selectAll()
    .where('attempt_id', '=', attemptId)
    .where('question_id', '=', questionId)
    .executeTakeFirst();
  if (!item) throw new HttpError(404, '题目不在本答卷中');

  const optionOrder: number[] = JSON.parse(item.option_order);
  const valid = new Set(optionOrder);
  const selected = [...new Set(selectedOptionIds)].filter((id) => valid.has(id));

  await db
    .updateTable('attempt_item')
    .set({ selected: JSON.stringify(selected), answered_at: Date.now() })
    .where('id', '=', item.id)
    .execute();
}

export async function reportViolation(
  db: Db,
  attemptId: number,
  userId: number,
  type: string,
): Promise<{ count: number; autoSubmitted: boolean }> {
  const attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new HttpError(404, '答卷不存在');
  if (attempt.user_id !== userId) throw new HttpError(403, '无权操作此答卷');
  if (attempt.status !== 'in_progress') return { count: 0, autoSubmitted: false };

  await db.insertInto('attempt_violation').values({ attempt_id: attemptId, type, occurred_at: Date.now(), meta: null }).execute();

  const count = Number(
    (await db
      .selectFrom('attempt_violation')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('attempt_id', '=', attemptId)
      .executeTakeFirstOrThrow()).c,
  );

  if (count >= 3) {
    await gradeAttempt(db, attemptId, 'violation', 'submitted');
    return { count, autoSubmitted: true };
  }
  return { count, autoSubmitted: false };
}

export async function submitAttempt(db: Db, attemptId: number, userId: number): Promise<void> {
  const attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new HttpError(404, '答卷不存在');
  if (attempt.user_id !== userId) throw new HttpError(403, '无权操作此答卷');
  if (attempt.status !== 'in_progress') throw new HttpError(400, '答卷已提交');

  if (Date.now() > attempt.deadline_at) {
    await gradeAttempt(db, attemptId, 'timeout', 'expired');
    throw new HttpError(400, '已超过答题时间，自动交卷');
  }
  await gradeAttempt(db, attemptId, 'manual', 'submitted');
}

export async function getAttemptReview(db: Db, attemptId: number, userId: number) {
  const attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new HttpError(404, '答卷不存在');
  if (attempt.user_id !== userId) throw new HttpError(403, '无权查看此答卷');

  // 惰性判分：过期未交卷的在访问时补判
  if (attempt.status === 'in_progress' && Date.now() > attempt.deadline_at) {
    await gradeAttempt(db, attemptId, 'timeout', 'expired');
  }

  const refreshed = (await getAttempt(db, attemptId))!;
  const paper = await db.selectFrom('paper').selectAll().where('id', '=', refreshed.paper_id).executeTakeFirst();
  const items = await db.selectFrom('attempt_item').selectAll().where('attempt_id', '=', attemptId).orderBy('order_no', 'asc').execute();

  const questionIds = items.map((i) => i.question_id);
  const questions = questionIds.length ? await db.selectFrom('question').selectAll().where('id', 'in', questionIds).execute() : [];
  const qMap = new Map(questions.map((q) => [q.id, q]));
  const options = questionIds.length ? await db.selectFrom('question_option').selectAll().where('question_id', 'in', questionIds).execute() : [];
  const optMap = new Map<number, { id: number; content: string; is_correct: number }[]>();
  for (const o of options) {
    if (!optMap.has(o.question_id)) optMap.set(o.question_id, []);
    optMap.get(o.question_id)!.push(o);
  }

  const reveal = refreshed.status !== 'in_progress' || paper?.review_mode === 'immediate';

  return {
    id: refreshed.id,
    paperId: refreshed.paper_id,
    paperTitle: paper?.title,
    status: refreshed.status,
    startedAt: refreshed.started_at,
    deadlineAt: refreshed.deadline_at,
    submittedAt: refreshed.submitted_at,
    score: refreshed.score,
    totalScore: refreshed.total_score,
    correctCount: refreshed.correct_count,
    submitReason: refreshed.submit_reason,
    reviewMode: paper?.review_mode,
    items: items.map((item) => {
      const q = qMap.get(item.question_id);
      const opts = optMap.get(item.question_id) ?? [];
      const optionOrder: number[] = JSON.parse(item.option_order);
      const selected: number[] = item.selected ? JSON.parse(item.selected) : [];
      const optById = new Map(opts.map((o) => [o.id, o]));
      return {
        orderNo: item.order_no,
        questionId: item.question_id,
        type: q?.type,
        stem: q?.stem,
        explanation: reveal ? (q?.explanation ?? null) : null,
        options: optionOrder.map((oid) => ({
          id: oid,
          content: optById.get(oid)?.content ?? '',
          isCorrect: reveal ? optById.get(oid)?.is_correct === 1 : null,
        })),
        selectedOptionIds: selected,
        isCorrect: refreshed.status !== 'in_progress' ? item.is_correct === 1 : null,
        score: refreshed.status !== 'in_progress' ? item.score : null,
      };
    }),
  };
}

export async function listMyAttempts(db: Db, userId: number, page = 1, pageSize = 20) {
  const p = Math.max(1, page);
  const ps = Math.min(Math.max(1, pageSize), 100);
  const total = Number(
    (await db.selectFrom('attempt').select((eb) => eb.fn.countAll().as('c')).where('user_id', '=', userId).executeTakeFirstOrThrow()).c,
  );
  const items = await db
    .selectFrom('attempt')
    .innerJoin('paper', 'paper.id', 'attempt.paper_id')
    .select([
      'attempt.id',
      'attempt.paper_id',
      'attempt.status',
      'attempt.score',
      'attempt.total_score',
      'attempt.correct_count',
      'attempt.started_at',
      'attempt.deadline_at',
      'attempt.submitted_at',
      'attempt.submit_reason',
      'paper.title as paper_title',
      'paper.question_count',
    ])
    .where('attempt.user_id', '=', userId)
    .orderBy('attempt.id', 'desc')
    .limit(ps)
    .offset((p - 1) * ps)
    .execute();
  return { total, items };
}
