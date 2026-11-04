import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';
import { loadPaperRoster, sortRoster } from '../paper/roster.js';
import { effectivePassScore } from '../paper/service.js';

/**
 * 实时监考（v0.11）。
 *
 * 成绩册回答「考完之后」，逐题分析回答「题出得好不好」，监考回答的是
 * 「现在这一刻，考场里发生了什么」——谁在答、谁掉线了、谁被记了违规。
 *
 * 在线判定靠学生端心跳（`attempt.last_seen_at`）。为什么不用 WebSocket：
 * 考场网络常常是「能发 HTTP 不能长连接」的代理环境，长连接一断就整片掉线；
 * 20 秒一次的 HTTP 心跳在断网恢复后能自己接上，代价只是一个时间戳字段。
 */

/** 心跳超过这么久没刷新就算掉线。前端 20s 一次，容得下连丢 4 次 */
export const OFFLINE_AFTER_MS = 90_000;

export type ProctorStatus = 'not-started' | 'in-progress' | 'paused' | 'submitted' | 'expired';

export interface ProctorEntry {
  userId: number;
  username: string;
  displayName: string;
  studentNo: string | null;
  className: string | null;
  attemptId: number | null;
  status: ProctorStatus;
  /** 仅进行中/暂停中有意义；未开始与已交卷一律 null */
  online: boolean | null;
  /** 距上次心跳多少秒；null = 从没上报过 */
  lastSeenSec: number | null;
  answeredCount: number;
  questionCount: number;
  /** 未撤销的违规次数（占额度） */
  violations: number;
  /** 含已撤销的总条数（查历史用） */
  violationTotal: number;
  remainingSec: number | null;
  pausedSec: number;
  startedAt: number | null;
  submittedAt: number | null;
  submitReason: string | null;
  /** 未公布成绩时为 null —— 前端必须显示「未公布」，不能当成 0 */
  score: number | null;
  totalScore: number | null;
}

export interface ProctorSummary {
  rosterCount: number;
  notStarted: number;
  inProgress: number;
  paused: number;
  submitted: number;
  expired: number;
  online: number;
  offline: number;
  /** 进行中但一次心跳都没上报过（多半是旧版本页面或刚开考） */
  unknownSeen: number;
  violationStudents: number;
  violationTotal: number;
}

export interface ProctorView {
  paper: {
    id: number;
    title: string;
    questionCount: number;
    totalScore: number;
    passScore: number;
    startAt: number | null;
    endAt: number | null;
    status: string;
    resultsPublished: boolean;
    audienceMode: string;
  };
  /** 服务端当前时间，前端用它算倒计时偏移 */
  serverNow: number;
  offlineAfterMs: number;
  summary: ProctorSummary;
  entries: ProctorEntry[];
  warnings: string[];
}

/** 未撤销的违规条数（占额度的那个数） */
export async function countActiveViolations(db: Db, attemptId: number): Promise<number> {
  const row = await db
    .selectFrom('attempt_violation')
    .select((eb) => eb.fn.countAll().as('c'))
    .where('attempt_id', '=', attemptId)
    .where('revoked_at', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

/**
 * 一场考试的监考视图。
 *
 * 口径与成绩册一致：以「应考名单」为主表，名单里没有答卷的人显示「未开始」。
 * 一个人有多份答卷时，优先取进行中的那份；否则取最后一次。
 */
export async function loadProctorView(db: Db, paperId: number): Promise<ProctorView> {
  const paper = await db.selectFrom('paper').selectAll().where('id', '=', paperId).executeTakeFirst();
  if (!paper) throw new HttpError(404, '试卷不存在');
  if (paper.practice === 1) throw new HttpError(400, '练习卷没有考场，无法监考');

  const roster = sortRoster(await loadPaperRoster(db, paperId, paper.audience_mode as 'all' | 'selected'));

  const attempts = await db
    .selectFrom('attempt')
    .selectAll()
    .where('paper_id', '=', paperId)
    .execute();

  // 一人多卷：进行中的优先，其次 id 最大的（最近一次）
  const byUser = new Map<number, (typeof attempts)[number]>();
  for (const a of attempts) {
    const prev = byUser.get(a.user_id);
    if (!prev) {
      byUser.set(a.user_id, a);
      continue;
    }
    const prevRunning = prev.status === 'in_progress';
    const curRunning = a.status === 'in_progress';
    if (curRunning && !prevRunning) byUser.set(a.user_id, a);
    else if (curRunning === prevRunning && a.id > prev.id) byUser.set(a.user_id, a);
  }

  const attemptIds = [...byUser.values()].map((a) => a.id);

  // 已答数：一次聚合查完，别按人循环（一场几百人就是几百条 SQL）
  const answeredByAttempt = new Map<number, number>();
  if (attemptIds.length) {
    const rows = await db
      .selectFrom('attempt_item')
      .select((eb) => ['attempt_id', eb.fn.countAll().as('c')])
      .where('attempt_id', 'in', attemptIds)
      .where('selected', 'is not', null)
      .where('selected', '!=', '[]')
      .groupBy('attempt_id')
      .execute();
    for (const r of rows) answeredByAttempt.set(r.attempt_id, Number(r.c));
  }

  // 违规：活跃数 + 总数，按答卷分组
  const violActive = new Map<number, number>();
  const violTotal = new Map<number, number>();
  if (attemptIds.length) {
    const rows = await db
      .selectFrom('attempt_violation')
      .select(['attempt_id', 'revoked_at'])
      .where('attempt_id', 'in', attemptIds)
      .execute();
    for (const r of rows) {
      violTotal.set(r.attempt_id, (violTotal.get(r.attempt_id) ?? 0) + 1);
      if (r.revoked_at == null) violActive.set(r.attempt_id, (violActive.get(r.attempt_id) ?? 0) + 1);
    }
  }

  const now = Date.now();
  const resultsPublished = paper.results_published === 1;
  const questionCount = paper.question_count;

  const entries: ProctorEntry[] = roster.map((u) => {
    const a = byUser.get(u.id);
    if (!a) {
      return {
        userId: u.id,
        username: u.username,
        displayName: u.display_name,
        studentNo: u.student_no,
        className: u.class_name,
        attemptId: null,
        status: 'not-started' as const,
        online: null,
        lastSeenSec: null,
        answeredCount: 0,
        questionCount,
        violations: 0,
        violationTotal: 0,
        remainingSec: null,
        pausedSec: 0,
        startedAt: null,
        submittedAt: null,
        submitReason: null,
        score: null,
        totalScore: null,
      };
    }

    const running = a.status === 'in_progress';
    const paused = running && a.paused_at != null;
    const lastSeenSec = a.last_seen_at == null ? null : Math.max(0, Math.round((now - a.last_seen_at) / 1000));
    // 暂停中不判在线：人可能就坐在那儿，只是点了暂停
    const online = running && !paused ? (a.last_seen_at == null ? null : now - a.last_seen_at <= OFFLINE_AFTER_MS) : null;
    // 库里的 in_progress 是下划线，对外的 ProctorStatus 是连字符：老老实实映射，
    // 别用 as 断言糊过去 —— 断言过的类型错误照样会在前端变成一个空白标签
    const status: ProctorStatus = paused
      ? 'paused'
      : a.status === 'submitted'
        ? 'submitted'
        : a.status === 'expired'
          ? 'expired'
          : 'in-progress';

    return {
      userId: u.id,
      username: u.username,
      displayName: u.display_name,
      studentNo: u.student_no,
      className: u.class_name,
      attemptId: a.id,
      status,
      online,
      lastSeenSec,
      answeredCount: answeredByAttempt.get(a.id) ?? 0,
      questionCount,
      violations: violActive.get(a.id) ?? 0,
      violationTotal: violTotal.get(a.id) ?? 0,
      remainingSec: running ? Math.max(0, Math.round((a.deadline_at - now) / 1000)) : null,
      pausedSec: running && a.paused_at != null ? Math.round((now - a.paused_at) / 1000) : 0,
      startedAt: a.started_at,
      submittedAt: a.submitted_at,
      submitReason: a.submit_reason,
      score: resultsPublished ? a.score : null,
      totalScore: resultsPublished ? a.total_score : null,
    };
  });

  const summary: ProctorSummary = {
    rosterCount: roster.length,
    notStarted: entries.filter((e) => e.status === 'not-started').length,
    inProgress: entries.filter((e) => e.status === 'in-progress').length,
    paused: entries.filter((e) => e.status === 'paused').length,
    submitted: entries.filter((e) => e.status === 'submitted').length,
    expired: entries.filter((e) => e.status === 'expired').length,
    online: entries.filter((e) => e.online === true).length,
    offline: entries.filter((e) => e.online === false).length,
    unknownSeen: entries.filter((e) => e.status === 'in-progress' && e.online === null).length,
    violationStudents: entries.filter((e) => e.violations > 0).length,
    violationTotal: entries.reduce((s, e) => s + e.violations, 0),
  };

  const warnings: string[] = [];
  if (paper.start_at == null && paper.end_at == null) {
    warnings.push('这场没有设置考试时间窗口：学生随时可以开考，监考页看到的未必是同一场。');
  } else if (paper.end_at != null && now > paper.end_at) {
    warnings.push('考试结束时间已过，还在进行中的答卷会在下次心跳或自动收卷时判分。');
  }
  if (summary.offline > 0) {
    warnings.push(`${summary.offline} 人超过 ${Math.round(OFFLINE_AFTER_MS / 1000)} 秒没有心跳，可能网络中断或已离开考场。`);
  }
  if (summary.unknownSeen > 0) {
    warnings.push(`${summary.unknownSeen} 人正在进行但还没有心跳记录（页面可能是升级前打开的，刷新即可）。`);
  }
  if (summary.violationTotal > 0) {
    warnings.push(`本场已记录 ${summary.violationTotal} 次违规，涉及 ${summary.violationStudents} 人；误报可在明细里撤销。`);
  }
  if (paper.audience_mode === 'all') {
    warnings.push('可见范围是「全体学生」，应考名单包含所有学生账号；如果只想看某个班，请在名单里按班级筛选。');
  }

  return {
    paper: {
      id: paper.id,
      title: paper.title,
      questionCount,
      totalScore: paper.per_question_score * questionCount,
      passScore: effectivePassScore(paper.pass_score, paper.per_question_score * questionCount),
      startAt: paper.start_at,
      endAt: paper.end_at,
      status: paper.status,
      resultsPublished,
      audienceMode: paper.audience_mode,
    },
    serverNow: now,
    offlineAfterMs: OFFLINE_AFTER_MS,
    summary,
    entries,
    warnings,
  };
}

export interface ViolationItem {
  id: number;
  attemptId: number;
  type: string;
  occurredAt: number;
  revoked: boolean;
  revokedAt: number | null;
  revokedByName: string | null;
  revokeNote: string | null;
}

/** 违规明细（含已撤销的，按时间正序） */
export async function listViolations(db: Db, attemptId: number): Promise<ViolationItem[]> {
  const attempt = await db.selectFrom('attempt').select(['id']).where('id', '=', attemptId).executeTakeFirst();
  if (!attempt) throw new HttpError(404, '答卷不存在');

  const rows = await db
    .selectFrom('attempt_violation as v')
    .leftJoin('user as u', 'u.id', 'v.revoked_by')
    .select([
      'v.id as id',
      'v.attempt_id as attempt_id',
      'v.type as type',
      'v.occurred_at as occurred_at',
      'v.revoked_at as revoked_at',
      'v.revoke_note as revoke_note',
      'u.display_name as revoked_by_name',
    ])
    .where('v.attempt_id', '=', attemptId)
    .orderBy('v.id', 'asc')
    .execute();

  return rows.map((r) => ({
    id: r.id,
    attemptId: r.attempt_id,
    type: r.type,
    occurredAt: r.occurred_at,
    revoked: r.revoked_at != null,
    revokedAt: r.revoked_at,
    revokedByName: r.revoked_by_name,
    revokeNote: r.revoke_note,
  }));
}

/**
 * 撤销一条违规（软撤销）。
 *
 * 只允许撤销「未撤销」的；重复撤销返回 400 而不是静默成功 —— 老师点了两次
 * 应该看到「已经被 XXX 撤销过」，否则会以为自己的操作没生效。
 */
export async function revokeViolation(
  db: Db,
  attemptId: number,
  violationId: number,
  operatorId: number,
  note?: string,
): Promise<{ violations: number }> {
  const row = await db
    .selectFrom('attempt_violation')
    .selectAll()
    .where('id', '=', violationId)
    .where('attempt_id', '=', attemptId)
    .executeTakeFirst();
  if (!row) throw new HttpError(404, '违规记录不存在');

  if (row.revoked_at != null) {
    const who = row.revoked_by
      ? (await db.selectFrom('user').select('display_name').where('id', '=', row.revoked_by).executeTakeFirst())?.display_name
      : null;
    throw new HttpError(400, `这条违规已由${who ?? '他人'}撤销，无需重复操作`);
  }

  await db
    .updateTable('attempt_violation')
    .set({ revoked_at: Date.now(), revoked_by: operatorId, revoke_note: note?.slice(0, 200) ?? null })
    .where('id', '=', violationId)
    .execute();

  return { violations: await countActiveViolations(db, attemptId) };
}

/** 恢复一条被撤销的违规（撤销错了、或者想加回来）。 */
export async function restoreViolation(
  db: Db,
  attemptId: number,
  violationId: number,
): Promise<{ violations: number }> {
  const row = await db
    .selectFrom('attempt_violation')
    .selectAll()
    .where('id', '=', violationId)
    .where('attempt_id', '=', attemptId)
    .executeTakeFirst();
  if (!row) throw new HttpError(404, '违规记录不存在');
  if (row.revoked_at == null) throw new HttpError(400, '这条违规没有被撤销，无需恢复');

  await db
    .updateTable('attempt_violation')
    .set({ revoked_at: null, revoked_by: null, revoke_note: null })
    .where('id', '=', violationId)
    .execute();

  return { violations: await countActiveViolations(db, attemptId) };
}
