import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { previewPaperById } from '../paper/preview.js';

/** 首页最多展示多少张已发布试卷 */
const MAX_PUBLIC_PAPERS = 24;

/**
 * 公开接口：首页未登录也要能看统计、看已发布试卷、预览卷面。
 * 这里**只暴露数字与已发布试卷的题面**，不含答案、解析、用户信息。
 */
export async function publicRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  app.get('/overview', async () => {
    const activeQuestions = Number(
      (
        await db
          .selectFrom('question')
          .select((eb) => eb.fn.countAll().as('c'))
          .where('status', '=', 'active')
          .executeTakeFirstOrThrow()
      ).c,
    );
    const categoryCount = Number(
      (await db.selectFrom('category').select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow()).c,
    );
    const paperTotal = Number(
      (await db.selectFrom('paper').select((eb) => eb.fn.countAll().as('c')).where('practice', '=', 0).executeTakeFirstOrThrow()).c,
    );
    const publishedCount = Number(
      (
        await db
          .selectFrom('paper')
          .select((eb) => eb.fn.countAll().as('c'))
          .where('status', '=', 'published')
          .where('practice', '=', 0)
          .executeTakeFirstOrThrow()
      ).c,
    );
    const attemptCount = Number(
      (await db.selectFrom('attempt').select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow()).c,
    );
    const userCount = Number(
      (await db.selectFrom('user').select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow()).c,
    );

    const settingRows = await db.selectFrom('setting').select(['key', 'value']).execute();
    const settings = new Map(settingRows.map((r) => [r.key, r.value]));

    return {
      siteName: settings.get('site_name') ?? '砺题 Liti',
      siteAnnouncement: settings.get('site_announcement') ?? '',
      practiceEnabled: (settings.get('practice_enabled') ?? 'true') === 'true',
      stats: {
        questionCount: activeQuestions,
        categoryCount,
        paperCount: publishedCount,
        paperTotal,
        attemptCount,
        userCount,
      },
    };
  });

  app.get('/papers', async () => {
    const rows = await db
      .selectFrom('paper')
      .select(['id', 'title', 'question_count', 'duration_sec', 'pass_score', 'review_mode', 'shuffle_options', 'created_at'])
      .where('status', '=', 'published')
      .where('practice', '=', 0)
      .orderBy('id', 'desc')
      .limit(MAX_PUBLIC_PAPERS)
      .execute();

    return {
      total: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        questionCount: r.question_count,
        durationSec: r.duration_sec,
        passScore: r.pass_score,
        reviewMode: r.review_mode,
        shuffleOptions: r.shuffle_options === 1,
        createdAt: r.created_at,
      })),
    };
  });

  app.get('/papers/:id', async (request) => {
    const { id } = request.params as { id: string };
    const paperId = Number(id);
    if (!Number.isInteger(paperId) || paperId <= 0) throw new HttpError(400, '试卷编号无效');

    const row = await db.selectFrom('paper').select(['status', 'practice']).where('id', '=', paperId).executeTakeFirst();
    if (!row) throw new HttpError(404, '试卷不存在');
    // 未发布的卷子对外一律当作不存在，避免草稿泄漏
    if (row.status !== 'published' || row.practice !== 0) throw new HttpError(404, '试卷不存在');

    return previewPaperById(db, paperId);
  });
}
