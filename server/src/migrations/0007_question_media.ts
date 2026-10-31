import type { Kysely } from 'kysely';

/**
 * 题干/选项支持配图（存 JSON 数组，元素为 /uploads/... 相对地址），
 * 同时去掉「难度」这个维度：题目不再区分易/中/难。
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('question').addColumn('images', 'text').execute();
  await db.schema.alterTable('question_option').addColumn('images', 'text').execute();
  await db.schema.alterTable('question').dropColumn('difficulty').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('question')
    .addColumn('difficulty', 'integer', (col) => col.notNull().defaultTo(2))
    .execute();
  await db.schema.alterTable('question_option').dropColumn('images').execute();
  await db.schema.alterTable('question').dropColumn('images').execute();
}
