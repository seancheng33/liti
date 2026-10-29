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

export interface Database {
  user: UserRow;
  session: SessionRow;
}
