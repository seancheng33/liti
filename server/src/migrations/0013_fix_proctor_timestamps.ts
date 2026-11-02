import { sql, type Kysely } from 'kysely';

/**
 * 修正 0012 里两个时间戳列的类型。
 *
 * 0012 最初把 `attempt.last_seen_at` 与 `attempt_violation.revoked_at` 写成了 `integer`。
 * 这在 SQLite 上没事（INTEGER 本来就是 64 位），但 **MySQL 的 INTEGER 是 32 位有符号**，
 * 上限 2147483647，而 `Date.now()` 是 13 位毫秒（约 1.79e12）—— 结果就是开考直接
 * `Out of range value for column 'last_seen_at'`，整个开考流程 500。
 *
 * 这个坑只有 MySQL 会踩，而且只在「已经按旧版 0012 建过列」的库上才需要修；
 * 全新库跑改好的 0012 就已经是 bigint。所以这里做成幂等：MySQL 上 MODIFY 一遍
 * （本来就是 bigint 也无害），SQLite 上直接跳过。
 *
 * 教训记在这：**项目里所有存毫秒时间戳的列必须是 bigint**，
 * 与 `started_at` / `created_at` / `expires_at` 保持一致。
 */
export async function up(db: Kysely<any>): Promise<void> {
  const tables = await db.introspection.getTables();
  const hasColumn = (table: string, column: string): boolean =>
    !!tables.find((t) => t.name === table)?.columns.some((c) => c.name === column);

  const targets: [string, string][] = [
    ['attempt', 'last_seen_at'],
    ['attempt_violation', 'revoked_at'],
  ];

  for (const [table, column] of targets) {
    if (!hasColumn(table, column)) continue;
    try {
      await sql`ALTER TABLE ${sql.table(table)} MODIFY COLUMN ${sql.ref(column)} BIGINT NULL`.execute(db);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      // SQLite 不支持 MODIFY COLUMN（报 near "MODIFY": syntax error）。
      // 它的 INTEGER 天生就是 64 位，不需要这一步，直接放过。
      if (/syntax error/i.test(msg)) continue;
      throw e;
    }
  }
}

export async function down(): Promise<void> {
  // 不做回退：把时间戳列改回 32 位只会把已经存进去的数据弄坏
}
