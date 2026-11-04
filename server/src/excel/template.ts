import ExcelJS from 'exceljs';

export const TEMPLATE_HEADERS = [
  '题型',
  '题干',
  '选项A',
  '选项B',
  '选项C',
  '选项D',
  '选项E',
  '选项F',
  '正确答案',
  '解析',
  '分类',
  '标签',
];

const HEADER_TIPS: Record<string, string> = {
  题型: '从下拉列表选择「单选」或「多选」',
  题干: '题目的文字描述；只放图片的题目可以留空',
  选项A: '选项文字，至少填 A、B 两项',
  选项B: '选项文字',
  选项C: '选项文字，不需要可留空',
  选项D: '选项文字，不需要可留空',
  选项E: '选项文字，不需要可留空',
  选项F: '选项文字，不需要可留空',
  正确答案: '单选填一个字母（如 B）；多选填多个（如 ACD）',
  解析: '交卷后展示给答题人，可留空',
  分类: '填写分类名；不存在时会自动创建；留空则归为未分类',
  标签: '多个标签用逗号分隔，如：数学,入门',
};

/** 题型下拉的候选值（和 mapQuestionType 支持的中文写法保持一致） */
const TYPE_OPTIONS = ['单选', '多选'];

export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '砺题 Liti';
  wb.created = new Date();

  const ws = wb.addWorksheet('题目导入模板', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = TEMPLATE_HEADERS.map((h) => ({
    header: h,
    key: h,
    width: h === '题干' || h === '解析' ? 40 : h === '正确答案' ? 12 : 20,
  }));

  // 表头：加粗 + 底色 + 逐列批注，鼠标悬停就能看到填写要求
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11 };
  headerRow.height = 22;
  headerRow.eachCell((cell, col) => {
    const name = TEMPLATE_HEADERS[col - 1];
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFD7F5' } } };
    if (HEADER_TIPS[name]) {
      cell.note = HEADER_TIPS[name];
    }
  });

  ws.addRow({
    题型: '单选',
    题干: '示例：1 + 1 等于几？',
    选项A: '1',
    选项B: '2',
    选项C: '3',
    选项D: '4',
    选项E: '',
    选项F: '',
    正确答案: 'B',
    解析: '1 + 1 = 2',
    分类: '',
    标签: '数学,入门',
  });
  ws.getRow(2).font = { color: { argb: 'FF8C8C8C' }, italic: true };

  // 「题型」列下拉：A2 起 1000 行，点击单元格右侧箭头即可选
  // 注：exceljs 运行时有 worksheet.dataValidations，但类型声明里没有，这里显式断言
  const validations = (
    ws as unknown as {
      dataValidations?: { add: (range: string, validation: Record<string, unknown>) => void };
    }
  ).dataValidations;

  validations?.add('A2:A1000', {
    type: 'list',
    allowBlank: true,
    formulae: [`"${TYPE_OPTIONS.join(',')}"`],
    showInputMessage: true,
    promptTitle: '题型',
    prompt: '点击右侧箭头选择「单选」或「多选」',
    showErrorMessage: true,
    errorStyle: 'error',
    errorTitle: '题型填写有误',
    error: '请从下拉列表中选择「单选」或「多选」',
  });

  // ---------- 第二张表：填写说明 ----------
  const help = wb.addWorksheet('填写说明');
  help.columns = [
    { key: 'col', width: 14 },
    { key: 'rule', width: 78 },
  ];
  help.getRow(1).values = ['列名', '怎么填'];
  help.getRow(1).font = { bold: true };
  for (const name of TEMPLATE_HEADERS) {
    help.addRow({ col: name, rule: HEADER_TIPS[name] ?? '' });
  }
  help.addRow({});
  help.addRow({ col: '注意', rule: '第 1 行是表头，请从第 2 行开始填写；一次最多导入 500 行。' });
  help.addRow({ col: '注意', rule: '单选必须且只能有一个正确答案；多选至少两个正确答案。' });
  help.addRow({ col: '注意', rule: '题干与已有题目重复时，会按你选择的「重复处理方式」跳过或拦截。' });
  help.addRow({ col: '注意', rule: '分类列填了不存在的名字时会自动新建该分类；同一批里相同的名字只建一个。' });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
