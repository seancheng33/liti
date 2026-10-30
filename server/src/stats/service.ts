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

  const questionByDifficulty = (
    await db
      .selectFrom('question')
      .select(['difficulty', (eb) => eb.fn.countAll().as('c')])
      .where('status', '=', 'active')
      .groupBy('difficulty')
      .orderBy('difficulty', 'asc')
      .execute()
  ).map((r) => ({ difficulty: r.difficulty, count: Number(r.c) }));

  const categoryCount = Number((await db.selectFrom('category').select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow()).c);
  const paperCount = Number((await db.selectFrom('paper').select((eb) => eb.fn.countAll().as('c')).where('practice', '=', 0).executeTakeFirstOrThrow()).c);
  const attemptCount = Number((await db.selectFrom('attempt').select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow()).c);

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

  const correctByDifficulty = (
    await db
      .selectFrom('attempt_item')
      .innerJoin('question', 'question.id', 'attempt_item.question_id')
      .select([
        'question.difficulty as difficulty',
        (eb) => eb.fn.countAll().as('total'),
        (eb) => eb.fn.sum('attempt_item.is_correct').as('correct'),
      ])
      .where('attempt_item.is_correct', 'is not', null)
      .groupBy('question.difficulty')
      .orderBy('question.difficulty', 'asc')
      .execute()
  ).map((r) => {
    const total = Number(r.total);
    const correct = Number(r.correct ?? 0);
    return { difficulty: r.difficulty, total, correct, rate: total ? Math.round((correct / total) * 1000) / 1000 : 0 };
  });

  return {
    questionCount,
    questionByType,
    questionByDifficulty,
    categoryCount,
    paperCount,
    attemptCount,
    gradedCount,
    avgScorePercent,
    correctRate,
    correctByDifficulty,
  };
}
