import type { AudienceMode, ReviewMode } from '../db/types.js';

export interface RandomRule {
  categoryId?: number | null;
  count: number;
}

export interface PaperInput {
  title: string;
  mode: 'random' | 'fixed';
  durationSec: number;
  passScore?: number;
  reviewMode?: ReviewMode;
  shuffleOptions?: boolean;
  /**
   * 是否打乱**题目顺序**（每个学生一份独立卷面），默认 false。
   * 与 shuffleOptions 的默认开相反 —— 题序变了，「第几题」在师生之间就对不上，
   * 得是老师知情的选择。
   */
  shuffleQuestions?: boolean;
  randomRules?: RandomRule[];
  questionIds?: number[];
  /** all = 所有学生可见（默认）；selected = 只给 audienceUserIds 里的学生 + audienceGroupIds 里的分组看 */
  audienceMode?: AudienceMode;
  audienceUserIds?: number[];
  audienceGroupIds?: number[];
  /** 允许开考的时间（毫秒时间戳），不传 = 随时可考 */
  startAt?: number | null;
  /** 统一收卷时间，不传 = 按各自时长 */
  endAt?: number | null;
  /** 每题分值（1–100），默认 1；总分 = 题数 × 该值 */
  perQuestionScore?: number;
  /** 是否允许学生自行暂停，默认允许；正式考试应传 false */
  allowStudentPause?: boolean;
  /** 交卷后是否立即公布分数，默认公布；正式考试应传 false，由老师统一放分 */
  resultsPublished?: boolean;
  /** 是否公布答案与解析，默认公布 */
  analysisPublished?: boolean;
  /** 每份试卷允许作答的次数（1–99），默认 3；正式考试通常设 1 */
  maxAttempts?: number;
}

export const MAX_PAPER_QUESTIONS = 100;
/** 单题分值上限与总分上限（100 题 × 100 分 = 10000） */
export const MAX_PER_QUESTION_SCORE = 100;
export const MAX_TOTAL_SCORE = MAX_PAPER_QUESTIONS * MAX_PER_QUESTION_SCORE;
/** 单卷作答次数上限（99 次够宽松了，再大说明该用练习卷） */
export const MAX_ATTEMPT_LIMIT = 99;

export function validatePaperInput(input: PaperInput): string[] {
  const errors: string[] = [];
  if (!input.title || !input.title.trim()) errors.push('试卷标题不能为空');
  if (input.mode !== 'random' && input.mode !== 'fixed') errors.push('组卷方式无效');
  if (!input.durationSec || input.durationSec < 1) errors.push('考试时长必须大于 0 秒');

  if (input.perQuestionScore != null) {
    if (!Number.isInteger(input.perQuestionScore) || input.perQuestionScore < 1 || input.perQuestionScore > MAX_PER_QUESTION_SCORE) {
      errors.push(`每题分值须为 1–${MAX_PER_QUESTION_SCORE} 的整数`);
    }
  }

  if (input.maxAttempts != null) {
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > MAX_ATTEMPT_LIMIT) {
      errors.push(`作答次数须为 1–${MAX_ATTEMPT_LIMIT} 的整数`);
    }
  }

  // 时间窗口：必须 start < end，且结束时间不能是过去
  const { startAt, endAt } = input;
  if (startAt != null && (!Number.isFinite(startAt) || startAt <= 0)) errors.push('开考时间无效');
  if (endAt != null && (!Number.isFinite(endAt) || endAt <= 0)) errors.push('结束时间无效');
  if (startAt != null && endAt != null && startAt >= endAt) errors.push('开考时间必须早于结束时间');
  if (endAt != null && endAt <= Date.now()) errors.push('结束时间已经过去了，请重新选择');

  // 题量与及格线：题量决定总分，及格分不能超过总分 —— 否则「永远不及格」这种配置会被悄悄存进去
  let count = 0;
  if (input.mode === 'random') {
    const rules = input.randomRules ?? [];
    count = rules.reduce((s, r) => s + (r.count || 0), 0);
    if (count < 1 || count > MAX_PAPER_QUESTIONS) {
      errors.push(`题量须在 1–${MAX_PAPER_QUESTIONS} 之间`);
    }
    for (const r of rules) {
      if (!r.count || r.count < 1) errors.push('每个抽题规则的数量必须大于 0');
    }
  } else {
    count = (input.questionIds ?? []).length;
    if (count < 1 || count > MAX_PAPER_QUESTIONS) {
      errors.push(`题量须在 1–${MAX_PAPER_QUESTIONS} 之间`);
    }
  }

  if (count > 0) {
    const totalScore = count * (input.perQuestionScore ?? 1);
    // 只在「显式设置了分值体系」时硬校验：老调用方（不传 perQuestionScore）沿用 1 分/题的历史口径，
    // 那时及格分本来就是个展示值，直接拒绝会把历史流程全打断。
    if (input.perQuestionScore != null && input.passScore != null && input.passScore > totalScore) {
      errors.push(`及格分（${input.passScore}）不能超过试卷总分（${totalScore}）`);
    }
  }

  if (input.audienceMode === 'selected' && !(input.audienceUserIds ?? []).length && !(input.audienceGroupIds ?? []).length) {
    errors.push('选择「指定学生」时至少要勾一个学生或一个分组');
  }
  return errors;
}

export function fisherYates<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
