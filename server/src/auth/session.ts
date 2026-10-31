import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/index.js';
import type { Role } from '../db/types.js';

export const SESSION_COOKIE_NAME = 'liti_session';

export interface SessionUser {
  sessionId: number;
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  status: string;
  prefs: string | null;
  expiresAt: number;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreateSessionInput {
  userId: number;
  ttlMs: number;
  ip?: string | null;
  ua?: string | null;
}

export async function createSession(
  db: Db,
  input: CreateSessionInput,
): Promise<{ id: number; token: string; expiresAt: number }> {
  const token = generateToken();
  const now = Date.now();
  const expiresAt = now + input.ttlMs;
  const tokenHash = sha256(token);

  await db
    .insertInto('session')
    .values({
      user_id: input.userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      ip: input.ip ?? null,
      ua: input.ua ?? null,
      created_at: now,
    })
    .execute();

  const row = await db
    .selectFrom('session')
    .select('id')
    .where('token_hash', '=', tokenHash)
    .executeTakeFirstOrThrow();

  return { id: row.id, token, expiresAt };
}

export async function getSessionByToken(db: Db, token: string): Promise<SessionUser | undefined> {
  const row = await db
    .selectFrom('session')
    .innerJoin('user', 'user.id', 'session.user_id')
    .select([
      'session.id as sessionId',
      'user.id as userId',
      'user.username as username',
      'user.display_name as displayName',
      'user.role as role',
      'user.status as status',
      'user.prefs as prefs',
      'session.expires_at as expiresAt',
    ])
    .where('session.token_hash', '=', sha256(token))
    .executeTakeFirst();

  return row;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.deleteFrom('session').where('token_hash', '=', sha256(token)).execute();
}

export async function deleteExpiredSessions(db: Db): Promise<void> {
  await db.deleteFrom('session').where('expires_at', '<=', Date.now()).execute();
}
