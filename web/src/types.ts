export type Role = 'admin' | 'teacher' | 'student';

export interface AuthUser {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  status: string;
}

export interface QuestionOption {
  id?: number;
  content: string;
  isCorrect: boolean;
  sortOrder?: number;
}

export interface Question {
  id: number;
  type: 'single' | 'multiple';
  stem: string;
  explanation?: string | null;
  category_id?: number | null;
  difficulty: number;
  tags: string[];
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
  random_config?: unknown;
}

export interface AttemptOption {
  id: number;
  content: string;
  isCorrect: boolean | null;
}

export interface AttemptItem {
  orderNo: number;
  questionId: number;
  type?: string;
  stem?: string;
  explanation?: string | null;
  options: AttemptOption[];
  selectedOptionIds: number[];
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
  items: AttemptItem[];
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

export interface StatsOverview {
  questionCount: number;
  questionByType: { single: number; multiple: number };
  questionByDifficulty: { difficulty: number; count: number }[];
  categoryCount: number;
  paperCount: number;
  attemptCount: number;
  userCount: number;
  gradedCount: number;
  avgScorePercent: number;
  correctRate: number;
  correctByDifficulty: { difficulty: number; total: number; correct: number; rate: number }[];
}
