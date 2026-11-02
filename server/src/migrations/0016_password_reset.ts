import type { Kysely } from 'kysely';

/**
 * v0.14 找回密码 —— 教师/管理员签发的一次性重置码。
 *
 * 自托管环境没有 SMTP，发不了邮件验证码，所以走「老师签发码、学生登录取码设新密码」：
 * - 学生锁死密码后不用干等后台改，自己就能解开；
 * - 码是一次性的、有时效（30 分钟），且同一学生同时只认最新签发的那一条；
 * - 表里只存哈希，明文码只在签发接口的响应里出现一次，不落库、不进日志。
 *
 * `expires_at` / `used_at` / `created_at` 都是 bigint（沿用 v0.11 的教训：MySQL 的
 * INTEGER 装不下 13 位毫秒时间戳）。
 *
 * 幂等：MySQL 的 DDL 隐式提交、不在迁移事务里，半截失败重跑会撞 Table already exists。
 */
export async function up(db: Kysely<any>): Promise<void> {
  const tables = await db.introspection.getTables();
  const exists = (name: string): boolean => !!tables.find((t) => t.name === name);

  if (!exists('password_reset')) {
    await db.schema
      .createTable('password_reset')
      .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
      /** 重置码所属账号 */
      .addColumn('user_id', 'integer', (col) => col.notNull())
      /** 重置码哈希（sha256），明文只在签发响应里出现一次 */
      .addColumn('token_hash', 'varchar(255)', (col) => col.notNull())
      /** 失效时间（毫秒）。过期即作废 */
      .addColumn('expires_at', 'bigint', (col) => col.notNull())
      /** 使用时间；非空 = 已用过，一次性 */
      .addColumn('used_at', 'bigint')
      /** 签发人 user.id（教师或管理员） */
      .addColumn('created_by', 'integer')
      /** 签发时间（毫秒） */
      .addColumn('created_at', 'bigint', (col) => col.notNull())
      .execute();
  }

  const indexes: { name: string; columns: string[] }[] = [
    { name: 'idx_reset_user', columns: ['user_id'] },
    { name: 'idx_reset_expires', columns: ['expires_at'] },
  ];
  for (const idx of indexes) {
    try {
      let builder = db.schema.createIndex(idx.name).on('password_reset');
      for (const col of idx.columns) builder = builder.column(col);
      await builder.execute();
    } catch (e) {
      // SQLite 报 index already exists，MySQL 报 Duplicate key name
      if (!/already exist|Duplicate key name/i.test((e as Error).message)) throw e;
    }
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const name of ['idx_reset_expires', 'idx_reset_user']) {
    await db.schema.dropIndex(name).on('password_reset').execute();
  }
  await db.schema.dropTable('password_reset').execute();
}
