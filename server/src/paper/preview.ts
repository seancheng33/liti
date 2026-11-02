import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { parseImageList } from '../media.js';

/** 预览用选项：只给字母、文字、图片，**不含 is_correct** */
export interface PreviewOption {
  label: string;
  content: string;
  images: string[];
}

/** 预览用题目：这是「考生视角」，故意不含答案与解析 */
export interface PreviewItem {
  orderNo: number;
  questionId: number;
  type: string;
  typeLabel: string;
  stem: string;
  images: string[];
  options: PreviewOption[];
}

export interface PaperPreviewMeta {
  id?: number;
  title: string;
  questionCount: number;
  durationSec: number;
  passScore: number;
  reviewMode: string;
  shuffleOptions: boolean;
  /** 题序乱序：每个学生一份独立卷面顺序 */
  shuffleQuestions: boolean;
  status?: string;
  categories?: string[];
  /** 每题分值与总分：及格分是绝对分，没有总分就看不出 60 到底合不合理 */
  perQuestionScore?: number;
  totalScore?: number;
  startAt?: number | null;
  endAt?: number | null;
  /** 允许作答次数（练习卷不限，不显示） */
  maxAttempts?: number;
}

export interface PaperPreview extends PaperPreviewMeta {
  items: PreviewItem[];
}

const TYPE_LABEL: Record<string, string> = { single: '单选题', multiple: '多选题' };

/**
 * 按题号顺序组装预览题目。
 * 一次性把题目和选项捞出来（两条 SQL），避免逐题回表。
 */
export async function buildPreviewItems(db: Db, questionIds: number[]): Promise<Map<number, PreviewItem>> {
  const result = new Map<number, PreviewItem>();
  if (!questionIds.length) return result;

  const questions = await db
    .selectFrom('question')
    .select(['id', 'type', 'stem', 'images'])
    .where('id', 'in', questionIds)
    .execute();

  const options = await db
    .selectFrom('question_option')
    .select(['question_id', 'content', 'images', 'sort_order'])
    .where('question_id', 'in', questionIds)
    .orderBy('sort_order', 'asc')
    .execute();

  const optionMap = new Map<number, PreviewOption[]>();
  for (const o of options) {
    const list = optionMap.get(o.question_id) ?? [];
    list.push({
      label: String.fromCharCode(65 + list.length),
      content: o.content,
      images: parseImageList(o.images),
    });
    optionMap.set(o.question_id, list);
  }

  for (const q of questions) {
    result.set(q.id, {
      orderNo: 0,
      questionId: q.id,
      type: q.type,
      typeLabel: TYPE_LABEL[q.type] ?? q.type,
      stem: q.stem,
      images: parseImageList(q.images),
      options: optionMap.get(q.id) ?? [],
    });
  }
  return result;
}

/** 按题号数组生成预览题目（顺序即数组顺序） */
export async function previewItemsInOrder(db: Db, questionIds: number[]): Promise<PreviewItem[]> {
  const map = await buildPreviewItems(db, questionIds);
  const items: PreviewItem[] = [];
  questionIds.forEach((qid, index) => {
    const hit = map.get(qid);
    if (hit) items.push({ ...hit, orderNo: index + 1 });
  });
  return items;
}

/** 试卷涉及的分类名（去重、按出现顺序） */
async function paperCategoryNames(db: Db, paperId: number): Promise<string[]> {
  const rows = await db
    .selectFrom('paper_item')
    .innerJoin('question', 'question.id', 'paper_item.question_id')
    .leftJoin('category', 'category.id', 'question.category_id')
    .select(['category.name as name'])
    .where('paper_item.paper_id', '=', paperId)
    .execute();

  const seen = new Set<string>();
  const names: string[] = [];
  for (const r of rows) {
    const name = r.name ?? '未分类';
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** 按 paperId 生成完整预览（含题目） */
export async function previewPaperById(db: Db, paperId: number): Promise<PaperPreview> {
  const paper = await db.selectFrom('paper').selectAll().where('id', '=', paperId).executeTakeFirst();
  if (!paper) throw new HttpError(404, '试卷不存在');

  const items = await db
    .selectFrom('paper_item')
    .select(['question_id', 'order_no'])
    .where('paper_id', '=', paperId)
    .orderBy('order_no', 'asc')
    .execute();

  return {
    id: paper.id,
    title: paper.title,
    questionCount: items.length,
    durationSec: paper.duration_sec,
    passScore: paper.pass_score,
    reviewMode: paper.review_mode,
    shuffleOptions: paper.shuffle_options === 1,
    shuffleQuestions: paper.shuffle_questions === 1,
    status: paper.status,
    perQuestionScore: paper.per_question_score,
    maxAttempts: paper.max_attempts,
    totalScore: items.length * paper.per_question_score,
    startAt: paper.start_at,
    endAt: paper.end_at,
    categories: await paperCategoryNames(db, paperId),
    items: await previewItemsInOrder(db, items.map((i) => i.question_id)),
  };
}
