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
  '难度',
  '标签',
];

export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('题目导入模板');

  ws.columns = TEMPLATE_HEADERS.map((h) => ({ header: h, key: h, width: 24 }));
  ws.getRow(1).font = { bold: true };

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
    难度: '易',
    标签: '数学,入门',
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
