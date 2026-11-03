import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Config } from '../src/config.js';
import { createDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { buildApp, type AppContext } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';

export function testConfig(): Config {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 8080,
    DB_DRIVER: 'sqlite',
    SQLITE_PATH: ':memory:',
    UPLOAD_DIR: join(tmpdir(), 'liti-test-uploads'),
    SESSION_SECRET: 'test-secret-1234567890123456',
    SESSION_TTL_MS: 7 * 24 * 60 * 60 * 1000,
    AUTH_PROVIDERS: 'local',
  };
}

export async function createTestContext(): Promise<AppContext> {
  const config = testConfig();
  const db = createDb(config);
  await migrate(db);
  const ctx = await buildApp(db, config);
  await ctx.app.ready();
  return ctx;
}

export interface SeedUserInput {
  username: string;
  displayName: string;
  password: string;
  role: 'admin' | 'teacher' | 'student';
}

export async function seedUser(db: AppContext['db'], user: SeedUserInput): Promise<number> {
  const now = Date.now();
  await db
    .insertInto('user')
    .values({
      username: user.username,
      display_name: user.displayName,
      password_hash: await hashPassword(user.password),
      role: user.role,
      provider: 'local',
      external_id: null,
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    .execute();

  const row = await db
    .selectFrom('user')
    .select('id')
    .where('username', '=', user.username)
    .executeTakeFirstOrThrow();

  return row.id;
}
