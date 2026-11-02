import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { loadPaperRoster } from '../paper/roster.js';

const LETTERS = 'ABCDEFGH';

/** 教育测量学里高/低分组的常规取法：各取 27% */
const GROUP_RATIO = 0.27;
/** 少于这个人数，前后 27% 各凑不满一组，D 值没有意义 */
const MIN_SAMPLE_FOR_D = 8;

export type QuestionVerdict = 'normal' | 'too-hard' | 'too-easy' | 'low-discrimination' | 'check-answer';

export interface OptionStat {
  id: number;
  /** 原始顺序的字母（A/B/C/D），与导入模板一致 */
  label: string;
  content: string;
  isCorrect: boolean;
  count: number;
  rate: number;
}

export interface QuestionAnalysis {
  orderNo: number;
  questionId: number;
  type: 'single' | 'multiple';
  stem: string;
  hasImage: boolean;
  categoryName: string | null;
  score: number;
  /** 作答题数（选了至少一个选项的答卷数） */
  answeredCount: number;
  /** 未作答（空白交卷）的答卷数 */
  blankCount: number;
  correctCount: number;
  /** P 值 = 答对人数 / 实考人数。未作答按「错了」计入分母，这是教育测量的通行口径 */
  pValue: number;
  /** 高分组（总分前 27%）的本题正确率 */
  highRate: number | null;
  /** 低分组（总分后 27%）的本题正确率 */
  lowRate: number | null;
  /** D 值 = 高分率 − 低分率。样本不足时为 null */
  discrimination: number | null;
  options: OptionStat[];
  flags: string[];
  verdict: QuestionVerdict;
}

export interface ScoreBucket {
  label: string;
  from: number;
  to: number;
  count: number;
}

export interface PaperAnalysis {
  paper: {
    id: number;
    title: string;
    questionCount: number;
    totalScore: number;
    passScore: number;
    perQuestionScore: number;
    startAt: number | null;
    endAt: number | null;
    status: string;
    audienceMode: string;
  };
  /** 按班分析时的班级；不分班为 null */
  className: string | null;
  summary: {
    rosterCount: number;
    /** 未按班筛选时的总应考人数，用来对照「本班 / 全场」 */
    rosterTotalCount: number;
    /** 实考人数（有已判分答卷的人） */
    participantCount: number;
    absentCount: number;
    /** 实考 / 应考 */
    participationRate: number;
    avgScore: number;
    maxScore: number;
    minScore: number;
    medianScore: number;
    stdDev: number;
    avgScorePercent: number;
    passCount: number;
    passRate: number;
    /** 平均用时（秒），已扣掉暂停时长 */
    avgDurationSec: number;
    reasonCounts: Record<string, number>;
    /** 切屏违规总次数与涉及人数 */
    violationTotal: number;
    violationStudents: number;
  };
  /** 高分 / 低分组各多少人，以及分组比例 */
  split: { highCount: number; lowCount: number; ratio: number; reliable: boolean };
  scoreBuckets: ScoreBucket[];
  questions: QuestionAnalysis[];
  /** 面向教务的提示，前端直接按顺序渲染成 Alert */
  warnings: string[];
}

function round(n: number, digits = 4): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function parseSelected(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  } catch {
    return [];
  }
}

/**
 * 逐题分析（P 值 / D 值 / 选项分布 / 分数段）。
 *
 * 口径上有三件事必须一致，否则数字会互相打架：
 *
 * 1. **只用已判分的答卷**（`submitted` / `expired`）。进行中的答卷没有分数，算进来会把平均分拉低。
 * 2. **每人取最近一次**，与成绩册同口径。补考的人如果两次都算，样本会凭空翻倍，
 *    P 值和 D 值都会被稀释。
 * 3. **P 值的分母是实考人数**，不是作答人数。学生空着不答也算这题没拿到分，
 *    如果分母只算「答了的人」，一张有人白卷的卷子会显得题目比实际简单。
 */
export async function analyzePaper(
  db: Db,
  paperId: number,
  opts: { className?: string } = {},
): Promise<PaperAnalysis> {
  const paper = await db.selectFrom('paper').selectAll().where('id', '=', paperId).executeTakeFirst();
  if (!paper) throw new HttpError(404, '试卷不存在');
  // 练习卷每人抽的题都不一样，横向比较没有意义
  if (paper.practice === 1) throw new HttpError(400, '练习卷每人的题目都不一样，无法做逐题分析');

  const rosterAll = await loadPaperRoster(db, paperId, paper.audience_mode);
  const classLabel = opts.className?.trim() || '';
  const roster = classLabel ? rosterAll.filter((u) => (u.class_name ?? '') === classLabel) : rosterAll;
  const rosterIds = new Set(roster.map((u) => u.id));

  // 每人取最近一次已判分答卷（升序遍历，后面覆盖前面）
  const gradedAttempts = await db
    .selectFrom('attempt')
    .selectAll()
    .where('paper_id', '=', paperId)
    .where('status', 'in', ['submitted', 'expired'])
    .orderBy('id', 'asc')
    .execute();
  const latest = new Map<number, (typeof gradedAttempts)[number]>();
  for (const a of gradedAttempts) latest.set(a.user_id, a);
  const sample = [...latest.values()].filter((a) => rosterIds.has(a.user_id));
  const sampleIds = sample.map((a) => a.id);
  const sampleCount = sample.length;

  const paperTotal = paper.question_count * paper.per_question_score;
  const totalScore = Math.max(paperTotal, ...sample.map((a) => a.total_score || 0));

  // ---- 分数分布 ----
  const scores = sample.map((a) => a.score).sort((a, b) => a - b);
  const sum = scores.reduce((s, v) => s + v, 0);
  const avgScore = sampleCount ? round(sum / sampleCount, 2) : 0;
  const medianScore = sampleCount
    ? sampleCount % 2 === 1
      ? scores[(sampleCount - 1) / 2]
      : round((scores[sampleCount / 2 - 1] + scores[sampleCount / 2]) / 2, 2)
    : 0;
  const variance = sampleCount ? scores.reduce((s, v) => s + (v - avgScore) ** 2, 0) / sampleCount : 0;
  const stdDev = round(Math.sqrt(variance), 2);
  const passCount = sample.filter((a) => a.score >= paper.pass_score).length;
  const durations = sample
    .map((a) => Math.max(0, (a.submitted_at ?? a.deadline_at) - a.started_at - a.paused_total_ms))
    .map((ms) => Math.round(ms / 1000));
  const avgDurationSec = sampleCount ? Math.round(durations.reduce((s, v) => s + v, 0) / sampleCount) : 0;

  const reasonCounts: Record<string, number> = { manual: 0, timeout: 0, violation: 0, forced: 0 };
  for (const a of sample) {
    const k = a.submit_reason ?? 'manual';
    reasonCounts[k] = (reasonCounts[k] ?? 0) + 1;
  }

  // ---- 切屏违规 ----
  const violRows = sampleIds.length
    ? await db
        .selectFrom('attempt_violation')
        .select(['attempt_id', (eb) => eb.fn.countAll().as('c')])
        .where('attempt_id', 'in', sampleIds)
        .groupBy('attempt_id')
        .execute()
    : [];
  const violationTotal = violRows.reduce((s, r) => s + Number(r.c), 0);
  const violationStudents = violRows.length;

  // ---- 分数段（按满分 10 等分） ----
  const bucketWidth = Math.max(1, Math.ceil(Math.max(1, totalScore) / 10));
  const buckets: ScoreBucket[] = [];
  for (let from = 0; from < Math.max(1, totalScore); from += bucketWidth) {
    // 最后一档直接顶到满分，否则满分的人会被归进「27–29」这种看起来装不下的区间
    const isLast = from + bucketWidth >= totalScore;
    const to = isLast ? Math.max(from, totalScore) : from + bucketWidth - 1;
    buckets.push({ label: `${from}–${to}`, from, to, count: 0 });
  }
  for (const s of scores) {
    const idx = Math.min(buckets.length - 1, Math.max(0, Math.floor(s / bucketWidth)));
    buckets[idx].count++;
  }

  // ---- 高低分组（D 值用） ----
  const sortedByScore = [...sample].sort((a, b) => b.score - a.score || a.id - b.id);
  const groupSize = Math.max(1, Math.round(sampleCount * GROUP_RATIO));
  const reliable = sampleCount >= MIN_SAMPLE_FOR_D;
  const highIds = new Set(sortedByScore.slice(0, groupSize).map((a) => a.id));
  const lowIds = new Set(sortedByScore.slice(sampleCount - groupSize).map((a) => a.id));

  // ---- 卷面题目 ----
  const paperItems = await db
    .selectFrom('paper_item')
    .innerJoin('question', 'question.id', 'paper_item.question_id')
    .leftJoin('category', 'category.id', 'question.category_id')
    .select([
      'paper_item.question_id as question_id',
      'paper_item.order_no as order_no',
      'paper_item.score as score',
      'question.stem as stem',
      'question.type as type',
      'question.images as images',
      'category.name as category_name',
    ])
    .where('paper_item.paper_id', '=', paperId)
    .orderBy('paper_item.order_no', 'asc')
    .execute();
  const questionIds = paperItems.map((i) => i.question_id);

  const optionRows = questionIds.length
    ? await db
        .selectFrom('question_option')
        .select(['id', 'question_id', 'content', 'is_correct', 'sort_order'])
        .where('question_id', 'in', questionIds)
        .orderBy('sort_order', 'asc')
        .execute()
    : [];

  const attemptItems = sampleIds.length
    ? await db
        .selectFrom('attempt_item')
        .select(['attempt_id', 'question_id', 'selected', 'is_correct'])
        .where('attempt_id', 'in', sampleIds)
        .execute()
    : [];

  // 按题聚合。注意 selected 存的是选项 ID：选项顺序是每次开考洗过的，
  // 但存的 ID 不受洗牌影响，所以按 ID 计数天然就是对的，不用还原顺序。
  type Agg = {
    correct: number;
    answered: number;
    blank: number;
    optionCounts: Map<number, number>;
    highDenom: number;
    highCorrect: number;
    lowDenom: number;
    lowCorrect: number;
  };
  const agg = new Map<number, Agg>();
  for (const it of attemptItems) {
    let a = agg.get(it.question_id);
    if (!a) {
      a = {
        correct: 0,
        answered: 0,
        blank: 0,
        optionCounts: new Map(),
        highDenom: 0,
        highCorrect: 0,
        lowDenom: 0,
        lowCorrect: 0,
      };
      agg.set(it.question_id, a);
    }
    const picked = parseSelected(it.selected);
    const isCorrect = it.is_correct === 1;
    if (picked.length === 0) a.blank++;
    else a.answered++;
    if (isCorrect) a.correct++;
    for (const id of picked) a.optionCounts.set(id, (a.optionCounts.get(id) ?? 0) + 1);
    if (highIds.has(it.attempt_id)) {
      a.highDenom++;
      if (isCorrect) a.highCorrect++;
    }
    if (lowIds.has(it.attempt_id)) {
      a.lowDenom++;
      if (isCorrect) a.lowCorrect++;
    }
  }

  const optionByQuestion = new Map<number, typeof optionRows>();
  for (const o of optionRows) {
    const list = optionByQuestion.get(o.question_id) ?? [];
    list.push(o);
    optionByQuestion.set(o.question_id, list);
  }

  const questions: QuestionAnalysis[] = paperItems.map((pi) => {
    const a = agg.get(pi.question_id);
    const correctCount = a?.correct ?? 0;
    const answeredCount = a?.answered ?? 0;
    const blankCount = a?.blank ?? 0;
    const pValue = sampleCount ? round(correctCount / sampleCount, 4) : 0;
    const highRate = reliable && a && a.highDenom ? round(a.highCorrect / a.highDenom, 4) : null;
    const lowRate = reliable && a && a.lowDenom ? round(a.lowCorrect / a.lowDenom, 4) : null;
    const discrimination = highRate != null && lowRate != null ? round(highRate - lowRate, 4) : null;

    const opts = (optionByQuestion.get(pi.question_id) ?? []).map((o, idx) => {
      const count = a?.optionCounts.get(o.id) ?? 0;
      return {
        id: o.id,
        label: LETTERS[idx] ?? String(idx + 1),
        content: o.content,
        isCorrect: o.is_correct === 1,
        count,
        rate: sampleCount ? round(count / sampleCount, 4) : 0,
      };
    });

    const flags: string[] = [];
    if (sampleCount && blankCount > 0 && blankCount === sampleCount) flags.push('全体未作答');
    else if (sampleCount && blankCount / sampleCount >= 0.2) flags.push(`未作答 ${blankCount} 人`);
    if (correctCount === 0 && sampleCount) flags.push('无人答对，先核对正确答案是否设反');
    if (sampleCount && pValue >= 0.999) flags.push('全部答对');
    if (discrimination != null && discrimination < 0) flags.push('D 值为负：低分组反而答得更好，怀疑答案有误');
    if (discrimination != null && discrimination >= 0 && discrimination < 0.2) flags.push('区分度低：好差学生答得差不多');

    let verdict: QuestionVerdict = 'normal';
    if (discrimination != null && discrimination < 0) verdict = 'check-answer';
    else if (sampleCount && pValue <= 0.1) verdict = 'too-hard';
    else if (sampleCount && pValue >= 0.95) verdict = 'too-easy';
    else if (discrimination != null && discrimination < 0.2) verdict = 'low-discrimination';
    else if (sampleCount && pValue < 0.3) verdict = 'too-hard';
    else if (sampleCount && pValue > 0.9) verdict = 'too-easy';

    return {
      orderNo: pi.order_no,
      questionId: pi.question_id,
      type: pi.type as 'single' | 'multiple',
      stem: pi.stem,
      hasImage: !!pi.images && pi.images !== '[]',
      categoryName: pi.category_name ?? null,
      score: pi.score,
      answeredCount,
      blankCount,
      correctCount,
      pValue,
      highRate,
      lowRate,
      discrimination,
      options: opts,
      flags,
      verdict,
    };
  });

  // ---- 面向教务的提示 ----
  const warnings: string[] = [];
  if (sampleCount === 0) {
    warnings.push(
      roster.length === 0
        ? '这份试卷还没有应考名单（可见范围为空），先去「发布」里指定学生或分组。'
        : '还没有已交卷的答卷。等考完再来看分析，进行中的答卷不计入统计。',
    );
  }
  if (sampleCount > 0 && sampleCount < MIN_SAMPLE_FOR_D) {
    warnings.push(`实考只有 ${sampleCount} 人，样本太小：P 值大体会跳，D 值仅供参考。`);
  }
  if (sampleCount > 0 && roster.length - sampleCount > 0) {
    warnings.push(`应考 ${roster.length} 人、实考 ${sampleCount} 人、缺考 ${roster.length - sampleCount} 人。分析只统计已交卷的答卷。`);
  }
  const reversed = questions.filter((q) => q.verdict === 'check-answer').map((q) => q.orderNo);
  if (reversed.length) {
    warnings.push(`第 ${reversed.join('、')} 题的 D 值为负，低分组反而答得更好 —— 大概率是正确答案标错了，务必核对。`);
  }
  const nobodyRight = questions.filter((q) => sampleCount > 0 && q.correctCount === 0).map((q) => q.orderNo);
  if (nobodyRight.length) warnings.push(`第 ${nobodyRight.join('、')} 题无人答对，先确认是不是答案设错了。`);
  const lowD = questions.filter((q) => q.discrimination != null && q.discrimination >= 0 && q.discrimination < 0.2);
  if (lowD.length) {
    warnings.push(`有 ${lowD.length} 道题区分度低于 0.2（第 ${lowD.map((q) => q.orderNo).join('、')} 题），好学生和差学生答得差不多，建议改写或换掉。`);
  }
  const tooEasy = questions.filter((q) => sampleCount > 0 && q.pValue >= 0.95);
  if (tooEasy.length) {
    warnings.push(`有 ${tooEasy.length} 道题正确率超过 95%，基本是送分题；如果它们本不该这么简单，注意是否泄题。`);
  }
  if (violationTotal > 0) {
    warnings.push(`本场共记录 ${violationTotal} 次切屏违规，涉及 ${violationStudents} 人。违规答卷要不要作废请按考场纪律处理。`);
  }

  return {
    paper: {
      id: paper.id,
      title: paper.title,
      questionCount: paper.question_count,
      totalScore,
      passScore: paper.pass_score,
      perQuestionScore: paper.per_question_score,
      startAt: paper.start_at ?? null,
      endAt: paper.end_at ?? null,
      status: paper.status,
      audienceMode: paper.audience_mode,
    },
    className: classLabel || null,
    summary: {
      rosterCount: roster.length,
      rosterTotalCount: rosterAll.length,
      participantCount: sampleCount,
      absentCount: roster.length - sampleCount,
      participationRate: roster.length ? round(sampleCount / roster.length, 4) : 0,
      avgScore,
      maxScore: sampleCount ? scores[sampleCount - 1] : 0,
      minScore: sampleCount ? scores[0] : 0,
      medianScore,
      stdDev,
      avgScorePercent: totalScore ? round((avgScore / totalScore) * 100, 1) : 0,
      passCount,
      passRate: sampleCount ? round(passCount / sampleCount, 4) : 0,
      avgDurationSec,
      reasonCounts,
      violationTotal,
      violationStudents,
    },
    split: { highCount: groupSize, lowCount: groupSize, ratio: GROUP_RATIO, reliable },
    scoreBuckets: buckets,
    questions,
    warnings,
  };
}
