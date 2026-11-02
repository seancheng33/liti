import type { Kysely } from 'kysely';

/**
 * v0.13 题序乱序（A/B 卷的第二层）。
 *
 * 「选项乱序」早就有了（`paper.shuffle_options`，默认开）：同一道题的 ABCD 在每个学生
 * 屏幕上位置不同。但它挡不住一种很常见的抄法 —— 两个人对着卷面报「第 3 题选 B」，
 * 题目顺序一样的时候照样能对。
 *
 * 所以补一层 `shuffle_questions`：开考那一刻把题目顺序打乱，按 `attempt_item.order_no`
 * 落库。**顺序一旦写进答卷就不再变**，刷新、换设备、断网重连都是同一份卷面 ——
 * 要是每次请求都重新打乱，学生翻回去看前一道题会发现题干变了。
 *
 * 默认 **0（关闭）**，与 `shuffle_options` 默认开不一样，原因是：
 * 选项乱序不改变「第 3 题」的指代，题序乱序会。学生说「第 3 题不会」，老师打开卷子
 * 看到的是另一道题 —— 这是真实的教学摩擦，得让老师知情后自己开，不能替他默认。
 *
 * 幂等：MySQL 的 DDL 隐式提交、不在迁移事务里，半截失败重跑会撞 Duplicate column。
 */
export async function up(db: Kysely<any>): Promise<void> {
  const tables = await db.introspection.getTables();
  const paper = tables.find((t) => t.name === 'paper');
  const hasColumn = !!paper?.columns.some((c) => c.name === 'shuffle_questions');

  if (!hasColumn) {
    await db.schema
      .alterTable('paper')
      .addColumn('shuffle_questions', 'integer', (col) => col.notNull().defaultTo(0))
      .execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('paper').dropColumn('shuffle_questions').execute();
}
