import type { Kysely, Selectable, Transaction } from 'kysely';
import type { Database, AttemptRow } from '../db/types.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { parseImageList } from '../media.js';
import { MAX_ATTEMPTS_PER_PAPER, paperVisibleTo, sampleQuestionIds, type SampleRule } from '../paper/service.js';
import { fisherYates, MAX_PAPER_QUESTIONS } from '../paper/validate.js';

type AnyDb = Kysely<Database> | Transaction<Database>;

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** 已用掉的作答次数（交卷/超时都算，进行中不算） */
async function usedAttempts(db: Db, paperId: number, userId: number): Promise<number> {
  const row = await db
    .selectFrom('attempt')
    .select((eb) => eb.fn.countAll().as('c'))
    .where('paper_id', '=', paperId)
    .where('user_id', '=', userId)
    .where('status', 'in', ['submitted', 'expired'])
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

export async function startAttempt(db: Db, paperId: number, userId: number): Promise<number> {
  const paper = await db.selectFrom('paper').selectAll().where('id', '=', paperId).executeTakeFirst();
  if (!paper) throw new HttpError(404, '试卷不存在');
  if (paper.status !== 'published' && paper.practice !== 1) throw new HttpError(400, '试卷未发布，无法作答');

  // 限定学生的卷子：不在名单里的一律当作不存在，别让人试出卷子标题
  if (paper.practice !== 1 && !(await paperVisibleTo(db, paperId, userId))) {
    throw new HttpError(404, '试卷不存在');
  }

  const items = await db.selectFrom('paper_item').selectAll().where('paper_id', '=', paperId).orderBy('order_no', 'asc').execute();
  if (!items.length) throw new HttpError(400, '试卷没有题目');

  // 有一份还没交的答卷就接着答，而不是再开一张 —— 否则重复点「开始答题」
  // 会白白占掉作答次数，学生也会发现之前写的答案没了
  const running = await db
    .selectFrom('attempt')
    .selectAll()
    .where('paper_id', '=', paperId)
    .where('user_id', '=', userId)
    .where('status', '=', 'in_progress')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (running) {
    const stale = running.paused_at == null && Date.now() > running.deadline_at;
    if (!stale) return running.id;
    // 已经超时的旧答卷先判掉，再走开新卷的流程
    await gradeAttempt(db, running.id, 'timeout', 'expired');
  }

  if (paper.practice !== 1) {
    const used = await usedAttempts(db, paperId, userId);
    if (used >= MAX_ATTEMPTS_PER_PAPER) {
      throw new HttpError(400, `这份试卷最多可作答 ${MAX_ATTEMPTS_PER_PAPER} 次，你已用完 ${used} 次`);
    }
  }

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
        paused_at: null,
        paused_total_ms: 0,
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
          flagged: 0,
          answered_at: null,
        })
        .execute();
    }
    return attemptId;
  });
}

export async function startPractice(db: Db, userId: number, rules: SampleRule[], durationSec: number): Promise<number> {
  const total = rules.reduce((s, r) => s + r.count, 0);
  if (total < 1 || total > MAX_PAPER_QUESTIONS) {
    throw new HttpError(400, `题量须在 1–${MAX_PAPER_QUESTIONS} 之间`);
  }
  const questionIds = await sampleQuestionIds(db, rules);
  const now = Date.now();
  const deadlineAt = now + durationSec * 1000;

  return db.transaction().execute(async (trx) => {
    const paperRes = await trx
      .insertInto('paper')
      .values({
        title: `练习卷（随机 ${questionIds.length} 题）`,
        mode: 'random',
        question_count: questionIds.length,
        duration_sec: durationSec,
        pass_score: 60,
        review_mode: 'immediate',
        shuffle_options: 1,
        random_config: JSON.stringify(rules),
        status: 'draft',
        practice: 1,
        audience_mode: 'all',
        created_by: userId,
        created_at: now,
        updated_at: now,
      })
      .executeTakeFirstOrThrow();
    const paperId = Number(paperRes.insertId);

    await trx
      .insertInto('paper_item')
      .values(questionIds.map((qid, i) => ({ paper_id: paperId, question_id: qid, order_no: i + 1, score: 1 })))
      .execute();

    const attemptRes = await trx
      .insertInto('attempt')
      .values({
        paper_id: paperId,
        user_id: userId,
        started_at: now,
        deadline_at: deadlineAt,
        status: 'in_progress',
        score: 0,
        total_score: questionIds.length,
        correct_count: 0,
        paused_at: null,
        paused_total_ms: 0,
        created_at: now,
      })
      .executeTakeFirstOrThrow();
    const attemptId = Number(attemptRes.insertId);

    for (let i = 0; i < questionIds.length; i++) {
      const qid = questionIds[i];
      const options = await trx
        .selectFrom('question_option')
        .selectAll()
        .where('question_id', '=', qid)
        .orderBy('sort_order', 'asc')
        .execute();
      const ordered = fisherYates(options.map((o) => o.id));
      await trx
        .insertInto('attempt_item')
        .values({
          attempt_id: attemptId,
          question_id: qid,
          order_no: i + 1,
          option_order: JSON.stringify(ordered),
          selected: null,
          is_correct: null,
          score: 0,
          flagged: 0,
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

export interface PauseState {
  paused: boolean;
  pausedAt: number | null;
  pausedTotalMs: number;
  deadlineAt: number;
  remainingSec: number;
  /** 服务端当前时间：前端拿它校正本机时钟，别让考生机器的时间偏差影响倒计时 */
  serverNow: number;
}

function pauseStateOf(a: Selectable<AttemptRow>): PauseState {
  // 暂停期间剩余时间定格在「暂停那一刻」，而不是跟着真实时间继续掉
  const ref = a.paused_at ?? Date.now();
  return {
    paused: a.paused_at != null,
    pausedAt: a.paused_at,
    pausedTotalMs: a.paused_total_ms,
    deadlineAt: a.deadline_at,
    remainingSec: Math.max(0, Math.floor((a.deadline_at - ref) / 1000)),
    serverNow: Date.now(),
  };
}

/**
 * 暂停考试：计时停住，题目内容在服务端就被抹掉（不是前端遮一下而已）。
 * 恢复时把 deadline 按暂停时长往后顺延 —— 所以「暂停中不许超时判分」这条必须守住，
 * 否则暂停久了会被惰性判分直接判超时。
 */
export async function pauseAttempt(db: Db, attemptId: number, userId: number): Promise<PauseState> {
  const attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new HttpError(404, '答卷不存在');
  if (attempt.user_id !== userId) throw new HttpError(403, '无权操作此答卷');
  if (attempt.status !== 'in_progress') throw new HttpError(400, '答卷已结束');
  if (attempt.paused_at != null) return pauseStateOf(attempt);

  if (Date.now() > attempt.deadline_at) {
    await gradeAttempt(db, attemptId, 'timeout', 'expired');
    throw new HttpError(400, '已超过答题时间');
  }

  const now = Date.now();
  await db.updateTable('attempt').set({ paused_at: now }).where('id', '=', attemptId).execute();
  return pauseStateOf({ ...attempt, paused_at: now });
}

/** 恢复考试：deadline 顺延，累计暂停时长记账 */
export async function resumeAttempt(db: Db, attemptId: number, userId: number): Promise<PauseState> {
  const attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new HttpError(404, '答卷不存在');
  if (attempt.user_id !== userId) throw new HttpError(403, '无权操作此答卷');
  if (attempt.status !== 'in_progress') throw new HttpError(400, '答卷已结束');
  if (attempt.paused_at == null) return pauseStateOf(attempt);

  const now = Date.now();
  const delta = Math.max(0, now - attempt.paused_at);
  const deadlineAt = attempt.deadline_at + delta;
  const pausedTotalMs = attempt.paused_total_ms + delta;

  await db
    .updateTable('attempt')
    .set({ paused_at: null, deadline_at: deadlineAt, paused_total_ms: pausedTotalMs })
    .where('id', '=', attemptId)
    .execute();

  return {
    paused: false,
    pausedAt: null,
    pausedTotalMs,
    deadlineAt,
    remainingSec: Math.max(0, Math.floor((deadlineAt - now) / 1000)),
    serverNow: now,
  };
}

/** 题目标记：只影响自己这张卷子的答题卡，不参与判分 */
export async function setFlag(
  db: Db,
  attemptId: number,
  userId: number,
  questionId: number,
  flagged: boolean,
): Promise<{ flagged: boolean }> {
  const attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new HttpError(404, '答卷不存在');
  if (attempt.user_id !== userId) throw new HttpError(403, '无权操作此答卷');
  if (attempt.status !== 'in_progress') throw new HttpError(400, '答卷已结束');

  const item = await db
    .selectFrom('attempt_item')
    .select('id')
    .where('attempt_id', '=', attemptId)
    .where('question_id', '=', questionId)
    .executeTakeFirst();
  if (!item) throw new HttpError(404, '题目不在本答卷中');

  await db.updateTable('attempt_item').set({ flagged: flagged ? 1 : 0 }).where('id', '=', item.id).execute();
  return { flagged };
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
  if (attempt.paused_at != null) throw new HttpError(400, '试卷已暂停，请先点「继续答题」');
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
): Promise<{ count: number; autoSubmitted: boolean; ignored?: boolean }> {
  const attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new HttpError(404, '答卷不存在');
  if (attempt.user_id !== userId) throw new HttpError(403, '无权操作此答卷');
  if (attempt.status !== 'in_progress') return { count: 0, autoSubmitted: false };

  // 暂停中切窗口是正常的（学生可能就是想切出去），不记违规
  if (attempt.paused_at != null) {
    const c = Number(
      (await db
        .selectFrom('attempt_violation')
        .select((eb) => eb.fn.countAll().as('c'))
        .where('attempt_id', '=', attemptId)
        .executeTakeFirstOrThrow()).c,
    );
    return { count: c, autoSubmitted: false, ignored: true };
  }

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
  let attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new HttpError(404, '答卷不存在');
  if (attempt.user_id !== userId) throw new HttpError(403, '无权操作此答卷');
  if (attempt.status !== 'in_progress') throw new HttpError(400, '答卷已提交');

  // 暂停中交卷：先自动恢复（deadline 要跟着顺延）再判分，别让学生卡在暂停状态出不来
  if (attempt.paused_at != null) {
    await resumeAttempt(db, attemptId, userId);
    attempt = (await getAttempt(db, attemptId))!;
  }

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

  // 惰性判分：过期未交卷的在访问时补判。
  // 暂停中不判 —— 暂停期间 deadline 不动，直接判就会把"暂停久了"当成超时。
  if (attempt.status === 'in_progress' && attempt.paused_at == null && Date.now() > attempt.deadline_at) {
    await gradeAttempt(db, attemptId, 'timeout', 'expired');
  }

  const refreshed = (await getAttempt(db, attemptId))!;
  const paper = await db.selectFrom('paper').selectAll().where('id', '=', refreshed.paper_id).executeTakeFirst();
  const items = await db.selectFrom('attempt_item').selectAll().where('attempt_id', '=', attemptId).orderBy('order_no', 'asc').execute();

  const paused = refreshed.paused_at != null;
  // 试卷被暂停时，题面在服务端就抹掉 —— 前端只拿到空壳，扒 DOM 也看不到题
  const masked = paused && refreshed.status === 'in_progress';

  const questionIds = items.map((i) => i.question_id);
  const questions = masked || !questionIds.length ? [] : await db.selectFrom('question').selectAll().where('id', 'in', questionIds).execute();
  const qMap = new Map(questions.map((q) => [q.id, q]));
  const options =
    masked || !questionIds.length
      ? []
      : await db.selectFrom('question_option').selectAll().where('question_id', 'in', questionIds).execute();
  const optMap = new Map<number, { id: number; content: string; images: string | null; is_correct: number }[]>();
  for (const o of options) {
    if (!optMap.has(o.question_id)) optMap.set(o.question_id, []);
    optMap.get(o.question_id)!.push(o);
  }

  const reveal = !masked && (refreshed.status !== 'in_progress' || paper?.review_mode === 'immediate');

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
    paused,
    pausedAt: refreshed.paused_at,
    pausedTotalMs: refreshed.paused_total_ms,
    /** 服务端当前时间：前端据此校正本机时钟，倒计时才不会被考生机器的偏差带跑 */
    serverNow: Date.now(),
    items: items.map((item) => {
      const q = qMap.get(item.question_id);
      const opts = optMap.get(item.question_id) ?? [];
      const optionOrder: number[] = JSON.parse(item.option_order);
      const selected: number[] = item.selected ? JSON.parse(item.selected) : [];
      const optById = new Map(opts.map((o) => [o.id, o]));
      return {
        orderNo: item.order_no,
        questionId: item.question_id,
        // 暂停时这几项为空，题量/答题状态照常返回，答题卡还能显示
        type: q?.type,
        stem: q?.stem,
        images: parseImageList(q?.images),
        explanation: reveal ? (q?.explanation ?? null) : null,
        options: masked
          ? []
          : optionOrder.map((oid) => ({
              id: oid,
              content: optById.get(oid)?.content ?? '',
              images: parseImageList(optById.get(oid)?.images),
              isCorrect: reveal ? optById.get(oid)?.is_correct === 1 : null,
            })),
        selectedOptionIds: selected,
        flagged: item.flagged === 1,
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
