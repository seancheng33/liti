import type { Kysely, Transaction } from 'kysely';
import type { AudienceMode, Database, Role } from '../db/types.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { fisherYates, MAX_PAPER_QUESTIONS, validatePaperInput, type PaperInput, type RandomRule } from './validate.js';

/** 每份试卷最多可作答次数（练习卷不受限） */
export const MAX_ATTEMPTS_PER_PAPER = 3;

type AnyDb = Kysely<Database> | Transaction<Database>;

export interface SampleRule {
  /** 留空表示从整个题库抽 */
  categoryId?: number;
  count: number;
}

export async function sampleQuestionIds(db: AnyDb, rules: SampleRule[]): Promise<number[]> {
  const picked: number[] = [];
  const pickedSet = new Set<number>();
  for (const rule of rules) {
    let q = db.selectFrom('question').select('id').where('status', '=', 'active');
    if (rule.categoryId != null) q = q.where('category_id', '=', rule.categoryId);
    const ids = (await q.execute()).map((r) => r.id).filter((id) => !pickedSet.has(id));

    if (ids.length < rule.count) {
      const scope = rule.categoryId != null ? '该分类' : '题库';
      throw new HttpError(400, `${scope}题目不足：需抽 ${rule.count} 题，但仅剩 ${ids.length} 题可抽`);
    }
    for (const id of fisherYates(ids).slice(0, rule.count)) {
      picked.push(id);
      pickedSet.add(id);
    }
  }
  return picked;
}

export async function previewRandom(db: Db, rules: SampleRule[]): Promise<{ questionIds: number[] }> {
  const total = rules.reduce((s, r) => s + r.count, 0);
  if (total < 1 || total > MAX_PAPER_QUESTIONS) throw new HttpError(400, `题量须在 1–${MAX_PAPER_QUESTIONS} 之间`);
  const ids = await sampleQuestionIds(db, rules);
  return { questionIds: ids };
}

async function insertPaper(db: AnyDb, input: PaperInput, userId: number | null, questionIds: number[]): Promise<number> {
  const now = Date.now();
  const perScore = input.perQuestionScore ?? 1;
  const totalScore = questionIds.length * perScore;
  // 及格分一律收敛到总分以内：不然「满分 3 分、及格 60 分」这种配置会让整张卷子永远判不及格
  const passScore = Math.min(input.passScore ?? 60, totalScore || 60);
  const res = await db
    .insertInto('paper')
    .values({
      title: input.title.trim(),
      mode: input.mode,
      question_count: questionIds.length,
      duration_sec: input.durationSec,
      pass_score: passScore,
      review_mode: input.reviewMode ?? 'after_submit',
      shuffle_options: input.shuffleOptions === false ? 0 : 1,
      random_config: input.mode === 'random' ? JSON.stringify(input.randomRules ?? []) : null,
      status: 'draft',
      practice: 0,
      audience_mode: input.audienceMode ?? 'all',
      start_at: input.startAt ?? null,
      end_at: input.endAt ?? null,
      allow_student_pause: input.allowStudentPause === false ? 0 : 1,
      per_question_score: input.perQuestionScore ?? 1,
      results_published: input.resultsPublished === false ? 0 : 1,
      analysis_published: input.analysisPublished === false ? 0 : 1,
      max_attempts: input.maxAttempts ?? MAX_ATTEMPTS_PER_PAPER,
      created_by: userId,
      created_at: now,
      updated_at: now,
    })
    .executeTakeFirstOrThrow();
  const paperId = Number(res.insertId);

  if (questionIds.length) {
    await db
      .insertInto('paper_item')
      .values(questionIds.map((qid, i) => ({ paper_id: paperId, question_id: qid, order_no: i + 1, score: perScore })))
      .execute();
  }

  if (input.audienceMode === 'selected' && (input.audienceUserIds?.length || input.audienceGroupIds?.length)) {
    if (input.audienceUserIds?.length) await writeAudience(db, paperId, input.audienceUserIds, now);
    if (input.audienceGroupIds?.length) await writeAudienceGroups(db, paperId, input.audienceGroupIds, now);
  }
  return paperId;
}

/** 覆盖式写入可见名单（先清后插，简单且不会留下脏数据） */
async function writeAudience(db: AnyDb, paperId: number, userIds: number[], now = Date.now()): Promise<void> {
  const unique = [...new Set(userIds)];
  await db.deleteFrom('paper_audience').where('paper_id', '=', paperId).execute();
  if (!unique.length) return;
  await db
    .insertInto('paper_audience')
    .values(unique.map((uid) => ({ paper_id: paperId, user_id: uid, created_at: now })))
    .execute();
}

/**
 * 覆盖式写入「可见分组」。
 * 存分组而不是展开成员：分组加人之后，这份卷子的可见范围自动跟着变。
 */
async function writeAudienceGroups(db: AnyDb, paperId: number, groupIds: number[], now = Date.now()): Promise<void> {
  const unique = [...new Set(groupIds)];
  await db.deleteFrom('paper_audience_group').where('paper_id', '=', paperId).execute();
  if (!unique.length) return;
  await db
    .insertInto('paper_audience_group')
    .values(unique.map((gid) => ({ paper_id: paperId, group_id: gid, created_at: now })))
    .execute();
}

/** 发布时（或发布后）指定可见范围：可以直接点名，也可以指向整个分组（取并集） */
export async function setPaperAudience(
  db: Db,
  id: number,
  mode: AudienceMode,
  userIds: number[],
  groupIds: number[] = [],
): Promise<{ audienceMode: AudienceMode; audienceUserIds: number[]; audienceGroupIds: number[] }> {
  const existing = await db.selectFrom('paper').select('id').where('id', '=', id).executeTakeFirst();
  if (!existing) throw new HttpError(404, '试卷不存在');

  const unique = [...new Set(userIds)];
  const uniqueGroups = [...new Set(groupIds)];
  if (mode === 'selected') {
    if (!unique.length && !uniqueGroups.length) {
      throw new HttpError(400, '选择「指定学生」时至少要勾一个学生或一个分组');
    }
    if (unique.length) {
      const valid = await db
        .selectFrom('user')
        .select('id')
        .where('id', 'in', unique)
        .where('role', '=', 'student')
        .execute();
      const validIds = new Set(valid.map((u) => u.id));
      const bad = unique.filter((uid) => !validIds.has(uid));
      if (bad.length) throw new HttpError(400, `以下用户不是学生或不存在：${bad.join(',')}`);
    }
    if (uniqueGroups.length) {
      const rows = await db.selectFrom('student_group').select('id').where('id', 'in', uniqueGroups).execute();
      const validIds = new Set(rows.map((g) => g.id));
      const bad = uniqueGroups.filter((gid) => !validIds.has(gid));
      if (bad.length) throw new HttpError(400, `以下分组不存在：${bad.join(',')}`);
    }
  }

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('paper')
      .set({ audience_mode: mode, updated_at: Date.now() })
      .where('id', '=', id)
      .execute();
    await writeAudience(trx, id, mode === 'selected' ? unique : []);
    await writeAudienceGroups(trx, id, mode === 'selected' ? uniqueGroups : []);
  });

  return {
    audienceMode: mode,
    audienceUserIds: mode === 'selected' ? unique : [],
    audienceGroupIds: mode === 'selected' ? uniqueGroups : [],
  };
}

/** 读一份试卷的可见名单 */
export async function getPaperAudience(
  db: Db,
  id: number,
): Promise<{ audienceMode: AudienceMode; audienceUserIds: number[]; audienceGroupIds: number[] }> {
  const paper = await db.selectFrom('paper').select('audience_mode').where('id', '=', id).executeTakeFirst();
  if (!paper) throw new HttpError(404, '试卷不存在');
  const rows = await db.selectFrom('paper_audience').select('user_id').where('paper_id', '=', id).execute();
  const groups = await db
    .selectFrom('paper_audience_group')
    .select('group_id')
    .where('paper_id', '=', id)
    .execute();
  return {
    audienceMode: paper.audience_mode,
    audienceUserIds: rows.map((r) => r.user_id),
    audienceGroupIds: groups.map((g) => g.group_id),
  };
}

/** 这个学生能不能看到/作答这份试卷（点名 ∪ 所在分组） */
export async function paperVisibleTo(db: Db, paperId: number, userId: number): Promise<boolean> {
  const paper = await db.selectFrom('paper').select('audience_mode').where('id', '=', paperId).executeTakeFirst();
  if (!paper) return false;
  if (paper.audience_mode !== 'selected') return true;

  const hit = await db
    .selectFrom('paper_audience')
    .select('id')
    .where('paper_id', '=', paperId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (hit) return true;

  // 分组可见：只要他在这份卷子挂的任意一个组里就算
  const viaGroup = await db
    .selectFrom('paper_audience_group as pag')
    .innerJoin('student_group_member as m', 'm.group_id', 'pag.group_id')
    .select('pag.id')
    .where('pag.paper_id', '=', paperId)
    .where('m.user_id', '=', userId)
    .executeTakeFirst();
  return !!viaGroup;
}

/** 把组卷入参解析成最终题号数组（随机抽样或手选校验） */
export async function resolveQuestionIds(db: Db, input: PaperInput): Promise<number[]> {
  if (input.mode === 'random') {
    const rules: SampleRule[] = (input.randomRules ?? []).map((r: RandomRule) => ({
      categoryId: r.categoryId ?? undefined,
      count: r.count,
    }));
    return sampleQuestionIds(db, rules);
  }
  const ids = [...new Set(input.questionIds ?? [])];
  const existing = await db.selectFrom('question').select('id').where('id', 'in', ids).where('status', '=', 'active').execute();
  const existingIds = new Set(existing.map((r) => r.id));
  const missing = ids.filter((id) => !existingIds.has(id));
  if (missing.length) throw new HttpError(400, `题目不存在或已归档: ${missing.join(',')}`);
  return ids;
}

export async function createPaper(db: Db, input: PaperInput, userId: number | null): Promise<number> {
  const errors = validatePaperInput(input);
  if (errors.length) throw new HttpError(400, errors.join('；'));

  const questionIds = await resolveQuestionIds(db, input);
  return db.transaction().execute((trx) => insertPaper(trx, input, userId, questionIds));
}

export async function getPaperDetail(db: Db, id: number) {
  const paper = await db.selectFrom('paper').selectAll().where('id', '=', id).executeTakeFirst();
  if (!paper) return null;
  const items = await db.selectFrom('paper_item').selectAll().where('paper_id', '=', id).orderBy('order_no', 'asc').execute();
  const audience = await db.selectFrom('paper_audience').select('user_id').where('paper_id', '=', id).execute();
  const audienceGroups = await db
    .selectFrom('paper_audience_group')
    .select('group_id')
    .where('paper_id', '=', id)
    .execute();
  return {
    ...paper,
    random_config: paper.random_config ? JSON.parse(paper.random_config) : null,
    audience_user_ids: audience.map((a) => a.user_id),
    audience_group_ids: audienceGroups.map((g) => g.group_id),
    items,
  };
}

export async function listPapers(
  db: Db,
  opts: { page?: number; pageSize?: number; status?: string; viewer?: { userId: number; role: Role } },
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(Math.max(1, opts.pageSize ?? 20), 100);
  let base = db.selectFrom('paper').where('practice', '=', 0);
  if (opts.status) base = base.where('status', '=', opts.status as 'draft' | 'published' | 'archived');

  // 学生只能看到「公开」或「被点名 / 所在分组被点名」的卷子
  const isStudent = opts.viewer?.role === 'student';
  if (isStudent && opts.viewer) {
    const viewerId = opts.viewer.userId;
    base = base.where((eb) =>
      eb.or([
        eb('audience_mode', '=', 'all'),
        eb(
          'id',
          'in',
          eb.selectFrom('paper_audience').select('paper_id').where('user_id', '=', viewerId),
        ),
        eb(
          'id',
          'in',
          eb
            .selectFrom('paper_audience_group as pag')
            .innerJoin('student_group_member as m', 'm.group_id', 'pag.group_id')
            .select('pag.paper_id')
            .where('m.user_id', '=', viewerId),
        ),
      ]),
    );
  }

  const total = Number((await base.select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow()).c);
  const items = await base.selectAll().orderBy('id', 'desc').limit(pageSize).offset((page - 1) * pageSize).execute();

  // 可见名单人数（列表上显示「指定 N 人 / M 组」，不用逐行再查一次）
  const audienceRows = items.length
    ? await db
        .selectFrom('paper_audience')
        .select(['paper_id', (eb) => eb.fn.countAll().as('c')])
        .where('paper_id', 'in', items.map((i) => i.id))
        .groupBy('paper_id')
        .execute()
    : [];
  const audienceMap = new Map(audienceRows.map((r) => [Number(r.paper_id), Number(r.c)]));

  const groupRows = items.length
    ? await db
        .selectFrom('paper_audience_group')
        .select(['paper_id', (eb) => eb.fn.countAll().as('c')])
        .where('paper_id', 'in', items.map((i) => i.id))
        .groupBy('paper_id')
        .execute()
    : [];
  const groupMap = new Map(groupRows.map((r) => [Number(r.paper_id), Number(r.c)]));

  const withAudience = items.map((p) => ({
    ...p,
    audience_count: audienceMap.get(p.id) ?? 0,
    audience_group_count: groupMap.get(p.id) ?? 0,
  }));

  // 学生视角附上「已作答次数 / 剩余次数」，前端才能把「开始答题」换成「已用完」
  if (isStudent && opts.viewer && items.length) {
    const rows = await db
      .selectFrom('attempt')
      .select(['paper_id', (eb) => eb.fn.countAll().as('c')])
      .where('user_id', '=', opts.viewer.userId)
      .where('paper_id', 'in', items.map((i) => i.id))
      .where('status', 'in', ['submitted', 'expired'])
      .groupBy('paper_id')
      .execute();
    const usedMap = new Map(rows.map((r) => [Number(r.paper_id), Number(r.c)]));
    return {
      total,
      maxAttempts: MAX_ATTEMPTS_PER_PAPER,
      items: withAudience.map((p) => {
        const used = usedMap.get(p.id) ?? 0;
        // 练习卷不限次数（remaining_attempts=null），考试卷按自己配的上限算
        if (p.practice === 1) return { ...p, attempt_count: used, remaining_attempts: null };
        const limit = p.max_attempts ?? MAX_ATTEMPTS_PER_PAPER;
        return { ...p, attempt_count: used, remaining_attempts: Math.max(0, limit - used) };
      }),
    };
  }

  return { total, maxAttempts: MAX_ATTEMPTS_PER_PAPER, items: withAudience };
}

export async function setPaperStatus(db: Db, id: number, status: 'draft' | 'published' | 'archived'): Promise<void> {
  const existing = await db.selectFrom('paper').select('id').where('id', '=', id).executeTakeFirst();
  if (!existing) throw new HttpError(404, '试卷不存在');
  await db.updateTable('paper').set({ status, updated_at: Date.now() }).where('id', '=', id).execute();
}

/** 归档：卷子不再出现在学生的可考列表里，但历史答卷与成绩全部保留 */
export async function archivePaper(db: Db, id: number): Promise<void> {
  await setPaperStatus(db, id, 'archived');
}

/** 老师手动放分 / 放解析 */
export async function publishPaperResults(
  db: Db,
  id: number,
  opts: { results?: boolean; analysis?: boolean },
): Promise<{ resultsPublished: boolean; analysisPublished: boolean }> {
  const paper = await db
    .selectFrom('paper')
    .select(['id', 'results_published', 'analysis_published'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!paper) throw new HttpError(404, '试卷不存在');
  if (opts.results == null && opts.analysis == null) {
    throw new HttpError(400, '请指定要公布的内容（成绩或解析）');
  }

  const results = opts.results ?? paper.results_published === 1;
  const analysis = opts.analysis ?? paper.analysis_published === 1;

  await db
    .updateTable('paper')
    .set({ results_published: results ? 1 : 0, analysis_published: analysis ? 1 : 0, updated_at: Date.now() })
    .where('id', '=', id)
    .execute();

  return { resultsPublished: results, analysisPublished: analysis };
}

export async function countPaperAttempts(db: Db, id: number): Promise<number> {
  const row = await db
    .selectFrom('attempt')
    .select((eb) => eb.fn.countAll().as('c'))
    .where('paper_id', '=', id)
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

/**
 * 删除试卷。
 * 只要有过答卷就不允许物理删除 —— 成绩必须可追溯，删了卷子历史成绩就成了孤儿。
 * 这种情况引导用户走「归档」。
 */
export async function deletePaper(db: Db, id: number): Promise<void> {
  const used = await countPaperAttempts(db, id);
  if (used > 0) {
    throw new HttpError(400, `这份试卷已有 ${used} 份答卷，不能删除（成绩需要可追溯）；请改用「归档」，学生会看不到但成绩保留`);
  }
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('paper_audience').where('paper_id', '=', id).execute();
    await trx.deleteFrom('paper_audience_group').where('paper_id', '=', id).execute();
    await trx.deleteFrom('paper_item').where('paper_id', '=', id).execute();
    await trx.deleteFrom('paper').where('id', '=', id).execute();
  });
}
