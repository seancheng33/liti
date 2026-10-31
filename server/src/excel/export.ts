import ExcelJS from 'exceljs';
import type { Db } from '../db/index.js';

const STATUS_LABEL: Record<string, string> = { in_progress: '进行中', submitted: '已交卷', expired: '已超时' };
export const REASON_LABEL: Record<string, string> = {
  manual: '正常交卷',
  timeout: '异常：超时交卷',
  violation: '异常：违规强制交卷',
};

function fmt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function exportAttemptsXlsx(db: Db): Promise<Buffer> {
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
