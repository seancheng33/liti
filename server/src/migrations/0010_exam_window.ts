import type { Kysely } from 'kysely';

/**
 * v0.7 考试组织能力：让系统能开一场「正式考试」，而不只是随堂练习。
 *
 * 1. 考试时间窗口：start_at / end_at。到点统一收卷，迟到不得入场。
 * 2. 暂停权限：allow_student_pause=0 时学生不能自己停表（考试卷必须关掉，
 *    否则「暂停去翻书」是现成的作弊通道）。
 * 3. 每题分值：per_question_score，总分 = 题数 × 分值，及格线才有意义。
 * 4. 发布控制：results_published / analysis_published，老师手动放分、放解析。
 *
 * 全部给了向后兼容的默认值（可见/可暂停/1 分/默认已发布），
 * 老数据、老调用方行为不变；考试语义由建卷时的显式入参开启。
 */
export async function up(db: Kysely<any>): Promise<void> {
  // SQLite 一条 ALTER TABLE 只能加一列，必须逐列执行（MySQL 倒是能合并，按严格的那个来）
  /** 允许开考的时间，NULL = 随时可考 */
  await db.schema.alterTable('paper').addColumn('start_at', 'bigint').execute();
  /** 统一收卷时间，NULL = 不限制 */
  await db.schema.alterTable('paper').addColumn('end_at', 'bigint').execute();
  /** 1 = 学生可以自行暂停（练习卷语义）；0 = 考试卷，学生不能停表 */
  await db.schema
    .alterTable('paper')
    .addColumn('allow_student_pause', 'integer', (c) => c.notNull().defaultTo(1))
    .execute();
  /** 每题分值，总分 = question_count × per_question_score */
  await db.schema
    .alterTable('paper')
    .addColumn('per_question_score', 'integer', (c) => c.notNull().defaultTo(1))
    .execute();
  /** 学生交卷后能否看到分数；0 = 待老师统一公布 */
  await db.schema
    .alterTable('paper')
    .addColumn('results_published', 'integer', (c) => c.notNull().defaultTo(1))
    .execute();
  /** 学生能否看到正确答案与解析；0 = 只出分不出答案 */
  await db.schema
    .alterTable('paper')
    .addColumn('analysis_published', 'integer', (c) => c.notNull().defaultTo(1))
    .execute();

  // 收卷扫描要按 (status, deadline_at) 捞进行中的答卷
  await db.schema.createIndex('idx_attempt_status_deadline').on('attempt').columns(['status', 'deadline_at']).execute();
  await db.schema.createIndex('idx_attempt_paper').on('attempt').column('paper_id').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_attempt_paper').on('attempt').execute();
  await db.schema.dropIndex('idx_attempt_status_deadline').on('attempt').execute();
  await db.schema.alterTable('paper').dropColumn('analysis_published').execute();
  await db.schema.alterTable('paper').dropColumn('results_published').execute();
  await db.schema.alterTable('paper').dropColumn('per_question_score').execute();
  await db.schema.alterTable('paper').dropColumn('allow_student_pause').execute();
  await db.schema.alterTable('paper').dropColumn('end_at').execute();
  await db.schema.alterTable('paper').dropColumn('start_at').execute();
}
