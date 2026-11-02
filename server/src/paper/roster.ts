import type { Db } from '../db/index.js';

export interface RosterUser {
  id: number;
  username: string;
  display_name: string;
  student_no: string | null;
  class_name: string | null;
}

/**
 * 一场考试的「应考名单」。成绩册和逐题分析共用这一套口径。
 *
 * - `audience_mode='all'` → 全体学生
 * - `selected` → 点名（`paper_audience`）∪ 分组（`paper_audience_group` 展开的成员），两者取并集
 *
 * 分组是引用不是快照，所以组里加人立刻算进名单 —— 成绩册与分析的「应考人数」
 * 因此会随分组变化，这是设计目标（导出那一刻算一次，导出后不追溯）。
 */
export async function loadPaperRoster(db: Db, paperId: number, audienceMode: 'all' | 'selected'): Promise<RosterUser[]> {
  if (audienceMode === 'all') {
    return db
      .selectFrom('user')
      .select(['id', 'username', 'display_name', 'student_no', 'class_name'])
      .where('role', '=', 'student')
      .execute();
  }

  const direct = await db
    .selectFrom('paper_audience as pa')
    .innerJoin('user as u', 'u.id', 'pa.user_id')
    .select([
      'u.id as id',
      'u.username as username',
      'u.display_name as display_name',
      'u.student_no as student_no',
      'u.class_name as class_name',
    ])
    .where('pa.paper_id', '=', paperId)
    .execute();

  const viaGroup = await db
    .selectFrom('paper_audience_group as pag')
    .innerJoin('student_group_member as m', 'm.group_id', 'pag.group_id')
    .innerJoin('user as u', 'u.id', 'm.user_id')
    .select([
      'u.id as id',
      'u.username as username',
      'u.display_name as display_name',
      'u.student_no as student_no',
      'u.class_name as class_name',
    ])
    .where('pag.paper_id', '=', paperId)
    .execute();

  const merged = new Map<number, RosterUser>();
  for (const u of [...direct, ...viaGroup]) merged.set(u.id, u);
  return [...merged.values()];
}

/** 排序跟着教务的习惯走：先班级，再学号，没学号的按用户名垫底 */
export function sortRoster(roster: RosterUser[]): RosterUser[] {
  return roster.sort((a, b) => {
    const ca = a.class_name ?? '\uffff';
    const cb = b.class_name ?? '\uffff';
    if (ca !== cb) return ca.localeCompare(cb, 'zh-CN');
    const na = a.student_no ?? '\uffff';
    const nb = b.student_no ?? '\uffff';
    if (na !== nb) return na.localeCompare(nb, 'zh-CN');
    return a.username.localeCompare(b.username);
  });
}
