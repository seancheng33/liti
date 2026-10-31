import type { Kysely } from 'kysely';

/**
 * v0.4 数据结构扩展：
 * 1. 考试暂停：记录暂停起点与累计暂停时长，恢复时把 deadline 往后顺延。
 * 2. 题目标记：答题过程中的"这题先放着"，状态要跨刷新保留。
 * 3. 试卷可见范围：发布时可以只让指定学生看见（白名单）。
 */
export async function up(db: Kysely<any>): Promise<void> {
  // ---------- 1. 暂停 ----------
  // paused_at 非空 = 当前处于暂停中；paused_total_ms 只是给页面展示"共暂停了多久"
  await db.schema.alterTable('attempt').addColumn('paused_at', 'bigint').execute();
  await db.schema
    .alterTable('attempt')
    .addColumn('paused_total_ms', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();

  // ---------- 2. 题目标记 ----------
  await db.schema
    .alterTable('attempt_item')
    .addColumn('flagged', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();

  // ---------- 3. 试卷可见范围 ----------
  // all = 所有学生可见；selected = 只对 paper_audience 里的学生可见
  await db.schema
    .alterTable('paper')
    .addColumn('audience_mode', 'varchar(16)', (c) => c.notNull().defaultTo('all'))
    .execute();

  await db.schema
    .createTable('paper_audience')
    .addColumn('id', 'integer', (c) => c.autoIncrement().primaryKey())
    .addColumn('paper_id', 'integer', (c) => c.notNull())
    .addColumn('user_id', 'integer', (c) => c.notNull())
    .addColumn('created_at', 'bigint', (c) => c.notNull())
    .execute();

  // 列表过滤与开考校验都按 (paper_id, user_id) 查，两个方向各建一个索引
  await db.schema.createIndex('idx_paper_audience_paper').on('paper_audience').column('paper_id').execute();
  await db.schema.createIndex('idx_paper_audience_user').on('paper_audience').column('user_id').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_paper_audience_user').on('paper_audience').execute();
  await db.schema.dropIndex('idx_paper_audience_paper').on('paper_audience').execute();
  await db.schema.dropTable('paper_audience').execute();
  await db.schema.alterTable('paper').dropColumn('audience_mode').execute();
  await db.schema.alterTable('attempt_item').dropColumn('flagged').execute();
  await db.schema.alterTable('attempt').dropColumn('paused_total_ms').execute();
  await db.schema.alterTable('attempt').dropColumn('paused_at').execute();
}
