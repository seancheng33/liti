/**
 * 审计动作字典 —— 单一事实来源。
 *
 * 前端不自己维护一份中文标签，而是通过 `GET /api/audit/meta` 拉这个表：
 * 加一个动作只改这里，前后端一起生效，不会出现「后端记了、前端显示成英文键名」。
 *
 * severity 的意义不是恐吓，而是排序辅助：
 * - normal   日常操作，量最大
 * - sensitive 涉及权限、成绩、可见范围、导出
 * - critical 删数据、强制收卷、清日志 —— 出事之后第一眼要看的就是这些
 */

export type AuditCategory = 'auth' | 'user' | 'paper' | 'question' | 'group' | 'category' | 'setting' | 'exam' | 'audit';

export type AuditSeverity = 'normal' | 'sensitive' | 'critical';

export interface AuditActionMeta {
  key: string;
  label: string;
  category: AuditCategory;
  severity: AuditSeverity;
}

export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  auth: '登录与会话',
  user: '账号',
  paper: '试卷',
  question: '题库',
  group: '分组',
  category: '分类',
  setting: '站点设置',
  exam: '考试与成绩',
  audit: '审计',
};

const LIST: AuditActionMeta[] = [
  // --- 登录与会话 ---
  { key: 'auth.login', label: '登录', category: 'auth', severity: 'normal' },
  { key: 'auth.login-failed', label: '登录失败', category: 'auth', severity: 'sensitive' },
  { key: 'auth.logout', label: '退出登录', category: 'auth', severity: 'normal' },
  { key: 'auth.change-password', label: '修改本人密码', category: 'auth', severity: 'sensitive' },
  { key: 'auth.profile-update', label: '修改个人资料', category: 'auth', severity: 'normal' },

  // --- 账号 ---
  { key: 'user.create', label: '创建账号', category: 'user', severity: 'normal' },
  { key: 'user.update', label: '修改账号', category: 'user', severity: 'sensitive' },
  { key: 'user.reset-password', label: '重置密码', category: 'user', severity: 'sensitive' },
  { key: 'user.delete', label: '删除账号', category: 'user', severity: 'critical' },
  { key: 'user.import', label: '批量导入学生', category: 'user', severity: 'normal' },

  // --- 试卷 ---
  { key: 'paper.create', label: '创建试卷', category: 'paper', severity: 'normal' },
  { key: 'paper.publish', label: '发布试卷', category: 'paper', severity: 'normal' },
  { key: 'paper.archive', label: '归档试卷', category: 'paper', severity: 'sensitive' },
  { key: 'paper.delete', label: '删除试卷', category: 'paper', severity: 'critical' },
  { key: 'paper.audience-update', label: '调整可见范围', category: 'paper', severity: 'sensitive' },
  { key: 'paper.publish-results', label: '公布成绩/解析', category: 'paper', severity: 'sensitive' },
  { key: 'paper.close', label: '强制收卷', category: 'paper', severity: 'critical' },

  // --- 题库 ---
  { key: 'question.create', label: '新增题目', category: 'question', severity: 'normal' },
  { key: 'question.update', label: '修改题目', category: 'question', severity: 'normal' },
  { key: 'question.delete', label: '删除题目', category: 'question', severity: 'sensitive' },
  { key: 'question.batch-delete', label: '批量删除题目', category: 'question', severity: 'sensitive' },
  { key: 'question.batch-category', label: '批量改分类', category: 'question', severity: 'normal' },
  { key: 'question.import', label: '导入题目', category: 'question', severity: 'normal' },
  { key: 'question.export', label: '导出题库', category: 'question', severity: 'sensitive' },

  // --- 分组 ---
  { key: 'group.create', label: '新建分组', category: 'group', severity: 'normal' },
  { key: 'group.update', label: '修改分组', category: 'group', severity: 'normal' },
  { key: 'group.delete', label: '删除分组', category: 'group', severity: 'sensitive' },
  { key: 'group.members', label: '调整分组名单', category: 'group', severity: 'normal' },

  // --- 分类 ---
  { key: 'category.create', label: '新建分类', category: 'category', severity: 'normal' },
  { key: 'category.update', label: '修改分类', category: 'category', severity: 'normal' },
  { key: 'category.delete', label: '删除分类', category: 'category', severity: 'sensitive' },

  // --- 站点设置 ---
  { key: 'setting.update', label: '修改站点设置', category: 'setting', severity: 'sensitive' },

  // --- 考试与成绩（教务侧动作；学生答题流水不在这里，答卷表自己有时间戳） ---
  { key: 'violation.revoke', label: '撤销违规记录', category: 'exam', severity: 'sensitive' },
  { key: 'violation.restore', label: '恢复违规记录', category: 'exam', severity: 'normal' },
  { key: 'attempt.export', label: '导出成绩册', category: 'exam', severity: 'sensitive' },
  { key: 'attempt.analysis-export', label: '导出成绩分析', category: 'exam', severity: 'sensitive' },
  { key: 'attempt.auto-close', label: '系统自动收卷', category: 'exam', severity: 'normal' },

  // --- 审计本身 ---
  { key: 'audit.export', label: '导出审计日志', category: 'audit', severity: 'sensitive' },
  { key: 'audit.purge', label: '清理审计日志', category: 'audit', severity: 'critical' },
];

export const AUDIT_ACTIONS: ReadonlyMap<string, AuditActionMeta> = new Map(LIST.map((a) => [a.key, a]));

/** 按分类分组，meta 接口和前端筛选器直接用 */
export function actionsByCategory(): { category: AuditCategory; label: string; actions: AuditActionMeta[] }[] {
  const order = Object.keys(AUDIT_CATEGORY_LABEL) as AuditCategory[];
  return order.map((c) => ({
    category: c,
    label: AUDIT_CATEGORY_LABEL[c],
    actions: LIST.filter((a) => a.category === c),
  }));
}

/** 所有合法动作键，写日志时校验用 */
export const AUDIT_ACTION_KEYS: readonly string[] = LIST.map((a) => a.key);

export function actionLabel(key: string): string {
  return AUDIT_ACTIONS.get(key)?.label ?? key;
}

export function actionSeverity(key: string): AuditSeverity {
  return AUDIT_ACTIONS.get(key)?.severity ?? 'normal';
}
