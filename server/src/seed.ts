import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { hashPassword } from './auth/password.js';
import type { Role } from './db/types.js';

const seedUsers: { username: string; displayName: string; password: string; role: Role }[] = [
  { username: 'admin', displayName: '管理员', password: 'admin123', role: 'admin' },
  { username: 'teacher', displayName: '教师', password: 'teacher123', role: 'teacher' },
  { username: 'student', displayName: '学生', password: 'student123', role: 'student' },
];

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config);
  await migrate(db);

  const now = Date.now();
  for (const u of seedUsers) {
    const existing = await db
      .selectFrom('user')
      .select('id')
      .where('username', '=', u.username)
      .executeTakeFirst();

    if (existing) {
      console.log(`已存在用户 ${u.username}，跳过`);
      continue;
    }

    await db
      .insertInto('user')
      .values({
        username: u.username,
        display_name: u.displayName,
        password_hash: await hashPassword(u.password),
        role: u.role,
        provider: 'local',
        external_id: null,
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      .execute();

    console.log(`已创建用户 ${u.username}（${u.role}），密码：${u.password}`);
  }

  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
