import ExcelJS from 'exceljs';
import type { Selectable } from 'kysely';
import type { Db } from '../db/index.js';
import type { AttemptRow } from '../db/types.js';
import { HttpError } from '../http-error.js';
import { loadPaperRoster, sortRoster } from '../paper/roster.js';
import { effectivePassScore } from '../paper/service.js';
import { TEMPLATE_HEADERS } from './template.js';

const STATUS_LABEL: Record<string, string> = { in_progress: '进行中', submitted: '已交卷', expired: '已超时' };
export const REASON_LABEL: Record<string, string> = {
  manual: '正常交卷',
  timeout: '异常：超时交卷',
  violation: '异常：违规强制交卷',
  forced: '教师强制收卷',
};

function fmt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export interface ExportScoresFilter {
  /** 指定试卷则导出「该场考试的成绩册」：以应考名单为主表，缺考的也在表里 */
  paperId?: number;
  /** 只导出某场考试里某个班的学生（教务按班发成绩单用）；不传 = 全部应考的人 */
  className?: string;
}

export async function exportAttemptsXlsx(db: Db, filter: ExportScoresFilter = {}): Promise<Buffer> {
  if (filter.paperId != null) return exportPaperScores(db, filter.paperId, filter.className);
  return exportAllAttempts(db);
}

async function exportAllAttempts(db: Db): Promise<Buffer> {
  const rows = await db
    .selectFrom('attempt')
    .innerJoin('user', 'user.id', 'attempt.user_id')
    .innerJoin('paper', 'paper.id', 'attempt.paper_id')
    .select([
      'user.username as username',
      'user.display_name as display_name',
      'paper.title as paper_title',
      'attempt.score as score',
      'attempt.total_score as total_score',
      'attempt.correct_count as correct_count',
      'paper.question_count as question_count',
      'attempt.status as status',
      'attempt.started_at as started_at',
      'attempt.submitted_at as submitted_at',
      'attempt.submit_reason as submit_reason',
    ])
    .orderBy('attempt.id', 'asc')
    .execute();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('成绩');
  ws.columns = [
    { header: '用户名', key: 'username', width: 16 },
    { header: '姓名', key: 'display_name', width: 16 },
    { header: '试卷', key: 'paper_title', width: 28 },
    { header: '成绩', key: 'score', width: 10 },
    { header: '总分', key: 'total_score', width: 10 },
    { header: '答对', key: 'correct_count', width: 10 },
    { header: '题数', key: 'question_count', width: 10 },
    { header: '状态', key: 'status', width: 12 },
    { header: '开始时间', key: 'started_at', width: 22 },
    { header: '交卷时间', key: 'submitted_at', width: 22 },
    { header: '交卷原因', key: 'submit_reason', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    ws.addRow({
      username: r.username,
      display_name: r.display_name,
      paper_title: r.paper_title,
      score: r.score,
      total_score: r.total_score,
      correct_count: r.correct_count,
      question_count: r.question_count,
      status: STATUS_LABEL[r.status] ?? r.status,
      started_at: fmt(r.started_at),
      submitted_at: r.submitted_at ? fmt(r.submitted_at) : '',
      submit_reason: r.submit_reason ? (REASON_LABEL[r.submit_reason] ?? r.submit_reason) : '',
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * 单场考试的成绩册。
 *
 * 关键差别：**以「应考名单」为主表左连接答卷**，而不是拿 attempt 当主表。
 * 后者会让缺考的人凭空消失 —— 教务拿到表以后还得手工比对名单补人，
 * 而「谁没来考」恰恰是成绩册上最需要一眼看出来的信息。
 */
async function exportPaperScores(db: Db, paperId: number, className?: string): Promise<Buffer> {
  const paper = await db
    .selectFrom('paper')
    .select(['id', 'title', 'audience_mode', 'question_count', 'pass_score', 'per_question_score'])
    .where('id', '=', paperId)
    .executeTakeFirst();
  if (!paper) throw new HttpError(404, '试卷不存在');

  // 应考名单：全体学生，或「点名 ∪ 分组」的并集
  let roster = await loadPaperRoster(db, paperId, paper.audience_mode);

  // 按班筛选（教务按班发成绩单）；不传班级就导全部应考的人
  const classLabel = className?.trim() || '';
  const rosterAll = roster;
  if (classLabel) roster = roster.filter((u) => (u.class_name ?? '') === classLabel);

  sortRoster(roster);

  // 每人取最近一次答卷（补考/重考以最后一次为准）
  const attempts = await db
    .selectFrom('attempt')
    .selectAll()
    .where('paper_id', '=', paperId)
    .orderBy('id', 'desc')
    .execute();
  const latest = new Map<number, Selectable<AttemptRow>>();
  for (const a of attempts) if (!latest.has(a.user_id)) latest.set(a.user_id, a);

  const totalScore = paper.question_count * paper.per_question_score;
  // 练习卷 pass_score=0 表示自动：按总分 60% 折算，判定与展示都用有效值
  const effPassScore = effectivePassScore(paper.pass_score, totalScore);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(classLabel ? `成绩册-${classLabel}` : '成绩册');
  ws.columns = [
    { header: '学号', key: 'student_no', width: 14 },
    { header: '姓名', key: 'display_name', width: 14 },
    { header: '班级', key: 'class_name', width: 16 },
    { header: '用户名', key: 'username', width: 16 },
    { header: '成绩', key: 'score', width: 10 },
    { header: '总分', key: 'total_score', width: 10 },
    { header: '是否及格', key: 'passed', width: 10 },
    { header: '答对', key: 'correct_count', width: 10 },
    { header: '题数', key: 'question_count', width: 10 },
    { header: '状态', key: 'status', width: 12 },
    { header: '开始时间', key: 'started_at', width: 22 },
    { header: '交卷时间', key: 'submitted_at', width: 22 },
    { header: '交卷原因', key: 'submit_reason', width: 14 },
  ];
  ws.getRow(1).font = { bold: true };

  let finished = 0;
  let passedCount = 0;
  for (const u of roster) {
    const a = latest.get(u.id);
    const graded = a && (a.status === 'submitted' || a.status === 'expired');
    if (graded) {
      finished++;
      if (a.score >= effPassScore) passedCount++;
    }
    ws.addRow({
      student_no: u.student_no ?? '',
      display_name: u.display_name,
      class_name: u.class_name ?? '',
      username: u.username,
      score: graded ? a.score : '',
      total_score: totalScore,
      passed: graded ? (a.score >= effPassScore ? '及格' : '不及格') : '',
      correct_count: graded ? a.correct_count : '',
      question_count: paper.question_count,
      status: !a ? '未参加' : (STATUS_LABEL[a.status] ?? a.status),
      started_at: a ? fmt(a.started_at) : '',
      submitted_at: a?.submitted_at ? fmt(a.submitted_at) : '',
      submit_reason: a?.submit_reason ? (REASON_LABEL[a.submit_reason] ?? a.submit_reason) : '',
    });
  }

  // 第二张表：这场考试的基本盘，省得教务再算一遍
  const info = wb.addWorksheet('考试信息');
  info.columns = [
    { header: '项目', key: 'k', width: 18 },
    { header: '值', key: 'v', width: 32 },
  ];
  info.getRow(1).font = { bold: true };
  info.addRow({ k: '试卷', v: paper.title });
  info.addRow({ k: '题量', v: paper.question_count });
  info.addRow({ k: '每题分值', v: paper.per_question_score });
  info.addRow({ k: '总分', v: totalScore });
  info.addRow({ k: '及格线', v: paper.pass_score > 0 ? paper.pass_score : `自动（满分的 60% = ${effPassScore} 分）` });
  if (classLabel) {
    info.addRow({ k: '本次导出班级', v: classLabel });
    info.addRow({ k: '该场应考总人数', v: rosterAll.length });
  }
  info.addRow({ k: classLabel ? '本班应考人数' : '应考人数', v: roster.length });
  info.addRow({ k: '已交卷人数', v: finished });
  info.addRow({ k: '缺考人数', v: roster.length - finished });
  info.addRow({ k: '及格人数', v: passedCount });
  info.addRow({
    k: '及格率',
    v: finished ? `${Math.round((passedCount / finished) * 1000) / 10}%` : '—',
  });
  info.addRow({
    k: '说明',
    v: classLabel
      ? '每人取最近一次答卷；缺考显示「未参加」；本表只含该班学生'
      : '每人取最近一次答卷；缺考显示「未参加」；按班级、学号排序',
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* ============================================================
 * 题库导出
 * ============================================================ */

export interface ExportQuestionsFilter {
  keyword?: string;
  categoryId?: number | null;
  type?: string;
  /** active=在用（默认）；archived=已删除；all=全部 */
  status?: 'active' | 'archived' | 'all';
}

const MAX_EXPORT_ROWS = 5000;
const LETTERS = 'ABCDEF';

/**
 * 导出题库为 xlsx。
 *
 * **列结构刻意和「导入模板」一模一样（12 列）**，这样「导出 → 在 Excel 里改 → 导回去」
 * 是闭环的，不用手工对字段。代价是配图不在表格里（模板本来就没有图片列），
 * 所以第二张表里会写清楚这件事，免得以为导出是完整备份。
 */
export async function exportQuestionsXlsx(
  db: Db,
  filter: ExportQuestionsFilter,
): Promise<{ buffer: Buffer; count: number; truncated: boolean }> {
  let q = db.selectFrom('question');
  if (filter.keyword) q = q.where('stem', 'like', `%${filter.keyword}%`);
  if (filter.categoryId != null) q = q.where('category_id', '=', filter.categoryId);
  if (filter.type === 'single' || filter.type === 'multiple') q = q.where('type', '=', filter.type);
  if (filter.status !== 'all') {
    q = q.where('status', '=', (filter.status ?? 'active') as 'active' | 'archived');
  }

  const totalRow = await q.select((eb) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  const total = Number(totalRow.c);

  const rows = await q
    .selectAll()
    .orderBy('id', 'asc')
    .limit(MAX_EXPORT_ROWS)
    .execute();

  const ids = rows.map((r) => r.id);
  const options = ids.length
    ? await db
        .selectFrom('question_option')
        .select(['question_id', 'content', 'is_correct', 'sort_order'])
        .where('question_id', 'in', ids)
        .orderBy('sort_order', 'asc')
        .execute()
    : [];
  const optionMap = new Map<number, typeof options>();
  for (const o of options) {
    const list = optionMap.get(o.question_id) ?? [];
    list.push(o);
    optionMap.set(o.question_id, list);
  }

  const catIds = [...new Set(rows.map((r) => r.category_id).filter((v): v is number => v != null))];
  const cats = catIds.length
    ? await db.selectFrom('category').select(['id', 'name']).where('id', 'in', catIds).execute()
    : [];
  const catMap = new Map(cats.map((c) => [c.id, c.name]));

  const wb = new ExcelJS.Workbook();
  wb.creator = '砺题 Liti';
  wb.created = new Date();

  const ws = wb.addWorksheet('题目', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = TEMPLATE_HEADERS.map((h) => ({
    header: h,
    key: h,
    width: h === '题干' || h === '解析' ? 40 : h === '正确答案' ? 12 : 20,
  }));
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11 };
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFD7F5' } } };
  });

  for (const r of rows) {
    const opts = optionMap.get(r.id) ?? [];
    const answer = opts
      .map((o, i) => (o.is_correct === 1 ? LETTERS[i] ?? '' : ''))
      .join('');
    let tags: string[] = [];
    if (r.tags) {
      try {
        const parsed = JSON.parse(r.tags);
        if (Array.isArray(parsed)) tags = parsed.map((t) => String(t));
      } catch {
        tags = String(r.tags).split(',');
      }
    }

    const record: Record<string, string> = {
      题型: r.type === 'multiple' ? '多选' : '单选',
      题干: r.stem,
      正确答案: answer,
      解析: r.explanation ?? '',
      分类: r.category_id != null ? (catMap.get(r.category_id) ?? '') : '',
      标签: tags.join(','),
    };
    for (let i = 0; i < 6; i++) record[`选项${LETTERS[i]}`] = opts[i]?.content ?? '';

    ws.addRow(record);
  }

  // 第二张表：把「这次导出的是什么」写清楚，避免拿着导出文件当完整备份
  const help = wb.addWorksheet('导出信息');
  help.columns = [
    { key: 'k', width: 16 },
    { key: 'v', width: 72 },
  ];
  help.getRow(1).values = ['项目', '说明'];
  help.getRow(1).font = { bold: true };

  // 筛选用的分类名单独查一次（导出的行里可能没有这个分类的题）
  let filterCatName: string | null = null;
  if (filter.categoryId != null) {
    const c = await db.selectFrom('category').select('name').where('id', '=', filter.categoryId).executeTakeFirst();
    filterCatName = c?.name ?? null;
  }
  const conditions = [
    filter.keyword ? `题干包含「${filter.keyword}」` : '不限题干',
    filter.categoryId != null ? `分类：${filterCatName ?? filter.categoryId}` : '全部分类',
    filter.type ? `题型：${filter.type === 'multiple' ? '多选' : '单选'}` : '全部题型',
    filter.status === 'archived' ? '仅已删除题目' : filter.status === 'all' ? '在用 + 已删除' : '仅在用题目',
  ];
  help.addRow({ k: '导出时间', v: fmt(Date.now()) });
  help.addRow({ k: '题目数量', v: String(rows.length) });
  help.addRow({ k: '筛选条件', v: conditions.join('；') });
  help.addRow({});
  help.addRow({ k: '怎么用', v: '这张表和「下载模板」的结构完全一致：改完可以直接用「Excel 导入」导回去。' });
  help.addRow({ k: '注意', v: '题目配图不在表格里（模板没有图片列）。导出不会删除任何题目，导入时按题干查重。' });
  if (total > rows.length) {
    help.addRow({ k: '注意', v: `本次共命中 ${total} 道题，只导出了前 ${rows.length} 道；请加筛选条件分批导出。` });
  }

  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf), count: rows.length, truncated: total > rows.length };
}
