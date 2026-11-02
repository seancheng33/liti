import type { ColumnType, Generated } from 'kysely';

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
  /** 学号，同一部署内唯一；教师/管理员为 null（插入时可省略） */
  student_no: ColumnType<string | null, string | null | undefined, string | null>;
  /** 班级名，自由文本；按班导出成绩与汇总靠它（插入时可省略） */
  class_name: ColumnType<string | null, string | null | undefined, string | null>;
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
/** never = 交卷后也不公布答案与解析（多场次考试必须用它，否则第一场考完就泄题） */
export type ReviewMode = 'after_submit' | 'immediate' | 'never';
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
  /**
   * 1 = 每个学生拿到的**题目顺序**不同（开考那一刻定下，写进 attempt_item.order_no）。
   * 与 shuffle_options 不同，这个默认 0：题序变了会让「第 3 题」在师生之间指代不同。
   */
  shuffle_questions: ColumnType<number, number | undefined, number>;
  random_config: string | null;
  status: PaperStatus;
  practice: number;
  /** 练习卷的来源：random=随机练习，wrong=错题练习；普通试卷为 null（插入时可省略） */
  practice_source: ColumnType<'random' | 'wrong' | null, 'random' | 'wrong' | null | undefined, 'random' | 'wrong' | null>;
  audience_mode: AudienceMode;
  /** 允许开考的时间，NULL = 随时可考 */
  start_at: ColumnType<number | null, number | null | undefined, number | null>;
  /** 统一收卷时间，NULL = 不限制；开考时 deadline 会按它截断 */
  end_at: ColumnType<number | null, number | null | undefined, number | null>;
  /** 1 = 学生可自行暂停（练习语义）；0 = 考试卷，学生不能停表 */
  allow_student_pause: ColumnType<number, number | undefined, number>;
  /** 每题分值，总分 = question_count × per_question_score */
  per_question_score: ColumnType<number, number | undefined, number>;
  /** 学生交卷后能否看到分数；0 = 等老师统一公布 */
  results_published: ColumnType<number, number | undefined, number>;
  /** 学生能否看到正确答案与解析；0 = 只出分不出答案 */
  analysis_published: ColumnType<number, number | undefined, number>;
  /** 每份试卷允许作答的次数；练习卷（practice=1）不看这个值 */
  max_attempts: ColumnType<number, number | undefined, number>;
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

/** 可见范围里的「整个分组」—— 分组是活的，成员变了这份卷子的可见范围跟着变 */
export interface PaperAudienceGroupRow {
  id: Generated<number>;
  paper_id: number;
  group_id: number;
  created_at: number;
}

export interface StudentGroupRow {
  id: Generated<number>;
  name: string;
  remark: string | null;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

export interface StudentGroupMemberRow {
  id: Generated<number>;
  group_id: number;
  user_id: number;
  created_at: number;
}

/**
 * 错题库：每人一份，靠 user_id 隔离。
 * 答错累加 wrong_count；答对把 resolved_at 置上（"已订正"），记录不删。
 */
export interface WrongQuestionRow {
  id: Generated<number>;
  user_id: number;
  question_id: number;
  wrong_count: number;
  first_wrong_at: number;
  last_wrong_at: number;
  last_attempt_id: number | null;
  resolved_at: number | null;
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
  /** 非空 = 当前正在暂停；恢复时按「now - paused_at」把 deadline 往后顺延 */
  paused_at: number | null;
  /** 累计暂停时长（毫秒），只用于展示 */
  paused_total_ms: number;
  /** 最后一次学生端心跳（毫秒）。null = 从没上报过，监考视图显示「未知」而不是「掉线」 */
  last_seen_at: ColumnType<number | null, number | null | undefined, number | null>;
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
  /** 非空 = 该条已被教师撤销，不再计入违规次数（软撤销，记录保留） */
  revoked_at: ColumnType<number | null, number | null | undefined, number | null>;
  /** 撤销人 user.id */
  revoked_by: ColumnType<number | null, number | null | undefined, number | null>;
  /** 撤销理由 */
  revoke_note: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface SettingRow {
  key: string;
  value: string;
  updated_at: number;
}

/**
 * 审计日志：谁在什么时候对什么东西做了什么。
 *
 * actor_name / actor_role / target_label 都是**写入时的快照**，
 * 不靠 join 现查——用户改名或被删之后，日志仍要能读懂当时发生了什么。
 */
export interface AuditLogRow {
  id: Generated<number>;
  at: number;
  /** 操作人；系统动作（自动收卷等）为 null */
  actor_id: number | null;
  actor_name: string;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: number | null;
  target_label: string | null;
  detail: string | null;
  ip: string | null;
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
  paper_audience_group: PaperAudienceGroupRow;
  student_group: StudentGroupRow;
  student_group_member: StudentGroupMemberRow;
  attempt: AttemptRow;
  attempt_item: AttemptItemRow;
  attempt_violation: AttemptViolationRow;
  wrong_question: WrongQuestionRow;
  setting: SettingRow;
  audit_log: AuditLogRow;
}
