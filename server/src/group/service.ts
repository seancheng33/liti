import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../http-error.js';

type AnyDb = Kysely<Database> | Transaction<Database>;

/**
 * 学生分组：教师/管理员按分组建制发卷。
 *
 * 关键取舍：**试卷存的是「分组」而不是「展开后的学生名单」**。
 * 这样分组加人/减人之后，已发布试卷的可见范围自动跟着变 —— 开学初建好的组，
 * 中途转来一个学生塞进组里，上周发的卷子他立刻就能看到，不用重新发布一遍。
 */

export interface GroupItem {
  id: number;
  name: string;
  remark: string | null;
  memberCount: number;
  createdAt: number;
}

export async function listGroups(db: Db): Promise<GroupItem[]> {
  const rows = await db.selectFrom('student_group').selectAll().orderBy('id', 'asc').execute();
  const counts = await db
    .selectFrom('student_group_member')
    .select(['group_id', (eb) => eb.fn.countAll().as('c')])
    .groupBy('group_id')
    .execute();
  const map = new Map(counts.map((r) => [r.group_id, Number(r.c)]));
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    remark: g.remark,
    memberCount: map.get(g.id) ?? 0,
    createdAt: g.created_at,
  }));
}

async function nameTaken(db: AnyDb, name: string, excludeId?: number): Promise<boolean> {
  let q = db.selectFrom('student_group').select('id').where('name', '=', name);
  if (excludeId != null) q = q.where('id', '!=', excludeId);
  const hit = await q.executeTakeFirst();
  return !!hit;
}

export async function createGroup(
  db: Db,
  input: { name: string; remark?: string | null; memberIds?: number[] },
  userId: number,
): Promise<{ id: number }> {
  const name = input.name.trim();
  if (!name) throw new HttpError(400, '分组名称不能为空');
  if (await nameTaken(db, name)) throw new HttpError(409, `分组「${name}」已存在`);

  const now = Date.now();
  return db.transaction().execute(async (trx) => {
    const res = await trx
      .insertInto('student_group')
      .values({
        name,
        remark: input.remark?.trim() || null,
        created_by: userId,
        created_at: now,
        updated_at: now,
      })
      .executeTakeFirstOrThrow();
    const groupId = Number(res.insertId);
    if (input.memberIds?.length) await writeMembers(trx, groupId, input.memberIds, now);
    return { id: groupId };
  });
}

export async function updateGroup(
  db: Db,
  id: number,
  input: { name?: string; remark?: string | null },
): Promise<void> {
  const existing = await db.selectFrom('student_group').select('id').where('id', '=', id).executeTakeFirst();
  if (!existing) throw new HttpError(404, '分组不存在');

  const patch: { name?: string; remark?: string | null; updated_at: number } = { updated_at: Date.now() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new HttpError(400, '分组名称不能为空');
    if (await nameTaken(db, name, id)) throw new HttpError(409, `分组「${name}」已存在`);
    patch.name = name;
  }
  if (input.remark !== undefined) patch.remark = input.remark?.trim() || null;

  await db.updateTable('student_group').set(patch).where('id', '=', id).execute();
}

export async function deleteGroup(db: Db, id: number): Promise<void> {
  const existing = await db.selectFrom('student_group').select('id').where('id', '=', id).executeTakeFirst();
  if (!existing) throw new HttpError(404, '分组不存在');
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('student_group_member').where('group_id', '=', id).execute();
    // 从所有试卷的可见范围里摘掉（不然那些卷子会一直指向一个不存在的组）
    await trx.deleteFrom('paper_audience_group').where('group_id', '=', id).execute();
    await trx.deleteFrom('student_group').where('id', '=', id).execute();
  });
}

/** 覆盖式写成员（先清后插）；只接受真实存在且状态正常的学生账号 */
async function writeMembers(db: AnyDb, groupId: number, userIds: number[], now = Date.now()): Promise<void> {
  const unique = [...new Set(userIds)];
  await db.deleteFrom('student_group_member').where('group_id', '=', groupId).execute();
  if (!unique.length) return;

  const valid = await db
    .selectFrom('user')
    .select('id')
    .where('id', 'in', unique)
    .where('role', '=', 'student')
    .execute();
  const validIds = new Set(valid.map((u) => u.id));
  const bad = unique.filter((uid) => !validIds.has(uid));
  if (bad.length) throw new HttpError(400, `以下账号不是学生或不存在：${bad.join(',')}`);

  await db
    .insertInto('student_group_member')
    .values(unique.map((uid) => ({ group_id: groupId, user_id: uid, created_at: now })))
    .execute();
}

export async function getGroupMembers(db: Db, id: number): Promise<{ groupId: number; userIds: number[] }> {
  const existing = await db.selectFrom('student_group').select('id').where('id', '=', id).executeTakeFirst();
  if (!existing) throw new HttpError(404, '分组不存在');
  const rows = await db.selectFrom('student_group_member').select('user_id').where('group_id', '=', id).execute();
  return { groupId: id, userIds: rows.map((r) => r.user_id) };
}

export async function setGroupMembers(db: Db, id: number, userIds: number[]): Promise<{ userIds: number[] }> {
  const existing = await db.selectFrom('student_group').select('id').where('id', '=', id).executeTakeFirst();
  if (!existing) throw new HttpError(404, '分组不存在');
  const unique = [...new Set(userIds)];
  await db.transaction().execute(async (trx) => {
    await writeMembers(trx, id, unique);
    await trx.updateTable('student_group').set({ updated_at: Date.now() }).where('id', '=', id).execute();
  });
  return { userIds: unique };
}

/** 删除用户时把他从所有分组里摘掉 */
export async function purgeUserFromGroups(db: AnyDb, userId: number): Promise<void> {
  await db.deleteFrom('student_group_member').where('user_id', '=', userId).execute();
}

/** 每个学生属于哪些组（用户管理页显示用） */
export async function groupNamesByUser(db: Db): Promise<Map<number, string[]>> {
  const rows = await db
    .selectFrom('student_group_member as m')
    .innerJoin('student_group as g', 'g.id', 'm.group_id')
    .select(['m.user_id as user_id', 'g.name as name'])
    .execute();
  const map = new Map<number, string[]>();
  for (const r of rows) {
    const list = map.get(r.user_id) ?? [];
    list.push(r.name);
    map.set(r.user_id, list);
  }
  return map;
}
