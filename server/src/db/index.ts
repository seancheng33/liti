import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { Kysely, MysqlDialect, SqliteDialect } from 'kysely';
import { createPool } from 'mysql2';
import type { Config } from '../config.js';
import type { Database as DbSchema } from './types.js';

export type Db = Kysely<DbSchema>;

export function createDb(config: Config): Db {
  if (config.DB_DRIVER === 'mysql') {
    if (!config.MYSQL_URL) {
      throw new Error('DB_DRIVER=mysql 时必须配置 MYSQL_URL');
    }
    const pool = createPool(config.MYSQL_URL);
    return new Kysely<DbSchema>({ dialect: new MysqlDialect({ pool }) });
  }

  const path = config.SQLITE_PATH;
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return new Kysely<DbSchema>({ dialect: new SqliteDialect({ database: sqlite }) });
}
