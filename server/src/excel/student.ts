import ExcelJS from 'exceljs';

/** 学生名单导入的列顺序 —— 导出/模板/解析三处都以它为唯一口径 */
export const STUDENT_HEADERS = ['用户名', '姓名', '学号', '班级', '初始密码', '分组'];

/** 密码留空时用它。和 seed 里的演示账号一致，老师第一次发榜前应该让学生改掉 */
export const DEFAULT_STUDENT_PASSWORD = 'student123';

const HEADER_TIPS: Record<string, string> = {
  用户名: '登录用，2–64 位，只能字母/数字/下划线/点/连字符；已存在则跳过该行',
  姓名: '显示名与成绩册上的名字；留空则用用户名',
  学号: '选填，全校唯一；建议填成 20260101 这种能排序的格式',
  班级: '选填，自由文本，如「高一(3)班」；按班导出成绩要靠它',
  初始密码: `选填，至少 6 位；留空用默认密码 ${DEFAULT_STUDENT_PASSWORD}`,
  分组: '选填，多个用逗号分隔；只匹配已存在的分组，不会自动建组',
};

function cellText(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') {
    const obj = v as { text?: unknown; richText?: { text: string }[] };
    if (obj.text != null) return String(obj.text).trim();
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join('').trim();
    return '';
  }
  return String(v).trim();
}

export async function buildStudentTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '砺题 Liti';
  wb.created = new Date();

  const ws = wb.addWorksheet('学生名单模板', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = STUDENT_HEADERS.map((h) => ({
    header: h,
    key: h,
    width: h === '班级' || h === '分组' ? 22 : 18,
  }));

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11 };
  headerRow.height = 22;
  headerRow.eachCell((cell, col) => {
    const name = STUDENT_HEADERS[col - 1];
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3FF' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFD7F5' } } };
    if (HEADER_TIPS[name]) cell.note = HEADER_TIPS[name];
  });

  ws.addRow({
    用户名: 's20260101',
    姓名: '张三',
    学号: '20260101',
    班级: '高一(3)班',
    初始密码: '',
    分组: '高一(3)班,数学A班',
  });
  ws.getRow(2).font = { color: { argb: 'FF8C8C8C' }, italic: true };

  const help = wb.addWorksheet('填写说明');
  help.columns = [
    { key: 'col', width: 14 },
    { key: 'rule', width: 78 },
  ];
  help.getRow(1).values = ['列名', '怎么填'];
  help.getRow(1).font = { bold: true };
  for (const name of STUDENT_HEADERS) help.addRow({ col: name, rule: HEADER_TIPS[name] ?? '' });
  help.addRow({});
  help.addRow({ col: '注意', rule: '第 1 行是表头，请从第 2 行开始填写；一次最多导入 1000 行。' });
  help.addRow({ col: '注意', rule: '用户名或学号已存在的行会被跳过并在结果里列出来，不会覆盖已有账号。' });
  help.addRow({ col: '注意', rule: `没填初始密码的学生统一用 ${DEFAULT_STUDENT_PASSWORD}，请提醒他们首次登录后修改。` });
  help.addRow({ col: '注意', rule: '分组要先在「学生分组」里建好，导入时按组名匹配。' });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export interface StudentRow {
  row: number;
  username: string;
  displayName: string;
  studentNo: string | null;
  className: string | null;
  password: string;
  groupNames: string[];
  errors: string[];
}

/**
 * 解析学生名单。这里只做「单行自身」的校验（格式、必填、密码长度）；
 * 「用户名/学号是否已被占用」要查库，放在路由层做，因为要区分跳过还是报错。
 */
export async function parseStudentRows(buffer: Buffer): Promise<StudentRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const out: StudentRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const username = cellText(row, 1);
    const displayName = cellText(row, 2);
    const studentNo = cellText(row, 3);
    const className = cellText(row, 4);
    const password = cellText(row, 5);
    const groupRaw = cellText(row, 6);

    // 整行都是空的就跳过，不报错（老师常在末尾留空行）
    if (!username && !displayName && !studentNo && !groupRaw) return;

    const errors: string[] = [];
    if (!username) errors.push('用户名为空');
    else if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(username)) {
      errors.push('用户名只能包含字母、数字、下划线、点和连字符，长度 2–64');
    }
    if (studentNo && !/^[a-zA-Z0-9_-]{1,32}$/.test(studentNo)) {
      errors.push('学号只能包含字母、数字、下划线和连字符，长度不超过 32');
    }
    if (className.length > 64) errors.push('班级名不能超过 64 个字');
    if (password && password.length < 6) errors.push('初始密码至少 6 位');

    out.push({
      row: rowNumber,
      username,
      displayName: displayName || username,
      studentNo: studentNo || null,
      className: className || null,
      password: password || DEFAULT_STUDENT_PASSWORD,
      groupNames: groupRaw
        ? groupRaw
            .split(/[,，;；]/)
            .map((g) => g.trim())
            .filter(Boolean)
        : [],
      errors,
    });
  });
  return out;
}
