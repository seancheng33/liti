import type { Db } from '../db/index.js';

export async function getStats(db: Db) {
  const questionCount = Number(
    (await db.selectFrom('question').select((eb) => eb.fn.countAll().as('c')).where('status', '=', 'active').executeTakeFirstOrThrow()).c,
  );

  const byTypeRows = await db
    .selectFrom('question')
    .select(['type', (eb) => eb.fn.countAll().as('c')])
    .where('status', '=', 'active')
    .groupBy('type')
    .execute();
  const questionByType: Record<string, number> = { single: 0, multiple: 0 };
  for (const r of byTypeRows) questionByType[r.type] = Number(r.c);

  const categoryCount = Number((await db.selectFrom('category').select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow()).c);
  const paperCount = Number((await db.selectFrom('paper').select((eb) => eb.fn.countAll().as('c')).where('practice', '=', 0).executeTakeFirstOrThrow()).c);
  const attemptCount = Number((await db.selectFrom('attempt').select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow()).c);
  const userCount = Number((await db.selectFrom('user').select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow()).c);

  const graded = await db
    .selectFrom('attempt')
    .select(['score', 'total_score'])
    .where('status', 'in', ['submitted', 'expired'])
    .execute();
  const gradedCount = graded.length;
  const avgScorePercent = gradedCount
    ? Math.round((graded.reduce((s, a) => s + (a.total_score ? a.score / a.total_score : 0), 0) / gradedCount) * 1000) / 10
    : 0;

  const answeredCount = Number(
    (await db.selectFrom('attempt_item').select((eb) => eb.fn.countAll().as('c')).where('is_correct', 'is not', null).executeTakeFirstOrThrow()).c,
  );
  const correctCount = Number(
    (await db.selectFrom('attempt_item').select((eb) => eb.fn.sum('is_correct').as('s')).where('is_correct', 'is not', null).executeTakeFirstOrThrow()).s ?? 0,
  );
  const correctRate = answeredCount ? Math.round((correctCount / answeredCount) * 1000) / 1000 : 0;

  // 按分类统计正确率（替代原来的难度维度）
  const categoryRows = await db
    .selectFrom('attempt_item')
    .innerJoin('question', 'question.id', 'attempt_item.question_id')
    .leftJoin('category', 'category.id', 'question.category_id')
    .select([
      'category.name as name',
      (eb) => eb.fn.countAll().as('total'),
      (eb) => eb.fn.sum('attempt_item.is_correct').as('correct'),
    ])
    .where('attempt_item.is_correct', 'is not', null)
    .groupBy('category.name')
    .execute();

  const correctByCategory = categoryRows
    .map((r) => {
      const total = Number(r.total);
      const correct = Number(r.correct ?? 0);
      return {
        category: r.name ?? '未分类',
        total,
        correct,
        rate: total ? Math.round((correct / total) * 1000) / 1000 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    questionCount,
    questionByType,
    categoryCount,
    paperCount,
    attemptCount,
    userCount,
    gradedCount,
    avgScorePercent,
    correctRate,
    correctByCategory,
  };
}
