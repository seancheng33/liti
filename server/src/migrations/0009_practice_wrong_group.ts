import type { Kysely } from 'kysely';

/**
 * v0.5 数据结构扩展：
 * 1. 学生分组：教师/管理员按分组建制发卷（分组是活的，成员变了可见范围跟着变）。
 * 2. 错题库：每个用户一份，按 user_id 隔离；答错累加、答对标记订正，记录不物理删除。
 * 3. 练习卷来源：区分「随机练习」与「错题练习」，列表和成绩单上能看出这张卷子怎么来的。
 */
export async function up(db: Kysely<any>): Promise<void> {
  // ---------- 1. 学生分组 ----------
  await db.schema
    .createTable('student_group')
    .addColumn('id', 'integer', (c) => c.autoIncrement().primaryKey())
    .addColumn('name', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('remark', 'varchar(255)')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'bigint', (c) => c.notNull())
    .addColumn('updated_at', 'bigint', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('student_group_member')
    .addColumn('id', 'integer', (c) => c.autoIncrement().primaryKey())
    .addColumn('group_id', 'integer', (c) => c.notNull())
    .addColumn('user_id', 'integer', (c) => c.notNull())
    .addColumn('created_at', 'bigint', (c) => c.notNull())
    .execute();

  // 两个方向都要查：按组列成员、按人反查在哪几个组
  await db.schema.createIndex('idx_group_member_group').on('student_group_member').column('group_id').execute();
  await db.schema.createIndex('idx_group_member_user').on('student_group_member').column('user_id').execute();

  // ---------- 2. 错题库 ----------
  await db.schema
    .createTable('wrong_question')
    .addColumn('id', 'integer', (c) => c.autoIncrement().primaryKey())
    .addColumn('user_id', 'integer', (c) => c.notNull())
    .addColumn('question_id', 'integer', (c) => c.notNull())
    .addColumn('wrong_count', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('first_wrong_at', 'bigint', (c) => c.notNull())
    .addColumn('last_wrong_at', 'bigint', (c) => c.notNull())
    .addColumn('last_attempt_id', 'integer')
    // 非空 = 后来做对过（"已订正"），列表默认不显示，但记录保留，再错一次会重新置空
    .addColumn('resolved_at', 'bigint')
    .addColumn('created_at', 'bigint', (c) => c.notNull())
    .addColumn('updated_at', 'bigint', (c) => c.notNull())
    .execute();

  // 一个人一道题只留一条；判分时按这两个字段 upsert
  await db.schema
    .createIndex('uq_wrong_question_user')
    .on('wrong_question')
    .columns(['user_id', 'question_id'])
    .unique()
    .execute();

  // ---------- 3. 练习卷来源 ----------
  // random=随机练习，wrong=错题练习；普通试卷为 null
  await db.schema.alterTable('paper').addColumn('practice_source', 'varchar(16)').execute();

  // ---------- 4. 可见范围按分组 ----------
  await db.schema
    .createTable('paper_audience_group')
    .addColumn('id', 'integer', (c) => c.autoIncrement().primaryKey())
    .addColumn('paper_id', 'integer', (c) => c.notNull())
    .addColumn('group_id', 'integer', (c) => c.notNull())
    .addColumn('created_at', 'bigint', (c) => c.notNull())
    .execute();

  await db.schema.createIndex('idx_paper_audience_group_paper').on('paper_audience_group').column('paper_id').execute();
  await db.schema.createIndex('idx_paper_audience_group_group').on('paper_audience_group').column('group_id').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_paper_audience_group_group').on('paper_audience_group').execute();
  await db.schema.dropIndex('idx_paper_audience_group_paper').on('paper_audience_group').execute();
  await db.schema.dropTable('paper_audience_group').execute();

  await db.schema.alterTable('paper').dropColumn('practice_source').execute();

  await db.schema.dropIndex('uq_wrong_question_user').on('wrong_question').execute();
  await db.schema.dropTable('wrong_question').execute();

  await db.schema.dropIndex('idx_group_member_user').on('student_group_member').execute();
  await db.schema.dropIndex('idx_group_member_group').on('student_group_member').execute();
  await db.schema.dropTable('student_group_member').execute();
  await db.schema.dropTable('student_group').execute();
}
