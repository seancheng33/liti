import { createHash } from 'node:crypto';
import { sanitizeImageList } from '../media.js';

export type QuestionType = 'single' | 'multiple';

/** 题干最多配几张图 */
export const MAX_STEM_IMAGES = 6;
/** 每个选项最多配几张图 */
export const MAX_OPTION_IMAGES = 3;

export interface QuestionOptionInput {
  content: string;
  isCorrect: boolean;
  images?: string[];
}

export interface QuestionDraft {
  type: QuestionType;
  stem: string;
  images?: string[];
  explanation?: string | null;
  categoryId?: number | null;
  tags?: string[];
  options: QuestionOptionInput[];
}

export const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function normalizeStem(stem: string): string {
  return stem.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 宽松归一化：去掉所有空白与标点/符号，只保留文字、数字、汉字。
 * 用于「近似查重」——同一道题换个标点、多个空格都能认出来。
 */
export function normalizeLoose(stem: string): string {
  return stem
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[\p{P}\p{S}]/gu, '');
}

export function contentHash(stem: string): string {
  return createHash('sha256').update(normalizeStem(stem)).digest('hex');
}

/** 把原始入参里的图片地址清洗成安全、可入库的数组 */
export function normalizeDraftImages(draft: QuestionDraft): QuestionDraft {
  return {
    ...draft,
    images: sanitizeImageList(draft.images, MAX_STEM_IMAGES),
    options: draft.options.map((o) => ({
      ...o,
      images: sanitizeImageList(o.images, MAX_OPTION_IMAGES),
    })),
  };
}

export function validateQuestionDraft(d: QuestionDraft): string[] {
  const errors: string[] = [];

  const stemImages = d.images ?? [];
  if ((!d.stem || !d.stem.trim()) && stemImages.length === 0) {
    errors.push('题干不能为空（可以只放图片）');
  }
  if (d.type !== 'single' && d.type !== 'multiple') {
    errors.push('题型无效');
  }
  if (stemImages.length > MAX_STEM_IMAGES) {
    errors.push(`题干最多 ${MAX_STEM_IMAGES} 张图片`);
  }

  const options = Array.isArray(d.options) ? d.options : [];
  if (options.length < 2 || options.length > 6) {
    errors.push('选项数量须在 2–6 个之间（A–F）');
  } else {
    options.forEach((o, i) => {
      const hasText = !!(o.content && o.content.trim());
      const hasImage = !!(o.images && o.images.length);
      if (!hasText && !hasImage) {
        errors.push(`选项 ${OPTION_LABELS[i]} 内容不能为空`);
      }
      if ((o.images?.length ?? 0) > MAX_OPTION_IMAGES) {
        errors.push(`选项 ${OPTION_LABELS[i]} 最多 ${MAX_OPTION_IMAGES} 张图片`);
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

  return errors;
}
