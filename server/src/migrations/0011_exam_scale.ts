import type { Kysely } from 'kysely';

/**
 * v0.8 规模化落地：把「一所学校真能用起来」缺的两块数据基础补上。
 *
 * 1. paper.max_attempts —— 作答次数上限从全局常量改成按卷配置。
 *    原来写死 3 次，考试卷也一样，等于允许学生考三遍取最好的一次，
 *    这在正式考试的语境里说不通。默认仍给 3（老卷行为不变），
 *    考试卷建卷时设 1；练习卷（practice=1）完全不看这个字段。
 *
 * 2. user.student_no / user.class_name —— 学号与班级。
 *    没有这两个字段，成绩册只能按「用户名」发，教务拿到表对不上人；
 *    也没法按班汇总、按班导出。
 *
 * 都是可空 + 有默认值，老数据与老调用方行为不变。
 *
 * ⚠️ 故意写成幂等（先 introspection 查列在不在）。原因：MySQL 的 DDL 隐式提交、
 * 不在迁移事务里，中途失败会留下「加了一半」的表结构；而 Kysely 不会记录该迁移
 * 成功，下次启动整段重跑，那时 ADD COLUMN 会撞「Duplicate column name」。
 * 幂等写法让重跑能自愈。
 */
export async function up(db: Kysely<any>): Promise<void> {
  const tables = await db.introspection.getTables();
  const hasColumn = (table: string, column: string): boolean =>
    !!tables.find((t) => t.name === table)?.columns.some((c) => c.name === column);

  // SQLite 一条 ALTER TABLE 只能加一列，逐列执行
  /** 每份试卷允许作答的次数；练习卷不受此限 */
  if (!hasColumn('paper', 'max_attempts')) {
    await db.schema
      .alterTable('paper')
      .addColumn('max_attempts', 'integer', (c) => c.notNull().defaultTo(3))
      .execute();
  }

  // 用 varchar 而不是 text：MySQL 不允许对 TEXT 列直接建索引
  // （会报 BLOB/TEXT column used in key specification without a key length），
  // 而学号必须唯一。SQLite 侧 varchar(n) 一并归到 TEXT 亲和，两个库行为一致。
  /** 学号（同一部署内唯一，可为空——教师/管理员没有学号） */
  if (!hasColumn('user', 'student_no')) {
    await db.schema.alterTable('user').addColumn('student_no', 'varchar(32)').execute();
  }
  /** 班级名，自由文本（不建班级表：一所学校的班级结构差异太大，先跑起来再说） */
  if (!hasColumn('user', 'class_name')) {
    await db.schema.alterTable('user').addColumn('class_name', 'varchar(64)').execute();
  }

  // 索引没有 introspection 接口能查，用 try/catch 兜「已存在」。
  // 学号唯一：两个学生同一个学号会让成绩册直接对不上人。
  // 两个库的唯一索引都允许多个 NULL，所以教师/管理员不受影响。
  try {
    await db.schema.createIndex('idx_user_student_no').on('user').column('student_no').unique().execute();
  } catch (e) {
    if (!/already exist|Duplicate key name/i.test((e as Error).message)) throw e;
  }
  // 按班导出成绩要按 class_name 过滤
  try {
    await db.schema.createIndex('idx_user_class_name').on('user').column('class_name').execute();
  } catch (e) {
    if (!/already exist|Duplicate key name/i.test((e as Error).message)) throw e;
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_user_class_name').on('user').execute();
  await db.schema.dropIndex('idx_user_student_no').on('user').execute();
  await db.schema.alterTable('user').dropColumn('class_name').execute();
  await db.schema.alterTable('user').dropColumn('student_no').execute();
  await db.schema.alterTable('paper').dropColumn('max_attempts').execute();
}
