import type { Kysely } from 'kysely';

/**
 * v0.12 审计日志。
 *
 * 学校采购时一定会问：「这份卷子是谁在什么时候发布的？」「这个学生的密码是谁重置的？」
 * 「上周三那次强制收卷是谁点的？」——答题、违规这些数据本身有时间戳，但**谁操作的**
 * 以前只活在会话里，会话一过期就查无此人。
 *
 * 设计要点：
 *
 * 1. **操作人存快照（actor_name / actor_role），不只存 actor_id**。
 *    用户改名、被删之后，只靠 join 出来的名字会变成空或者跟着一起变——
 *    审计记录的意义恰恰是「当时是谁干的」，不是「现在这个人叫什么」。
 *    所以 actor_id 只作筛选用的索引，展示一律走快照。
 *
 * 2. **target_label 同样存快照**。试卷标题改过了、题库题目归档了，
 *    日志里还得能读懂「当时动的是哪一份」。
 *
 * 3. **at 是 bigint**。v0.11 的教训：MySQL 的 INTEGER 是 32 位有符号，
 *    装不下 13 位毫秒时间戳，写入直接 Out of range。
 *
 * 4. **不存密码、不存题干全文**。detail 是给人看的差异摘要，
 *    重置密码只记「重置了」，不记重置成什么。
 *
 * 幂等：MySQL 的 DDL 隐式提交、不在迁移事务里，半截失败重跑会撞 Table already exists。
 */
export async function up(db: Kysely<any>): Promise<void> {
  const tables = await db.introspection.getTables();
  const exists = (name: string): boolean => !!tables.find((t) => t.name === name);

  if (!exists('audit_log')) {
    await db.schema
      .createTable('audit_log')
      .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
      /** 发生时间（毫秒）。列表默认按它倒序 */
      .addColumn('at', 'bigint', (col) => col.notNull())
      /** 操作人 user.id；系统动作（自动收卷等）为 null */
      .addColumn('actor_id', 'integer')
      /** 操作人显示名快照，系统动作为「系统」 */
      .addColumn('actor_name', 'varchar(128)', (col) => col.notNull())
      /** 操作人角色快照 */
      .addColumn('actor_role', 'varchar(16)')
      /** 动作标识，点号命名：paper.publish / user.reset-password / violation.revoke */
      .addColumn('action', 'varchar(64)', (col) => col.notNull())
      /** 操作对象类型：paper / user / question / group / category / attempt / setting */
      .addColumn('target_type', 'varchar(24)')
      .addColumn('target_id', 'integer')
      /** 对象名称快照：试卷标题、用户显示名、题干预览…… */
      .addColumn('target_label', 'varchar(255)')
      /** JSON 文本，变更差异或补充说明。写之前会截断，别塞大对象 */
      .addColumn('detail', 'text')
      /** 来源 IP，事后追「从哪台机器操作的」 */
      .addColumn('ip', 'varchar(64)')
      .execute();
  }

  // 列表按时间倒序翻页、按动作/操作人/对象筛选，这四个索引刚好覆盖
  const indexes: { name: string; columns: string[] }[] = [
    { name: 'idx_audit_at', columns: ['at'] },
    { name: 'idx_audit_action', columns: ['action'] },
    { name: 'idx_audit_actor', columns: ['actor_id'] },
    { name: 'idx_audit_target', columns: ['target_type', 'target_id'] },
  ];
  for (const idx of indexes) {
    try {
      let builder = db.schema.createIndex(idx.name).on('audit_log');
      for (const col of idx.columns) builder = builder.column(col);
      await builder.execute();
    } catch (e) {
      // SQLite 报 index already exists，MySQL 报 Duplicate key name
      if (!/already exist|Duplicate key name/i.test((e as Error).message)) throw e;
    }
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const name of ['idx_audit_target', 'idx_audit_actor', 'idx_audit_action', 'idx_audit_at']) {
    await db.schema.dropIndex(name).on('audit_log').execute();
  }
  await db.schema.dropTable('audit_log').execute();
}
