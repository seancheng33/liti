import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './app.js';
import { closeExpiredAttempts } from './attempt/service.js';
import { writeAudit, SYSTEM_ACTOR } from './audit/service.js';
import { resetDemoData } from './demo/seed.js';

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
      .then(async (n) => {
        if (n > 0) {
          app.log.info(`[sweeper] 自动收卷 ${n} 份`);
          // 无人操作但改了成绩的动作也要进审计：学生来问「我没交怎么会是超时」时，
          // 这条记录能说清是系统在什么时间点收的
          await writeAudit(db, {
            actor: SYSTEM_ACTOR,
            action: 'attempt.auto-close',
            targetType: 'attempt',
            targetLabel: `自动收卷 ${n} 份`,
            detail: { closed: n },
          });
        }
      })
      .catch((err) => app.log.error({ err }, '[sweeper] 自动收卷失败'));
  };
  sweep();
  // unref：定时器不阻止进程退出，容器 stop 时正常收尾（listen 之后再 addHook 会抛错，不能那么写）
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref();

  // 演示站：每小时把数据还原一次。
  // 放在进程内而不是宿主机 cron，是为了让「拿到 compose 文件就能跑」成立 ——
  // 不需要用户再去配一条定时任务。代价是重置会清掉 session，正在体验的人会被踢回登录页，
  // 所以登录页留了一键入口，重新点一下就回来了。
  if (config.DEMO_MODE) {
    const DEMO_RESET_INTERVAL_MS = 60 * 60 * 1000;
    const demoTimer = setInterval(() => {
      resetDemoData(db)
        .then((r) => app.log.info(`[demo] 定时还原完成：${r.questions} 题 / ${r.attempts} 份答卷`))
        .catch((err) => app.log.error({ err }, '[demo] 定时还原失败'));
    }, DEMO_RESET_INTERVAL_MS);
    demoTimer.unref();
    app.log.info(`[demo] 演示模式已开启，每 ${DEMO_RESET_INTERVAL_MS / 60000} 分钟还原一次数据`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
