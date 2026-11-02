import type { Kysely, Selectable, Transaction } from 'kysely';
import type { Database, AttemptRow } from '../db/types.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { parseImageList } from '../media.js';
import { MAX_ATTEMPTS_PER_PAPER, paperVisibleTo, sampleQuestionIds, type SampleRule } from '../paper/service.js';
import { fisherYates, MAX_PAPER_QUESTIONS } from '../paper/validate.js';
import { recordCorrect, recordWrong, sampleWrongQuestionIds } from '../wrong/service.js';
import { countActiveViolations } from './proctor.js';

type AnyDb = Kysely<Database> | Transaction<Database>;

/** 只给报错文案用，不依赖 ICU：按服务端本地时区（容器里设了 TZ）格式化 */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

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
  if (paper.practice === 1) {
    // 练习卷是「个人卷」：只有创建者本人能答。否则别人拿到 paperId 就能开你的练习卷，
    // 而练习模式是逐题即时给答案的 —— 等于把答案白送出去。
    if (paper.created_by !== userId) throw new HttpError(404, '试卷不存在');
  } else if (!(await paperVisibleTo(db, paperId, userId))) {
    throw new HttpError(404, '试卷不存在');
  }

  // 考试时间窗口：没到点不能进，过点了不能进。
  // 提前点「开始答题」也不给开，否则先到的人等于多考了几十分钟。
  const nowMs = Date.now();
  if (paper.practice !== 1) {
    if (paper.start_at != null && nowMs < paper.start_at) {
      throw new HttpError(400, `考试还没开始（${fmtTime(paper.start_at)} 开考）`);
    }
    if (paper.end_at != null && nowMs >= paper.end_at) {
      throw new HttpError(400, '考试已经结束');
    }
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
    // 上限按卷配置：考试卷通常是 1（一场考试只给一次），练习卷不看这个值
    const limit = paper.max_attempts ?? MAX_ATTEMPTS_PER_PAPER;
    if (used >= limit) {
      throw new HttpError(400, `这份试卷最多可作答 ${limit} 次，你已用完 ${used} 次`);
    }
  }

  const totalScore = items.reduce((s, i) => s + i.score, 0);
  const now = nowMs;
  // 统一收卷：不管学生什么时候进来，deadline 都不能超过卷子的 end_at
  let deadlineAt = now + paper.duration_sec * 1000;
  if (paper.practice !== 1 && paper.end_at != null) deadlineAt = Math.min(deadlineAt, paper.end_at);
  if (deadlineAt <= now) throw new HttpError(400, '考试已经结束');

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
        // 开考即算「刚见过」：监考页在第一次心跳到达前就能显示在线，
        // 否则会出现短暂的「正在进行但从未上报心跳」
        last_seen_at: now,
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

export interface PracticeOptions {
  /** random=按分类随机抽（默认）；wrong=从本人错题库抽 */
  source?: 'random' | 'wrong';
  /** source=random 时用：可多条规则 */
  rules?: SampleRule[];
  /** source=wrong 时用：抽多少道 */
  count?: number;
  /** source=wrong 时用：只在某个分类的错题里抽 */
  categoryId?: number | null;
  durationSec?: number;
}

export async function startPractice(db: Db, userId: number, opts: PracticeOptions): Promise<number> {
  const source = opts.source === 'wrong' ? 'wrong' : 'random';
  const durationSec = opts.durationSec ?? 3600;

  let questionIds: number[];
  let title: string;
  let randomConfig: string | null = null;

  if (source === 'wrong') {
    const count = opts.count ?? 10;
    if (count < 1 || count > MAX_PAPER_QUESTIONS) {
      throw new HttpError(400, `题量须在 1–${MAX_PAPER_QUESTIONS} 之间`);
    }
    questionIds = await sampleWrongQuestionIds(db, userId, count, opts.categoryId ?? null);
    title = `错题练习（${questionIds.length} 题）`;
  } else {
    const rules: SampleRule[] = (opts.rules ?? []).map((r) => ({ categoryId: r.categoryId, count: r.count }));
    const total = rules.reduce((s, r) => s + r.count, 0);
    if (total < 1 || total > MAX_PAPER_QUESTIONS) {
      throw new HttpError(400, `题量须在 1–${MAX_PAPER_QUESTIONS} 之间`);
    }
    questionIds = await sampleQuestionIds(db, rules);
    title = `随机练习（${questionIds.length} 题）`;
    randomConfig = JSON.stringify(rules);
  }

  const now = Date.now();
  const deadlineAt = now + durationSec * 1000;

  return db.transaction().execute(async (trx) => {
    const paperRes = await trx
      .insertInto('paper')
      .values({
        title,
        mode: 'random',
        question_count: questionIds.length,
        duration_sec: durationSec,
        pass_score: 60,
        review_mode: 'immediate',
        shuffle_options: 1,
        random_config: randomConfig,
        status: 'draft',
        practice: 1,
        practice_source: source,
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
        last_seen_at: now,
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

async function gradeAttempt(
  db: Db,
  attemptId: number,
  reason: 'manual' | 'violation' | 'timeout' | 'forced',
  status: 'submitted' | 'expired',
): Promise<void> {
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
    const now = Date.now();
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

      // 顺手维护错题库：错题只在**判分之后**才写入，所以不存在提前看到答案的问题。
      // 没作答（selected 为空）也算错 —— 考试里空着就是不得分，进错题本很合理。
      if (ok) {
        await recordCorrect(trx, attempt.user_id, item.question_id, now);
      } else {
        await recordWrong(trx, attempt.user_id, item.question_id, attemptId, now);
      }
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

  // 考试卷关掉「学生自暂停」：能随时停表就等于能随时出去查资料。
  // 练习卷不受这个开关约束。
  const paper = await db
    .selectFrom('paper')
    .select(['practice', 'allow_student_pause'])
    .where('id', '=', attempt.paper_id)
    .executeTakeFirst();
  if (paper && paper.practice !== 1 && paper.allow_student_pause === 0) {
    throw new HttpError(400, '本场考试不允许自行暂停，如有特殊情况请联系监考老师');
  }

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

  await writeSelection(db, item.id, item.option_order, selectedOptionIds);
}

/** 把一组选项 id 过滤成本卷合法的选项后写库；单题保存与交卷快照共用 */
async function writeSelection(
  db: Db,
  attemptItemId: number,
  optionOrderJson: string,
  selectedOptionIds: number[],
): Promise<void> {
  const optionOrder: number[] = JSON.parse(optionOrderJson);
  const valid = new Set(optionOrder);
  const selected = [...new Set(selectedOptionIds)].filter((id) => valid.has(id));
  await db
    .updateTable('attempt_item')
    .set({ selected: JSON.stringify(selected), answered_at: Date.now() })
    .where('id', '=', attemptItemId)
    .execute();
}

/**
 * 交卷时随请求带来的答案快照。
 *
 * 为什么需要它：学生的网络可能在最后几分钟断掉，那几题的 PATCH 全失败了，
 * 前端本地却是有答案的。等网络恢复再补发已经来不及（考场收卷了）。所以交卷这一步
 * 顺带把「还没落盘的答案」写进去，一次请求解决问题。
 *
 * 只接受本卷内的题目，卷外的静默忽略 —— 交卷不能因为一条脏数据失败。
 * 返回实际写进去的条数，前端可据此确认快照有没有被吃掉。
 */
async function applyAnswerSnapshot(
  db: Db,
  attemptId: number,
  snapshot: { questionId: number; selectedOptionIds: number[] }[],
): Promise<number> {
  if (!snapshot.length) return 0;
  const items = await db.selectFrom('attempt_item').selectAll().where('attempt_id', '=', attemptId).execute();
  const byQuestion = new Map(items.map((it) => [it.question_id, it]));

  let applied = 0;
  for (const entry of snapshot) {
    const item = byQuestion.get(entry.questionId);
    if (!item) continue;
    await writeSelection(db, item.id, item.option_order, entry.selectedOptionIds);
    applied += 1;
  }
  return applied;
}

/**
 * 累计多少次违规自动强制交卷。
 * 注意统计的是「未撤销」的条数 —— 教师撤销一条误报后，学生就重新拥有一次额度。
 */
export const VIOLATION_LIMIT = 3;

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
    return { count: await countActiveViolations(db, attemptId), autoSubmitted: false, ignored: true };
  }

  await db.insertInto('attempt_violation').values({ attempt_id: attemptId, type, occurred_at: Date.now(), meta: null }).execute();

  const count = await countActiveViolations(db, attemptId);

  if (count >= VIOLATION_LIMIT) {
    await gradeAttempt(db, attemptId, 'violation', 'submitted');
    return { count, autoSubmitted: true };
  }
  return { count, autoSubmitted: false };
}

/**
 * 学生端心跳（v0.11）。
 *
 * 只做两件事：刷新 `last_seen_at`，把当前状态回给前端。前端拿到 `status`
 * 不是 `in_progress` 时就知道「我被强制交卷了 / 超时了」，不必等下一次操作才发现。
 *
 * 顺带承担惰性超时判分：心跳是学生页面唯一保证在跑的周期任务，
 * 到点直接判分比等 sweeper 的 30 秒窗口更及时。
 */
export async function heartbeatAttempt(
  db: Db,
  attemptId: number,
  userId: number,
): Promise<{
  status: 'in_progress' | 'submitted' | 'expired';
  serverNow: number;
  deadlineAt: number;
  remainingMs: number;
  paused: boolean;
  pausedSec: number;
  violations: number;
  violationLimit: number;
}> {
  let attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new HttpError(404, '答卷不存在');
  if (attempt.user_id !== userId) throw new HttpError(403, '无权操作此答卷');

  const now = Date.now();
  if (attempt.status === 'in_progress') {
    // 暂停中 deadline 还没顺延，此刻 now > deadline 是正常现象，不能判超时
    if (attempt.paused_at == null && now > attempt.deadline_at) {
      await gradeAttempt(db, attemptId, 'timeout', 'expired');
      attempt = (await getAttempt(db, attemptId))!;
    } else {
      await db.updateTable('attempt').set({ last_seen_at: now }).where('id', '=', attemptId).execute();
    }
  }

  const paused = attempt.status === 'in_progress' && attempt.paused_at != null;
  return {
    status: attempt.status,
    serverNow: now,
    deadlineAt: attempt.deadline_at,
    remainingMs: attempt.status === 'in_progress' ? Math.max(0, attempt.deadline_at - now) : 0,
    paused,
    pausedSec: paused ? Math.round((now - (attempt.paused_at as number)) / 1000) : 0,
    violations: await countActiveViolations(db, attemptId),
    violationLimit: VIOLATION_LIMIT,
  };
}

export async function submitAttempt(
  db: Db,
  attemptId: number,
  userId: number,
  snapshot: { questionId: number; selectedOptionIds: number[] }[] = [],
): Promise<{ applied: number }> {
  let attempt = await getAttempt(db, attemptId);
  if (!attempt) throw new HttpError(404, '答卷不存在');
  if (attempt.user_id !== userId) throw new HttpError(403, '无权操作此答卷');
  if (attempt.status !== 'in_progress') throw new HttpError(400, '答卷已提交');

  // 暂停中交卷：先自动恢复（deadline 要跟着顺延）再判分，别让学生卡在暂停状态出不来
  if (attempt.paused_at != null) {
    await resumeAttempt(db, attemptId, userId);
    attempt = (await getAttempt(db, attemptId))!;
  }

  // 先查超时再落快照：超时后不该再接受答案，否则「拖到最后一秒补答案」就成立了
  if (Date.now() > attempt.deadline_at) {
    await gradeAttempt(db, attemptId, 'timeout', 'expired');
    throw new HttpError(400, '已超过答题时间，自动交卷');
  }

  // 落快照必须在判分之前 —— 判分读的就是 attempt_item.selected
  const applied = await applyAnswerSnapshot(db, attemptId, snapshot);
  await gradeAttempt(db, attemptId, 'manual', 'submitted');
  return { applied };
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

  // 成绩与解析的公布是两件事：先放分、后放答案（或者只放分不放答案）。
  // review_mode='never' 的卷子，答案与解析永远不下发 —— 多场次考试全靠这个。
  const finished = refreshed.status !== 'in_progress';
  const resultsVisible = finished && paper?.results_published !== 0;
  const analysisVisible = finished && paper?.review_mode !== 'never' && paper?.analysis_published !== 0;
  const reveal = !masked && (analysisVisible || (!finished && paper?.review_mode === 'immediate'));

  return {
    id: refreshed.id,
    paperId: refreshed.paper_id,
    paperTitle: paper?.title,
    status: refreshed.status,
    startedAt: refreshed.started_at,
    deadlineAt: refreshed.deadline_at,
    submittedAt: refreshed.submitted_at,
    // 没公布成绩时连分数都不给：先交卷的人把分报出去，一样影响后面的场次
    score: resultsVisible ? refreshed.score : null,
    totalScore: resultsVisible ? refreshed.total_score : null,
    correctCount: resultsVisible ? refreshed.correct_count : null,
    passScore: paper?.pass_score ?? 60,
    resultsPublished: resultsVisible,
    analysisPublished: analysisVisible,
    /** 本场能不能自己点暂停（考试卷通常是 false） */
    allowPause: paper ? paper.practice === 1 || paper.allow_student_pause !== 0 : true,
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
        // 对错与得分同样属于「答案」，没公布解析时一律不给
        isCorrect: finished && analysisVisible ? item.is_correct === 1 : null,
        score: finished && analysisVisible ? item.score : null,
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
      'paper.results_published as results_published',
    ])
    .where('attempt.user_id', '=', userId)
    .orderBy('attempt.id', 'desc')
    .limit(ps)
    .offset((p - 1) * ps)
    .execute();
  // 「我的答卷」列表同样要守发布规则：老师还没放分，这里也不能报分
  return {
    total,
    items: items.map((r) => {
      const published = r.results_published !== 0 || r.status === 'in_progress';
      return {
        ...r,
        score: published ? r.score : null,
        correct_count: published ? r.correct_count : null,
      };
    }),
  };
}

/**
 * 后台扫描：把「已经到点但没交」的答卷判掉。
 *
 * 以前只有访问时才惰性判分 —— 学生关了浏览器不回来，答卷就永远停在 in_progress，
 * 成绩册里既不算交卷也不算缺考。统一收卷（paper.end_at）也依赖这个扫描。
 * 暂停中的不碰：暂停时 deadline 定格，不能当成超时。
 */
export async function closeExpiredAttempts(db: Db, limit = 200): Promise<number> {
  const rows = await db
    .selectFrom('attempt')
    .select('id')
    .where('status', '=', 'in_progress')
    .where('deadline_at', '<=', Date.now())
    .where('paused_at', 'is', null)
    .limit(limit)
    .execute();
  for (const r of rows) await gradeAttempt(db, r.id, 'timeout', 'expired');
  return rows.length;
}

/** 教师强制收卷：这份卷子上所有还在进行中的答卷立刻判分结束 */
export async function closePaperAttempts(db: Db, paperId: number): Promise<number> {
  const rows = await db
    .selectFrom('attempt')
    .select('id')
    .where('paper_id', '=', paperId)
    .where('status', '=', 'in_progress')
    .execute();
  for (const r of rows) await gradeAttempt(db, r.id, 'forced', 'submitted');
  return rows.length;
}
