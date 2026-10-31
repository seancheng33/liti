export type Role = 'admin' | 'teacher' | 'student';

export interface AuthUser {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  status: string;
  theme?: string;
}

export interface QuestionOption {
  id?: number;
  content: string;
  images?: string[];
  isCorrect: boolean;
  sortOrder?: number;
}

export interface Question {
  id: number;
  type: 'single' | 'multiple';
  stem: string;
  images?: string[];
  explanation?: string | null;
  category_id?: number | null;
  tags?: string[];
  status: string;
  options?: QuestionOption[];
  option_count?: number;
  created_at: number;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  sort: number;
}

/** 随机抽题规则：从某个分类（留空 = 整个题库）抽 N 题 */
export interface PaperRule {
  categoryId?: number | null;
  count: number;
}

export interface Paper {
  id: number;
  title: string;
  mode: 'random' | 'fixed';
  question_count: number;
  duration_sec: number;
  pass_score: number;
  review_mode: 'after_submit' | 'immediate';
  shuffle_options: number;
  status: 'draft' | 'published' | 'archived';
  audience_mode?: 'all' | 'selected';
  audience_user_ids?: number[];
  /** 指定可见的学生人数（列表用） */
  audience_count?: number;
  random_config?: PaperRule[] | null;
  /** 学生视角：已作答次数 / 剩余次数（教师/管理员看不到这两项） */
  attempt_count?: number;
  remaining_attempts?: number;
}

/** 每个学生最多可作答次数（练习卷不受限） */
export const MAX_ATTEMPTS_PER_PAPER = 3;

export interface AttemptOption {
  id: number;
  content: string;
  images?: string[];
  isCorrect: boolean | null;
}

export interface AttemptItem {
  orderNo: number;
  questionId: number;
  type?: string;
  stem?: string;
  images?: string[];
  explanation?: string | null;
  options: AttemptOption[];
  selectedOptionIds: number[];
  /** 是否被考生标了「稍后再看」 */
  flagged?: boolean;
  isCorrect: boolean | null;
  score: number | null;
}

export interface AttemptReview {
  id: number;
  paperId: number;
  paperTitle?: string;
  status: string;
  startedAt: number;
  deadlineAt: number;
  submittedAt: number | null;
  score: number;
  totalScore: number;
  correctCount: number;
  submitReason: string | null;
  reviewMode?: string;
  /** 考试暂停中（题面已被服务端屏蔽） */
  paused?: boolean;
  pausedAt?: number | null;
  pausedTotalMs?: number;
  /** 服务端返回时刻，用于校正本机时钟（倒计时不受考生电脑时间影响） */
  serverNow?: number;
  items: AttemptItem[];
}

/** 发布试卷时可选择的学生 */
export interface StudentOption {
  id: number;
  username: string;
  displayName: string;
}

export interface AttemptSummary {
  id: number;
  paper_id: number;
  status: string;
  score: number;
  total_score: number;
  correct_count: number;
  started_at: number;
  deadline_at: number;
  submitted_at: number | null;
  submit_reason: string | null;
  paper_title: string;
  question_count: number;
}

export interface SiteSettings {
  siteName: string;
  siteAnnouncement: string;
  defaultDurationSec: number;
  defaultPassScore: number;
  practiceEnabled: boolean;
}

/* ---------- 首页（公开接口） ---------- */

export interface PublicOverview {
  siteName: string;
  siteAnnouncement: string;
  practiceEnabled: boolean;
  stats: {
    questionCount: number;
    categoryCount: number;
    paperCount: number;
    paperTotal: number;
    attemptCount: number;
    userCount: number;
  };
}

/** 首页试卷卡片用的精简信息 */
export interface PublicPaper {
  id: number;
  title: string;
  questionCount: number;
  durationSec: number;
  passScore: number;
  reviewMode: string;
  shuffleOptions: boolean;
  createdAt: number;
}

/* ---------- 试卷预览（考生视角，不含答案） ---------- */

export interface PreviewOption {
  label: string;
  content: string;
  images: string[];
}

export interface PreviewItem {
  orderNo: number;
  questionId: number;
  type: string;
  typeLabel: string;
  stem: string;
  images: string[];
  options: PreviewOption[];
}

export interface PaperPreview {
  id?: number;
  title: string;
  questionCount: number;
  durationSec: number;
  passScore: number;
  reviewMode: string;
  shuffleOptions: boolean;
  status?: string;
  categories?: string[];
  items: PreviewItem[];
}

export interface StatsOverview {
  questionCount: number;
  questionByType: { single: number; multiple: number };
  categoryCount: number;
  paperCount: number;
  attemptCount: number;
  userCount: number;
  gradedCount: number;
  avgScorePercent: number;
  correctRate: number;
  correctByCategory: { category: string; total: number; correct: number; rate: number }[];
}

/** 交卷原因 → 中文文案（后端存 manual / timeout / violation） */
export const SUBMIT_REASON_LABEL: Record<string, string> = {
  manual: '正常交卷',
  timeout: '异常：超时交卷',
  violation: '异常：违规强制交卷',
};

export function submitReasonText(reason?: string | null): string {
  if (!reason) return '-';
  return SUBMIT_REASON_LABEL[reason] ?? reason;
}

export const STATUS_LABEL: Record<string, string> = {
  in_progress: '进行中',
  submitted: '已交卷',
  expired: '已超时',
};

export const PAPER_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

export const AUDIENCE_LABEL: Record<string, string> = {
  all: '所有学生',
  selected: '指定学生',
};
