import type { Kysely } from 'kysely';

/**
 * 用户个人偏好（主题等），存 JSON 字符串。
 * 可空：老用户没有偏好时按默认值处理。
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('user')
    .addColumn('prefs', 'varchar(1024)')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('user').dropColumn('prefs').execute();
}
