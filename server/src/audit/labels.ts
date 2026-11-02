import type { Db } from '../db/index.js';

/**
 * 取「对象名称快照」。
 *
 * 为什么不用 join 现查：审计要的是**当时**动的是哪一份卷、哪一个账号。
 * 卷子后来改名了、账号被删了，join 出来就是空或另一个名字，日志直接失去意义。
 * 所以写入的这一刻把名字抄一份存进 target_label。
 *
 * 这几个函数都只 select 一列，成本约等于一次主键查询，
 * 而且只在写操作（本来就要改库）之后调用，不会给读路径增加负担。
 */

export async function paperLabel(db: Db, id: number | null | undefined): Promise<string | null> {
  if (id == null) return null;
  const row = await db.selectFrom('paper').select('title').where('id', '=', id).executeTakeFirst();
  return row?.title ?? null;
}

export async function userLabel(db: Db, id: number | null | undefined): Promise<string | null> {
  if (id == null) return null;
  const row = await db.selectFrom('user').select(['display_name', 'username']).where('id', '=', id).executeTakeFirst();
  if (!row) return null;
  // 显示名和登录名不一致时两个都给，否则「张三」在用户列表里根本搜不到
  return row.display_name === row.username ? row.username : `${row.display_name}（${row.username}）`;
}

export async function groupLabel(db: Db, id: number | null | undefined): Promise<string | null> {
  if (id == null) return null;
  const row = await db.selectFrom('student_group').select('name').where('id', '=', id).executeTakeFirst();
  return row?.name ?? null;
}

export async function categoryLabel(db: Db, id: number | null | undefined): Promise<string | null> {
  if (id == null) return null;
  const row = await db.selectFrom('category').select('name').where('id', '=', id).executeTakeFirst();
  return row?.name ?? null;
}

/** 题干太长，只取开头一段当标签 —— 日志列表里能认出来是哪道题就够了 */
export async function questionLabel(db: Db, id: number | null | undefined, max = 60): Promise<string | null> {
  if (id == null) return null;
  const row = await db.selectFrom('question').select('stem').where('id', '=', id).executeTakeFirst();
  if (!row) return null;
  const s = row.stem.replace(/\s+/g, ' ').trim();
  if (!s) return `题目 #${id}`;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export async function attemptLabel(db: Db, attemptId: number | null | undefined): Promise<string | null> {
  if (attemptId == null) return null;
  const row = await db
    .selectFrom('attempt as a')
    .innerJoin('paper as p', 'p.id', 'a.paper_id')
    .leftJoin('user as u', 'u.id', 'a.user_id')
    .select(['p.title as paperTitle', 'u.display_name as userName', 'u.username as username'])
    .where('a.id', '=', attemptId)
    .executeTakeFirst();
  if (!row) return null;
  const who = row.userName ?? row.username ?? '未知考生';
  return `${who} · ${row.paperTitle}`;
}
