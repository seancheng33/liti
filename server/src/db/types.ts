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

export interface Database {
  user: UserRow;
  session: SessionRow;
  category: CategoryRow;
  question: QuestionRow;
  question_option: QuestionOptionRow;
  import_batch: ImportBatchRow;
}
