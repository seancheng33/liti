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
  /** 题干配图，JSON 数组字符串，元素为 /uploads/... 相对地址 */
  images: string | null;
  explanation: string | null;
  category_id: number | null;
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
  /** 选项配图，JSON 数组字符串 */
  images: string | null;
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
/** all = 所有学生可见；selected = 只对 paper_audience 白名单里的学生可见 */
export type AudienceMode = 'all' | 'selected';

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
  audience_mode: AudienceMode;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

export interface PaperAudienceRow {
  id: Generated<number>;
  paper_id: number;
  user_id: number;
  created_at: number;
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
  /** 非空 = 当前正在暂停；恢复时按「now - paused_at」把 deadline 往后顺延 */
  paused_at: number | null;
  /** 累计暂停时长（毫秒），只用于展示 */
  paused_total_ms: number;
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
  /** 1 = 考生标记了「稍后再看」 */
  flagged: number;
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
  paper_audience: PaperAudienceRow;
  attempt: AttemptRow;
  attempt_item: AttemptItemRow;
  attempt_violation: AttemptViolationRow;
  setting: SettingRow;
}
