import ExcelJS from 'exceljs';
import type { Db } from '../db/index.js';
import { analyzePaper, type PaperAnalysis } from '../attempt/analysis.js';

const VERDICT_LABEL: Record<string, string> = {
  normal: '正常',
  'too-hard': '偏难',
  'too-easy': '偏易',
  'low-discrimination': '区分度低',
  'check-answer': '疑答案有误',
};

const REASON_LABEL: Record<string, string> = {
  manual: '正常交卷',
  timeout: '超时交卷',
  violation: '违规交卷',
  forced: '强制收卷',
};

function fmt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

function stemBrief(stem: string, max = 60): string {
  const flat = stem.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * 逐题分析导出。三张表：逐题 / 分数段 / 考试信息。
 *
 * 表里把「判断」与「提示」都写出来，是因为这份表通常直接发给教研或年级组长 ——
 * 他们不会去看 P 值 / D 值的定义，但看得懂「这题区分度低，建议换掉」。
 */
export async function exportAnalysisXlsx(db: Db, paperId: number, className?: string): Promise<Buffer> {
  const data: PaperAnalysis = await analyzePaper(db, paperId, { className });
  const s = data.summary;

  const wb = new ExcelJS.Workbook();
  wb.creator = '砺题 Liti';
  wb.created = new Date();

  // ---- 第一张表：逐题 ----
  const ws = wb.addWorksheet('逐题分析', { views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }] });
  ws.columns = [
    { header: '题号', key: 'orderNo', width: 8 },
    { header: '题型', key: 'type', width: 8 },
    { header: '题干', key: 'stem', width: 46 },
    { header: '分类', key: 'category', width: 14 },
    { header: '分值', key: 'score', width: 8 },
    { header: '作答人数', key: 'answered', width: 10 },
    { header: '未作答', key: 'blank', width: 10 },
    { header: '答对人数', key: 'correct', width: 10 },
    { header: '正确率(P)', key: 'p', width: 12 },
    { header: '高分组', key: 'high', width: 10 },
    { header: '低分组', key: 'low', width: 10 },
    { header: 'D 值', key: 'd', width: 10 },
    { header: '判断', key: 'verdict', width: 14 },
    { header: '选项分布', key: 'dist', width: 44 },
    { header: '提示', key: 'flags', width: 44 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, size: 11 };
  head.height = 22;
  head.eachCell((cell) => {
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFD7F5' } } };
  });

  for (const q of data.questions) {
    const dist = q.options
      .map((o) => `${o.label}${o.isCorrect ? '✔' : ''} ${o.count}(${pct(o.rate)})`)
      .concat(q.blankCount ? [`未答 ${q.blankCount}`] : [])
      .join('  ');
    const row = ws.addRow({
      orderNo: q.orderNo,
      type: q.type === 'multiple' ? '多选' : '单选',
      stem: stemBrief(q.stem),
      category: q.categoryName ?? '未分类',
      score: q.score,
      answered: q.answeredCount,
      blank: q.blankCount,
      correct: q.correctCount,
      p: pct(q.pValue),
      high: q.highRate == null ? '—' : pct(q.highRate),
      low: q.lowRate == null ? '—' : pct(q.lowRate),
      d: q.discrimination == null ? '—' : String(Math.round(q.discrimination * 100) / 100),
      verdict: VERDICT_LABEL[q.verdict] ?? q.verdict,
      dist,
      flags: q.flags.join('；'),
    });
    // 需要核对的题整行标黄，一眼扫得出来
    if (q.verdict === 'check-answer') {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1CC' } };
      });
    }
  }

  // ---- 第二张表：分数段 ----
  const dist = wb.addWorksheet('分数分布');
  dist.columns = [
    { header: '分数区间', key: 'label', width: 14 },
    { header: '人数', key: 'count', width: 10 },
    { header: '占比', key: 'rate', width: 10 },
  ];
  dist.getRow(1).font = { bold: true };
  for (const b of data.scoreBuckets) {
    dist.addRow({
      label: b.label,
      count: b.count,
      rate: s.participantCount ? pct(b.count / s.participantCount) : '—',
    });
  }
  dist.addRow({});
  dist.addRow({ label: '合计', count: s.participantCount, rate: '100%' });

  // ---- 第三张表：考试信息 ----
  const info = wb.addWorksheet('考试信息');
  info.columns = [
    { header: '项目', key: 'k', width: 20 },
    { header: '值', key: 'v', width: 46 },
  ];
  info.getRow(1).font = { bold: true };
  info.addRow({ k: '试卷', v: data.paper.title });
  if (data.className) info.addRow({ k: '本次分析班级', v: data.className });
  info.addRow({ k: '题量', v: data.paper.questionCount });
  info.addRow({ k: '每题分值', v: data.paper.perQuestionScore });
  info.addRow({ k: '总分', v: data.paper.totalScore });
  info.addRow({ k: '及格线', v: data.paper.passScore });
  if (data.paper.startAt) info.addRow({ k: '开考时间', v: fmt(data.paper.startAt) });
  if (data.paper.endAt) info.addRow({ k: '结束时间', v: fmt(data.paper.endAt) });
  info.addRow({});
  info.addRow({ k: '应考人数', v: data.className ? s.rosterCount : s.rosterTotalCount });
  if (data.className) info.addRow({ k: '全场应考人数', v: s.rosterTotalCount });
  info.addRow({ k: '实考人数', v: s.participantCount });
  info.addRow({ k: '缺考人数', v: s.absentCount });
  info.addRow({ k: '参考率', v: pct(s.participationRate) });
  info.addRow({ k: '平均分', v: `${s.avgScore}（${s.avgScorePercent}%）` });
  info.addRow({ k: '最高 / 最低', v: `${s.maxScore} / ${s.minScore}` });
  info.addRow({ k: '中位数', v: s.medianScore });
  info.addRow({ k: '标准差', v: s.stdDev });
  info.addRow({ k: '及格人数', v: s.passCount });
  info.addRow({ k: '及格率', v: pct(s.passRate) });
  info.addRow({ k: '平均用时', v: `${Math.round(s.avgDurationSec / 60)} 分 ${s.avgDurationSec % 60} 秒` });
  info.addRow({
    k: '交卷情况',
    v: Object.entries(s.reasonCounts)
      .filter(([, c]) => c > 0)
      .map(([k, c]) => `${REASON_LABEL[k] ?? k} ${c} 人`)
      .join('；'),
  });
  info.addRow({ k: '切屏违规', v: s.violationTotal ? `${s.violationTotal} 次，涉及 ${s.violationStudents} 人` : '无' });
  info.addRow({
    k: '分析口径',
    v: '只统计已交卷 / 已超时的答卷，每人取最近一次；P 值分母为实考人数（未作答按答错计）',
  });
  info.addRow({
    k: 'D 值说明',
    v: data.split.reliable
      ? `D = 高分组正确率 − 低分组正确率，高低分组各取总分前/后 ${Math.round(data.split.ratio * 100)}%（各 ${data.split.highCount} 人）；一般 0.3 以上算好，0.2 以下偏弱，负数说明可能答案设错`
      : `实考人数不足，D 值无法可靠计算，表中以「—」表示`,
  });

  if (data.warnings.length) {
    info.addRow({});
    info.addRow({ k: '需要注意', v: '' });
    data.warnings.forEach((w, i) => info.addRow({ k: `提示 ${i + 1}`, v: w }));
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
