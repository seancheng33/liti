/**
 * 命令行入口：把演示数据重置一遍。
 *
 * 容器启动时跑它（`node server/dist/demo/cli.js && node server/dist/server.js`），
 * 也可以手动 `docker restart` 之后由 compose 的 command 触发。
 *
 * 加了一道 DEMO_MODE 检查：这个脚本会清空全部业务表，
 * 在一台正经部署的机器上误跑一次就是事故，所以宁可它拒绝执行。
 */
import { mkdirSync, rmSync } from 'node:fs';
import { loadConfig } from '../config.js';
import { createDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { resolveUploadDir } from '../media.js';
import { resetDemoData } from './seed.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.DEMO_MODE) {
    console.error('DEMO_MODE 未开启（应为 "1"），拒绝重置。这是防止在生产库上误跑。');
    process.exit(1);
  }

  const startedAt = Date.now();
  const db = createDb(config);
  await migrate(db);
  const result = await resetDemoData(db);
  await db.destroy();

  // 题目配图也一起清掉：不清的话，访客每传一张图就永久占一份磁盘，
  // 演示站挂在公网上，几个月下来能把小机器的盘塞满。
  const uploadRoot = resolveUploadDir(config.UPLOAD_DIR);
  rmSync(uploadRoot, { recursive: true, force: true });
  mkdirSync(uploadRoot, { recursive: true });

  console.log(
    `[demo] 演示数据已重置：${result.users} 个账号、${result.questions} 道题、`
    + `${result.papers} 张试卷、${result.attempts} 份答卷，耗时 ${Date.now() - startedAt}ms`,
  );
}

main().catch((err) => {
  console.error('[demo] 重置失败：', err);
  process.exit(1);
});
