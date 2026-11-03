/**
 * 演示数据：清空 + 重灌。
 *
 * 独立于 `seed.ts`：那个只建三个初始账号，是给正式部署用的；
 * 这个造一整套「用了一学期」的现场，只在 DEMO_MODE 下跑。
 *
 * 两个入口：
 * - `resetDemoData(db)`  重建全部演示数据（容器启动时、或手动触发）
 * - `ensureDemoScenario(db)` 只做一件事：保证「进行中」的考试始终有人，
 *   否则演示页放一天之后，监考视图里一个人都没有，那就没得看了
 */
import { createHash } from 'node:crypto';
import type { Db } from '../db/index.js';
import { hashPassword } from '../auth/password.js';
import {
  DEMO_ADMIN,
  DEMO_ANNOUNCEMENT,
  DEMO_CATEGORIES,
  DEMO_GROUPS,
  DEMO_QUESTIONS,
  DEMO_SITE_NAME,
  DEMO_STUDENTS,
  DEMO_STUDENT_PASSWORD,
  DEMO_TEACHERS,
  type DemoQuestion,
} from './data.js';

/** 期中测验的标题。ensureDemoScenario 靠它找回演示卷 */
export const LIVE_PAPER_TITLE = '第 3 章 网络基础 · 随堂练';
const MIDTERM_TITLE = '期中测验 · 计算机基础';
const FINAL_TITLE = '期末模拟卷（随机组卷）';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** 进行中答卷的有效期：给 32 分钟，够看完监考页再点进去做几道题 */
const LIVE_WINDOW_MS = 32 * 60_000;

/** 固定种子随机：每次重置出来的成绩分布一模一样。刷新页面成绩全变会让人以为系统在乱算 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}

/** 按难度和水平算答对概率。水平高的人难题也会做错，水平低的简单题也可能蒙对 */
function hitRate(q: DemoQuestion, level: number): number {
  const p = 0.96 - q.difficulty * 0.85 + (level - 0.6) * 0.65;
  return Math.max(0.06, Math.min(0.97, p));
}

/**
 * 造一个错误答案：单选就挑个错的选项，多选就从正确项里漏一个或多加一个。
 * 保证结果一定不等于正确答案，否则「错的答案」反而被判对。
 */
function wrongSelection(q: DemoQuestion, rnd: () => number): number[] {
  const correct = new Set(q.correct);
  const wrongIdx = q.options.map((_, i) => i).filter((i) => !correct.has(i));
  if (q.type === 'single') return [pick(wrongIdx, rnd)];

  const mode = rnd();
  if (mode < 0.5 && q.correct.length > 1) {
    // 漏选一个
    const drop = q.correct[Math.floor(rnd() * q.correct.length)];
    return q.correct.filter((i) => i !== drop);
  }
  if (mode < 0.8) {
    // 多选一个错的
    return [...q.correct, pick(wrongIdx, rnd)].sort((a, b) => a - b);
  }
  return [pick(wrongIdx, rnd)];
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** 要清的表，按依赖倒序：先删引用别人的，再删被引用的 */
const TABLES_TO_CLEAR = [
  'audit_log',
  'password_reset',
  'wrong_question',
  'attempt_violation',
  'attempt_item',
  'attempt',
  'paper_audience_group',
  'paper_audience',
  'paper_item',
  'paper',
  'student_group_member',
  'student_group',
  'question_option',
  'question',
  'category',
  'import_batch',
  'session',
  'setting',
  'user',
] as const;

async function clearAll(db: Db): Promise<void> {
  for (const t of TABLES_TO_CLEAR) {
    await db.deleteFrom(t).execute();
  }
}

export interface ResetResult {
  users: number;
  questions: number;
  papers: number;
  attempts: number;
}

export async function resetDemoData(db: Db, now = Date.now()): Promise<ResetResult> {
  await clearAll(db);

  const rnd = mulberry32(20261103);

  // ---------- 账号 ----------
  // 学生密码都一样，argon2 只算一次再复用：24 个账号各算一遍要好几秒，
  // 而重置是每小时自动跑的，没必要为了「每个 hash 都不同」拖慢它。
  const studentHash = await hashPassword(DEMO_STUDENT_PASSWORD);
  const teacherHash = await hashPassword(DEMO_TEACHERS[0].password);
  const adminHash = await hashPassword(DEMO_ADMIN.password);

  const adminId = Number(
    (
      await db
        .insertInto('user')
        .values({
          username: DEMO_ADMIN.username,
          display_name: DEMO_ADMIN.displayName,
          password_hash: adminHash,
          role: 'admin',
          provider: 'local',
          external_id: null,
          status: 'active',
          created_at: now - 90 * DAY,
          updated_at: now - 90 * DAY,
        })
        .executeTakeFirstOrThrow()
    ).insertId,
  );

  const teacherIds: number[] = [];
  for (const [i, t] of DEMO_TEACHERS.entries()) {
    const id = Number(
      (
        await db
          .insertInto('user')
          .values({
            username: t.username,
            display_name: t.displayName,
            password_hash: teacherHash,
            role: 'teacher',
            provider: 'local',
            external_id: null,
            status: 'active',
            created_at: now - (88 - i) * DAY,
            updated_at: now - (88 - i) * DAY,
          })
          .executeTakeFirstOrThrow()
      ).insertId,
    );
    teacherIds.push(id);
  }

  const studentRows = DEMO_STUDENTS.map((s, i) => ({
    username: s.username,
    display_name: s.displayName,
    password_hash: studentHash,
    role: 'student' as const,
    provider: 'local' as const,
    external_id: null,
    status: 'active' as const,
    student_no: s.studentNo,
    class_name: s.className,
    created_at: now - (60 - (i % 10)) * DAY,
    updated_at: now - (60 - (i % 10)) * DAY,
  }));
  await db.insertInto('user').values(studentRows).execute();

  const studentUsers = await db
    .selectFrom('user')
    .select(['id', 'username', 'display_name', 'class_name'])
    .where('role', '=', 'student')
    .orderBy('id')
    .execute();
  const userIdByName = new Map(studentUsers.map((u) => [u.username, u.id]));
  const studentId = (username: string): number => userIdByName.get(username)!;

  // ---------- 分类 ----------
  const categoryIdByName = new Map<string, number>();
  for (const [i, parent] of DEMO_CATEGORIES.entries()) {
    const parentId = Number(
      (
        await db
          .insertInto('category')
          .values({ name: parent.name, parent_id: null, sort: i + 1, created_at: now - 85 * DAY })
          .executeTakeFirstOrThrow()
      ).insertId,
    );
    categoryIdByName.set(parent.name, parentId);
    for (const [j, child] of parent.children.entries()) {
      const childId = Number(
        (
          await db
            .insertInto('category')
            .values({ name: child, parent_id: parentId, sort: j + 1, created_at: now - 85 * DAY })
            .executeTakeFirstOrThrow()
        ).insertId,
      );
      categoryIdByName.set(child, childId);
    }
  }

  // ---------- 题目 ----------
  const questionIds: number[] = [];
  const questionMeta: DemoQuestion[] = [];
  for (const [i, q] of DEMO_QUESTIONS.entries()) {
    const createdAt = now - (70 - (i % 40)) * DAY;
    const qid = Number(
      (
        await db
          .insertInto('question')
          .values({
            type: q.type,
            stem: q.stem,
            images: null,
            explanation: q.explanation,
            category_id: categoryIdByName.get(q.category) ?? null,
            tags: q.tags.length ? JSON.stringify(q.tags) : null,
            status: 'active',
            content_hash: sha256(q.stem.trim().replace(/\s+/g, ' ')),
            created_by: teacherIds[i % teacherIds.length],
            created_at: createdAt,
            updated_at: createdAt,
          })
          .executeTakeFirstOrThrow()
      ).insertId,
    );
    await db
      .insertInto('question_option')
      .values(
        q.options.map((content, k) => ({
          question_id: qid,
          content,
          images: null,
          is_correct: q.correct.includes(k) ? 1 : 0,
          sort_order: k + 1,
        })),
      )
      .execute();
    questionIds.push(qid);
    questionMeta.push(q);
  }
  const qIdOf = (index: number): number => questionIds[index];

  // ---------- 学生分组 ----------
  for (const [i, g] of DEMO_GROUPS.entries()) {
    const gid = Number(
      (
        await db
          .insertInto('student_group')
          .values({
            name: g.name,
            remark: g.remark || null,
            created_by: teacherIds[0],
            created_at: now - (50 - i) * DAY,
            updated_at: now - (50 - i) * DAY,
          })
          .executeTakeFirstOrThrow()
      ).insertId,
    );
    const members = studentUsers
      .filter((u) => u.class_name === g.className)
      .map((u) => ({ group_id: gid, user_id: u.id, created_at: now - 40 * DAY }));
    if (members.length) await db.insertInto('student_group_member').values(members).execute();
  }

  // ---------- 试卷 ----------
  async function createPaper(input: {
    title: string;
    mode: 'fixed' | 'random';
    qidx: number[];
    durationSec: number;
    perQuestionScore: number;
    reviewMode: 'after_submit' | 'immediate' | 'never';
    shuffleQuestions?: number;
    allowStudentPause?: number;
    resultsPublished: number;
    analysisPublished: number;
    startAt: number | null;
    endAt: number | null;
    status: 'draft' | 'published' | 'archived';
    randomRules?: { categoryId: number; count: number }[];
    maxAttempts?: number;
    createdAt: number;
  }): Promise<{ paperId: number; items: { questionId: number; score: number }[] }> {
    const paperId = Number(
      (
        await db
          .insertInto('paper')
          .values({
            title: input.title,
            mode: input.mode,
            question_count: input.qidx.length,
            duration_sec: input.durationSec,
            pass_score: 60,
            review_mode: input.reviewMode,
            shuffle_options: 1,
            shuffle_questions: input.shuffleQuestions ?? 0,
            random_config: input.randomRules ? JSON.stringify(input.randomRules) : null,
            status: input.status,
            practice: 0,
            practice_source: null,
            audience_mode: 'all',
            start_at: input.startAt,
            end_at: input.endAt,
            allow_student_pause: input.allowStudentPause ?? 0,
            per_question_score: input.perQuestionScore,
            results_published: input.resultsPublished,
            analysis_published: input.analysisPublished,
            max_attempts: input.maxAttempts ?? 1,
            created_by: teacherIds[0],
            created_at: input.createdAt,
            updated_at: input.createdAt,
          })
          .executeTakeFirstOrThrow()
      ).insertId,
    );
    const items = input.qidx.map((idx, i) => ({
      paperId,
      questionId: qIdOf(idx),
      score: input.perQuestionScore,
      qidx: idx,
      orderNo: i + 1,
    }));
    await db
      .insertInto('paper_item')
      .values(items.map((it) => ({ paper_id: paperId, question_id: it.questionId, order_no: it.orderNo, score: it.score })))
      .execute();
    return { paperId, items: items.map((it) => ({ questionId: it.questionId, score: it.score })) };
  }

  const today0 = new Date(now);
  today0.setHours(0, 0, 0, 0);
  const dayStart = today0.getTime();

  // 期中：20 题（硬件 13 + 操作系统 7），昨天上午考完，已公布分数与解析
  const midterm = await createPaper({
    title: MIDTERM_TITLE,
    mode: 'fixed',
    qidx: Array.from({ length: 20 }, (_, i) => i),
    durationSec: 60 * 60,
    perQuestionScore: 5,
    reviewMode: 'after_submit',
    resultsPublished: 1,
    analysisPublished: 1,
    startAt: dayStart - DAY + 8 * HOUR,
    endAt: dayStart - DAY + 9 * HOUR + 30 * 60_000,
    status: 'published',
    createdAt: dayStart - 7 * DAY,
  });

  // 随堂练：网络 10 题，今天全天窗口，正在进行，分数还没公布
  const live = await createPaper({
    title: LIVE_PAPER_TITLE,
    mode: 'fixed',
    qidx: Array.from({ length: 10 }, (_, i) => 24 + i),
    durationSec: 30 * 60,
    perQuestionScore: 10,
    reviewMode: 'after_submit',
    shuffleQuestions: 1,
    allowStudentPause: 1,
    resultsPublished: 0,
    analysisPublished: 0,
    startAt: dayStart,
    endAt: dayStart + DAY,
    status: 'published',
    createdAt: dayStart - 2 * DAY,
    // 真实场景里一场随堂练给 2 次就够，但演示站是给陌生人反复点的：
    // 给 2 次的话头两个人点完，第三个人点进去就是「次数已用完」
    maxAttempts: 50,
  });

  // 期末模拟：随机组卷 30 题，明天上午的窗口，还没开始
  await createPaper({
    title: FINAL_TITLE,
    mode: 'random',
    qidx: Array.from({ length: 30 }, (_, i) => i),
    durationSec: 90 * 60,
    perQuestionScore: 5,
    reviewMode: 'never',
    resultsPublished: 0,
    analysisPublished: 0,
    startAt: dayStart + DAY + 8 * HOUR,
    endAt: dayStart + DAY + 10 * HOUR,
    status: 'published',
    createdAt: dayStart - 1 * DAY,
    randomRules: [
      { categoryId: categoryIdByName.get('硬件基础')!, count: 10 },
      { categoryId: categoryIdByName.get('操作系统')!, count: 10 },
      { categoryId: categoryIdByName.get('网络基础')!, count: 10 },
    ],
  });

  // 一张归档的旧卷：让人看到「归档」这个状态不是空概念
  await createPaper({
    title: '开学摸底 · 计算机常识',
    mode: 'fixed',
    qidx: [2, 3, 12, 13, 24, 25, 34, 35],
    durationSec: 20 * 60,
    perQuestionScore: 10,
    reviewMode: 'after_submit',
    resultsPublished: 1,
    analysisPublished: 1,
    startAt: dayStart - 60 * DAY,
    endAt: dayStart - 60 * DAY + 2 * HOUR,
    status: 'archived',
    createdAt: dayStart - 65 * DAY,
  });

  // ---------- 期中答卷：19 人参考，5 人缺考 ----------
  const examStartBase = dayStart - DAY + 8 * HOUR;
  const attendees = studentUsers.slice(0, 19);
  let attemptCount = 0;

  for (const [i, stu] of attendees.entries()) {
    const level = DEMO_STUDENTS.find((s) => s.username === stu.username)?.level ?? 0.6;
    const startedAt = examStartBase + i * 40_000 + Math.floor(rnd() * 20_000);
    const submittedAt = startedAt + (40 + Math.floor(rnd() * 18)) * 60_000;

    const rows: {
      questionId: number;
      orderNo: number;
      selected: number[];
      ok: boolean;
      score: number;
      optionOrder: number[];
    }[] = [];

    for (const [k, item] of midterm.items.entries()) {
      // 期中卷按题库前 20 题顺序组卷，第 k 题就是 DEMO_QUESTIONS[k]
      const q = DEMO_QUESTIONS[k];
      const ok = rnd() < hitRate(q, level);
      const selected = ok ? [...q.correct].sort((a, b) => a - b) : wrongSelection(q, rnd);
      rows.push({
        questionId: item.questionId,
        orderNo: k + 1,
        selected,
        ok,
        score: ok ? item.score : 0,
        optionOrder: [],
      });
    }

    const total = rows.reduce((s, r) => s + r.score, 0);
    const correctCount = rows.filter((r) => r.ok).length;

    const attemptId = Number(
      (
        await db
          .insertInto('attempt')
          .values({
            paper_id: midterm.paperId,
            user_id: stu.id,
            started_at: startedAt,
            deadline_at: startedAt + 60 * 60_000,
            submitted_at: submittedAt,
            status: 'submitted',
            score: total,
            total_score: midterm.items.length * 5,
            correct_count: correctCount,
            submit_reason: 'manual',
            paused_at: null,
            paused_total_ms: 0,
            last_seen_at: submittedAt,
            created_at: startedAt,
          })
          .executeTakeFirstOrThrow()
      ).insertId,
    );
    attemptCount++;

    // 选项顺序：shuffle_options=1 时每个人不一样。这里存 1..N 的原始顺序即可，
    // 判分只认选项 id，顺序只影响卷面显示。
    for (const row of rows) {
      const opts = await db
        .selectFrom('question_option')
        .select('id')
        .where('question_id', '=', row.questionId)
        .orderBy('id')
        .execute();
      const optionIds = opts.map((o) => o.id);
      const selectedIds = row.selected.map((idx) => optionIds[idx]).filter((v) => v !== undefined);
      await db
        .insertInto('attempt_item')
        .values({
          attempt_id: attemptId,
          question_id: row.questionId,
          order_no: row.orderNo,
          option_order: JSON.stringify(optionIds),
          selected: JSON.stringify(selectedIds),
          is_correct: row.ok ? 1 : 0,
          score: row.score,
          flagged: 0,
          answered_at: startedAt + row.orderNo * 90_000,
        })
        .execute();

      if (!row.ok) {
        await db
          .insertInto('wrong_question')
          .values({
            user_id: stu.id,
            question_id: row.questionId,
            wrong_count: 1,
            first_wrong_at: submittedAt,
            last_wrong_at: submittedAt,
            last_attempt_id: attemptId,
            resolved_at: null,
            created_at: submittedAt,
            updated_at: submittedAt,
          })
          .execute();
      }
    }
  }

  // ---------- 随堂练：5 人在考，3 在线 / 1 掉线 / 1 暂停 ----------
  // 这五条是「活」的，容器跑久了会被 sweeper 收掉，
  // 所以 ensureDemoScenario 会在没人时重新补一批。
  const liveStudents = studentUsers.slice(19, 24);
  for (const [i, stu] of liveStudents.entries()) {
    const startedAt = now - (i + 1) * 6 * 60_000 - Math.floor(rnd() * 60_000);
    const paused = i === 4;
    const lastSeen = i === 3 ? now - 6 * 60_000 : now - (10 + i * 12) * 1000;

    const attemptId = Number(
      (
        await db
          .insertInto('attempt')
          .values({
            paper_id: live.paperId,
            user_id: stu.id,
            started_at: startedAt,
            deadline_at: now + LIVE_WINDOW_MS,
            submitted_at: null,
            status: 'in_progress',
            score: 0,
            total_score: live.items.length * 10,
            correct_count: 0,
            submit_reason: null,
            paused_at: paused ? now - 2 * 60_000 : null,
            paused_total_ms: paused ? 2 * 60_000 : 0,
            last_seen_at: lastSeen,
            created_at: startedAt,
          })
          .executeTakeFirstOrThrow()
      ).insertId,
    );
    attemptCount++;

    const answered = 2 + ((i * 3) % 6);
    for (const [k, item] of live.items.entries()) {
      const opts = await db
        .selectFrom('question_option')
        .select('id')
        .where('question_id', '=', item.questionId)
        .orderBy('id')
        .execute();
      const optionIds = opts.map((o) => o.id);
      const q = DEMO_QUESTIONS[24 + k];
      const done = k < answered;
      const ok = done && rnd() < hitRate(q, 0.6);
      const selectedIdx = done ? (ok ? q.correct : wrongSelection(q, rnd)) : [];
      await db
        .insertInto('attempt_item')
        .values({
          attempt_id: attemptId,
          question_id: item.questionId,
          order_no: k + 1,
          option_order: JSON.stringify([...optionIds].reverse()),
          selected: done ? JSON.stringify(selectedIdx.map((idx) => optionIds[idx]).filter((v) => v !== undefined)) : null,
          is_correct: null,
          score: 0,
          flagged: k === 1 ? 1 : 0,
          answered_at: done ? startedAt + (k + 1) * 60_000 : null,
        })
        .execute();
    }

    // 第三个人有一条已撤销的切屏记录，顺便展示「撤销违规」这个动作
    if (i === 2) {
      await db
        .insertInto('attempt_violation')
        .values({
          attempt_id: attemptId,
          type: 'blur',
          occurred_at: startedAt + 5 * 60_000,
          meta: JSON.stringify({ durationMs: 1500 }),
          revoked_at: startedAt + 6 * 60_000,
          revoked_by: teacherIds[0],
          revoke_note: '学生说明是输入法弹窗，误触',
        })
        .execute();
    }
    if (i === 1) {
      await db
        .insertInto('attempt_violation')
        .values({
          attempt_id: attemptId,
          type: 'blur',
          occurred_at: startedAt + 8 * 60_000,
          meta: JSON.stringify({ durationMs: 12000 }),
          revoked_at: null,
          revoked_by: null,
          revoke_note: null,
        })
        .execute();
    }
  }

  // ---------- 审计日志 ----------
  const auditRows: {
    at: number;
    actorId: number | null;
    actorName: string;
    actorRole: string;
    action: string;
    targetType: string | null;
    targetLabel: string | null;
    detail: string | null;
  }[] = [
    { at: now - 90 * DAY, actorId: adminId, actorName: '李建国', actorRole: 'admin', action: 'user.create', targetType: 'user', targetLabel: '张海燕', detail: JSON.stringify({ role: 'teacher' }) },
    { at: now - 85 * DAY, actorId: teacherIds[0], actorName: '张海燕', actorRole: 'teacher', action: 'category.create', targetType: 'category', targetLabel: '计算机基础', detail: null },
    { at: now - 70 * DAY, actorId: teacherIds[0], actorName: '张海燕', actorRole: 'teacher', action: 'question.create', targetType: 'question', targetLabel: '计算机中负责执行指令、完成运算的核心部件是？', detail: null },
    { at: now - 62 * DAY, actorId: teacherIds[0], actorName: '张海燕', actorRole: 'teacher', action: 'user.import', targetType: 'user', targetLabel: '学生名单.xlsx', detail: JSON.stringify({ total: 24, success: 24, failed: 0 }) },
    { at: now - 60 * DAY, actorId: teacherIds[0], actorName: '张海燕', actorRole: 'teacher', action: 'paper.publish', targetType: 'paper', targetLabel: '开学摸底 · 计算机常识', detail: null },
    { at: now - 58 * DAY, actorId: teacherIds[1], actorName: '陈志强', actorRole: 'teacher', action: 'paper.archive', targetType: 'paper', targetLabel: '开学摸底 · 计算机常识', detail: null },
    { at: dayStart - 7 * DAY, actorId: teacherIds[0], actorName: '张海燕', actorRole: 'teacher', action: 'paper.publish', targetType: 'paper', targetLabel: MIDTERM_TITLE, detail: null },
    { at: dayStart - DAY + 8 * HOUR, actorId: null, actorName: '系统', actorRole: 'system', action: 'attempt.auto-close', targetType: 'attempt', targetLabel: '自动收卷 1 份', detail: JSON.stringify({ closed: 1 }) },
    { at: dayStart - DAY + 3 * HOUR, actorId: teacherIds[0], actorName: '张海燕', actorRole: 'teacher', action: 'paper.results-publish', targetType: 'paper', targetLabel: MIDTERM_TITLE, detail: JSON.stringify({ results: true, analysis: true }) },
    { at: dayStart - 2 * DAY, actorId: teacherIds[1], actorName: '陈志强', actorRole: 'teacher', action: 'paper.publish', targetType: 'paper', targetLabel: LIVE_PAPER_TITLE, detail: null },
    { at: now - 3 * HOUR, actorId: teacherIds[1], actorName: '陈志强', actorRole: 'teacher', action: 'violation.revoke', targetType: 'attempt', targetLabel: '何嘉懿', detail: JSON.stringify({ type: 'blur' }) },
    { at: now - 1 * HOUR, actorId: adminId, actorName: '李建国', actorRole: 'admin', action: 'auth.login', targetType: 'user', targetLabel: '李建国', detail: null },
  ];
  await db
    .insertInto('audit_log')
    .values(
      auditRows.map((r) => ({
        at: r.at,
        actor_id: r.actorId,
        actor_name: r.actorName,
        actor_role: r.actorRole,
        action: r.action,
        target_type: r.targetType,
        target_id: null,
        target_label: r.targetLabel,
        detail: r.detail,
        ip: '192.168.1.' + (20 + (r.actorId ?? 0)),
      })),
    )
    .execute();

  // ---------- 站点设置 ----------
  await db
    .insertInto('setting')
    .values([
      { key: 'site_name', value: DEMO_SITE_NAME, updated_at: now },
      { key: 'site_announcement', value: DEMO_ANNOUNCEMENT, updated_at: now },
    ])
    .execute();

  return { users: studentUsers.length + 3, questions: questionIds.length, papers: 4, attempts: attemptCount };
}

/**
 * 让「进行中」的考试不至于断档。
 *
 * 演示站挂在公网上，种子数据里的 in_progress 答卷过了截止时间就会被 sweeper 收掉，
 * 之后监考视图里干干净净，访客点进「实时监考」看到一片「未开始」，就没什么可看的了。
 *
 * 这里只做最小修复：把该卷还活着的答卷续上时间；一条都不剩就补五份新的。
 * 不动已提交的成绩，否则访客做了一半的卷子会被抹掉。
 */
export async function ensureDemoScenario(db: Db, now = Date.now()): Promise<'ok' | 'renewed' | 'reseeded'> {
  const paper = await db
    .selectFrom('paper')
    .select('id')
    .where('title', '=', LIVE_PAPER_TITLE)
    .executeTakeFirst();
  if (!paper) return 'ok';

  const alive = await db
    .selectFrom('attempt')
    .select(['id', 'user_id', 'deadline_at', 'paused_at'])
    .where('paper_id', '=', paper.id)
    .where('status', '=', 'in_progress')
    .execute();

  if (alive.length >= 3) {
    // 让前面几个保持「在线」：不刷心跳的话，监考页放半小时就变成一片掉线。
    // 只刷前三个，第四个故意留着 —— 「掉线」这个状态本身也是演示的一部分。
    const running = alive.filter((a) => a.paused_at == null).slice(0, 3);
    if (running.length) {
      await db
        .updateTable('attempt')
        .set({ last_seen_at: now - 15_000 })
        .where(
          'id',
          'in',
          running.map((a) => a.id),
        )
        .execute();
    }

    // 快到期的往后推，别让监考页突然清空
    const soon = alive.filter((a) => a.deadline_at <= now + 3 * 60_000);
    if (!soon.length) return 'ok';
    await db
      .updateTable('attempt')
      .set({ deadline_at: now + LIVE_WINDOW_MS })
      .where(
        'id',
        'in',
        soon.map((a) => a.id),
      )
      .execute();
    return 'renewed';
  }

  // 人不够了：挑几个当天没在考的学生，补五份答卷
  const items = await db
    .selectFrom('paper_item')
    .select(['question_id', 'order_no', 'score'])
    .where('paper_id', '=', paper.id)
    .orderBy('order_no')
    .execute();
  if (!items.length) return 'ok';

  const busy = new Set(alive.map((a) => a.user_id));
  const candidates = await db
    .selectFrom('user')
    .select(['id'])
    .where('role', '=', 'student')
    .where('status', '=', 'active')
    .orderBy('id')
    .execute();
  const picked = candidates.filter((u) => !busy.has(u.id)).slice(0, 5);
  const rnd = mulberry32(now & 0xffff);

  for (const [i, stu] of picked.entries()) {
    const startedAt = now - (i + 1) * 5 * 60_000;
    const attemptId = Number(
      (
        await db
          .insertInto('attempt')
          .values({
            paper_id: paper.id,
            user_id: stu.id,
            started_at: startedAt,
            deadline_at: now + LIVE_WINDOW_MS,
            submitted_at: null,
            status: 'in_progress',
            score: 0,
            total_score: items.length * 10,
            correct_count: 0,
            submit_reason: null,
            paused_at: i === 4 ? now - 60_000 : null,
            paused_total_ms: i === 4 ? 60_000 : 0,
            last_seen_at: i === 3 ? now - 6 * 60_000 : now - 15_000,
            created_at: startedAt,
          })
          .executeTakeFirstOrThrow()
      ).insertId,
    );

    const answered = 2 + ((i * 2) % 5);
    for (const [k, item] of items.entries()) {
      const opts = await db
        .selectFrom('question_option')
        .select('id')
        .where('question_id', '=', item.question_id)
        .orderBy('id')
        .execute();
      const optionIds = opts.map((o) => o.id);
      const done = k < answered;
      // 随堂练固定取网络基础那一段（题库下标 24 起），顺序与组卷顺序一致
      const q = DEMO_QUESTIONS[24 + k];
      const ok = done && rnd() < 0.6;
      const selectedIdx = done && q ? (ok ? q.correct : wrongSelection(q, rnd)) : [];
      await db
        .insertInto('attempt_item')
        .values({
          attempt_id: attemptId,
          question_id: item.question_id,
          order_no: item.order_no,
          option_order: JSON.stringify([...optionIds].reverse()),
          selected: done ? JSON.stringify(selectedIdx.map((idx) => optionIds[idx]).filter((v) => v !== undefined)) : null,
          is_correct: null,
          score: 0,
          flagged: 0,
          answered_at: done ? startedAt + (k + 1) * 60_000 : null,
        })
        .execute();
    }
  }

  return 'reseeded';
}
