import type { Generated } from 'kysely';

export type Role = 'admin' | 'teacher' | 'student';

export interface UserRow {
  id: Generated<number>;
  username: string;
  display_name: string;
  password_hash: string | null;
  role: Role;
  provider: 'local' | 'oidc';
  external_id: string | null;
  status: 'active' | 'disabled';
  prefs: string | null;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: Generated<number>;
  user_id: number;
  token_hash: string;
  expires_at: number;
  ip: string | null;
  ua: string | null;
  created_at: number;
}

export interface CategoryRow {
  id: Generated<number>;
  name: string;
  parent_id: number | null;
  sort: number;
  created_at: number;
}

export type QuestionType = 'single' | 'multiple';

export interface QuestionRow {
  id: Generated<number>;
  type: QuestionType;
  stem: string;
  explanation: string | null;
  category_id: number | null;
  difficulty: number;
  tags: string | null;
  status: 'active' | 'archived';
  content_hash: string;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

export interface QuestionOptionRow {
  id: Generated<number>;
  question_id: number;
  content: string;
  is_correct: number;
  sort_order: number;
}

export interface ImportBatchRow {
  id: Generated<number>;
  filename: string;
  total: number;
  success: number;
  failed: number;
  errors: string | null;
  created_by: number | null;
  created_at: number;
}

export type PaperMode = 'random' | 'fixed';
export type ReviewMode = 'after_submit' | 'immediate';
export type PaperStatus = 'draft' | 'published' | 'archived';

export interface PaperRow {
  id: Generated<number>;
  title: string;
  mode: PaperMode;
  question_count: number;
  duration_sec: number;
  pass_score: number;
  review_mode: ReviewMode;
  shuffle_options: number;
  random_config: string | null;
  status: PaperStatus;
  practice: number;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

export interface PaperItemRow {
  id: Generated<number>;
  paper_id: number;
  question_id: number;
  order_no: number;
  score: number;
}

export type AttemptStatus = 'in_progress' | 'submitted' | 'expired';

export interface AttemptRow {
  id: Generated<number>;
  paper_id: number;
  user_id: number;
  started_at: number;
  deadline_at: number;
  submitted_at: number | null;
  status: AttemptStatus;
  score: number;
  total_score: number;
  correct_count: number;
  submit_reason: string | null;
  created_at: number;
}

export interface AttemptItemRow {
  id: Generated<number>;
  attempt_id: number;
  question_id: number;
  order_no: number;
  option_order: string;
  selected: string | null;
  is_correct: number | null;
  score: number;
  answered_at: number | null;
}

export interface AttemptViolationRow {
  id: Generated<number>;
  attempt_id: number;
  type: string;
  occurred_at: number;
  meta: string | null;
}

export interface SettingRow {
  key: string;
  value: string;
  updated_at: number;
}

export interface Database {
  user: UserRow;
  session: SessionRow;
  category: CategoryRow;
  question: QuestionRow;
  question_option: QuestionOptionRow;
  import_batch: ImportBatchRow;
  paper: PaperRow;
  paper_item: PaperItemRow;
  attempt: AttemptRow;
  attempt_item: AttemptItemRow;
  attempt_violation: AttemptViolationRow;
  setting: SettingRow;
}
