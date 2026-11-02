import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './app.js';
import { closeExpiredAttempts } from './attempt/service.js';

/** 收卷扫描间隔：到点没交的答卷最多晚 30 秒被判掉，够用且不会打满数据库 */
const SWEEP_INTERVAL_MS = 30_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config);
  await migrate(db);
  const { app } = await buildApp(db, config);
  await app.listen({ host: config.HOST, port: config.PORT });

  // 统一收卷：考试到点（deadline_at 被 paper.end_at 截断）后，学生哪怕关了页面不回来，
  // 答卷也要被判成「超时交卷」。以前只靠访问时惰性判分，人一走就永远停在 in_progress。
  const sweep = () => {
    closeExpiredAttempts(db)
      .then((n) => {
        if (n > 0) app.log.info(`[sweeper] 自动收卷 ${n} 份`);
      })
      .catch((err) => app.log.error({ err }, '[sweeper] 自动收卷失败'));
  };
  sweep();
  // unref：定时器不阻止进程退出，容器 stop 时正常收尾（listen 之后再 addHook 会抛错，不能那么写）
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
