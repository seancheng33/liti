import { createHash } from 'node:crypto';

export type QuestionType = 'single' | 'multiple';

export interface QuestionOptionInput {
  content: string;
  isCorrect: boolean;
}

export interface QuestionDraft {
  type: QuestionType;
  stem: string;
  explanation?: string | null;
  categoryId?: number | null;
  difficulty?: number | null;
  tags?: string[];
  options: QuestionOptionInput[];
}

export const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function normalizeStem(stem: string): string {
  return stem.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function contentHash(stem: string): string {
  return createHash('sha256').update(normalizeStem(stem)).digest('hex');
}

export function validateQuestionDraft(d: QuestionDraft): string[] {
  const errors: string[] = [];

  if (!d.stem || !d.stem.trim()) {
    errors.push('题干不能为空');
  }
  if (d.type !== 'single' && d.type !== 'multiple') {
    errors.push('题型无效');
  }

  const options = Array.isArray(d.options) ? d.options : [];
  if (options.length < 2 || options.length > 6) {
    errors.push('选项数量须在 2–6 个之间（A–F）');
  } else {
    options.forEach((o, i) => {
      if (!o.content || !o.content.trim()) {
        errors.push(`选项 ${OPTION_LABELS[i]} 内容不能为空`);
      }
    });
    const correctCount = options.filter((o) => o.isCorrect).length;
    if (d.type === 'single' && correctCount !== 1) {
      errors.push('单选题必须有且仅有一个正确答案');
    }
    if (d.type === 'multiple' && correctCount < 2) {
      errors.push('多选题至少需要两个正确答案');
    }
  }

  if (d.difficulty != null && ![1, 2, 3].includes(d.difficulty)) {
    errors.push('难度须为 1/2/3');
  }

  return errors;
}
