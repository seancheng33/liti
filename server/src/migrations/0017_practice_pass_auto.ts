import type { Kysely } from 'kysely';

/**
 * v1.1 练习卷及格线改为「自动」：pass_score = 0 表示按总分 60% 折算。
 *
 * 学生自助生成的练习卷此前写死 pass_score = 60，而练习卷总分 = 题量 × 1 分，
 * 抽 10 题满分才 10 分，60 分及格线让所有练习卷永远判不及格。
 * 本迁移把存量练习卷的及格线统一改为 0（自动），正式卷（practice = 0）不动，
 * 教师手动设置的及格分照常生效。
 *
 * 纯 DML，双方言通用，天然幂等。
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('paper')
    .set({ pass_score: 0 })
    .where('practice', '=', 1)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('paper')
    .set({ pass_score: 60 })
    .where('practice', '=', 1)
    .execute();
}
