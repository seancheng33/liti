import type { ReviewMode } from '../db/types.js';

export interface RandomRule {
  categoryId?: number | null;
  difficulty?: number | null;
  count: number;
}

export interface PaperInput {
  title: string;
  mode: 'random' | 'fixed';
  durationSec: number;
  passScore?: number;
  reviewMode?: ReviewMode;
  shuffleOptions?: boolean;
  randomRules?: RandomRule[];
  questionIds?: number[];
}

export const MAX_PAPER_QUESTIONS = 100;

export function validatePaperInput(input: PaperInput): string[] {
  const errors: string[] = [];
  if (!input.title || !input.title.trim()) errors.push('试卷标题不能为空');
  if (input.mode !== 'random' && input.mode !== 'fixed') errors.push('组卷方式无效');
  if (!input.durationSec || input.durationSec < 1) errors.push('考试时长必须大于 0 秒');

  if (input.mode === 'random') {
    const rules = input.randomRules ?? [];
    const total = rules.reduce((s, r) => s + (r.count || 0), 0);
    if (total < 1 || total > MAX_PAPER_QUESTIONS) {
      errors.push(`题量须在 1–${MAX_PAPER_QUESTIONS} 之间`);
    }
    for (const r of rules) {
      if (!r.count || r.count < 1) errors.push('每个抽题规则的数量必须大于 0');
    }
  } else {
    const ids = input.questionIds ?? [];
    if (ids.length < 1 || ids.length > MAX_PAPER_QUESTIONS) {
      errors.push(`题量须在 1–${MAX_PAPER_QUESTIONS} 之间`);
    }
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
