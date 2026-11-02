import type { Kysely } from 'kysely';

/**
 * v0.11 实时监考：让教师能看见「谁还坐在考场里」，并且能撤回误判的违规。
 *
 * 1. `attempt.last_seen_at` —— 学生端心跳时间戳。
 *    没有它，服务端只知道「这份卷子还在进行中」，分不清「学生正在答」和
 *    「学生浏览器崩了、人走了」。监考视图的核心就是这条时间戳。
 *    可空：老答卷没心跳过，显示为「未知」而不是「掉线」。
 *
 * 2. `attempt_violation.revoked_at / revoked_by / revoke_note` —— 违规可撤销。
 *    原来违规只进不出，一条误报（比如学生按了 F5、系统弹了输入法候选窗）
 *    就永久占掉三次额度里的一个。撤销是软撤销：行留着、标记谁在什么时候撤的，
 *    查历史时仍能看到「这里曾经记过一次，后来被撤销」。
 *
 * ⚠️ 幂等写法（同 0011）：MySQL 的 DDL 隐式提交、不在迁移事务里，
 * 半截失败重跑会撞 Duplicate column，先 introspection 查列再加。
 */
export async function up(db: Kysely<any>): Promise<void> {
  const tables = await db.introspection.getTables();
  const hasColumn = (table: string, column: string): boolean =>
    !!tables.find((t) => t.name === table)?.columns.some((c) => c.name === column);

  /** 最后一次心跳时间（毫秒）。null = 该答卷从未上报过心跳 */
  // ⚠️ 必须是 bigint 不是 integer：MySQL 的 INTEGER 是 32 位有符号（上限约 21 亿），
  // 而 Date.now() 是 13 位毫秒（约 1.79e12），用 integer 会直接
  // 「Out of range value for column 'last_seen_at'」。项目里所有时间戳都是 bigint。
  if (!hasColumn('attempt', 'last_seen_at')) {
    await db.schema.alterTable('attempt').addColumn('last_seen_at', 'bigint').execute();
  }

  /** 撤销时间。非空 = 这条违规已被教师撤销，不再计入次数 */
  if (!hasColumn('attempt_violation', 'revoked_at')) {
    await db.schema.alterTable('attempt_violation').addColumn('revoked_at', 'bigint').execute();
  }
  /** 撤销人（user.id） */
  if (!hasColumn('attempt_violation', 'revoked_by')) {
    await db.schema.alterTable('attempt_violation').addColumn('revoked_by', 'integer').execute();
  }
  /** 撤销理由，给事后复盘用 */
  if (!hasColumn('attempt_violation', 'revoke_note')) {
    await db.schema.alterTable('attempt_violation').addColumn('revoke_note', 'varchar(200)').execute();
  }

  // 监考页要按答卷拉违规明细，也得能一次算出「这场有几个违规的人」
  try {
    await db.schema.createIndex('idx_violation_attempt').on('attempt_violation').column('attempt_id').execute();
  } catch (e) {
    if (!/already exist|Duplicate key name/i.test((e as Error).message)) throw e;
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_violation_attempt').on('attempt_violation').execute();
  await db.schema.alterTable('attempt_violation').dropColumn('revoke_note').execute();
  await db.schema.alterTable('attempt_violation').dropColumn('revoked_by').execute();
  await db.schema.alterTable('attempt_violation').dropColumn('revoked_at').execute();
  await db.schema.alterTable('attempt').dropColumn('last_seen_at').execute();
}
