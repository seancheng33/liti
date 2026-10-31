import { Migrator, type Kysely, type Migration, type MigrationProvider } from 'kysely';
import * as migration0001 from '../migrations/0001_init.js';
import * as migration0002 from '../migrations/0002_question_bank.js';
import * as migration0003 from '../migrations/0003_exam.js';
import * as migration0004 from '../migrations/0004_practice.js';
import * as migration0005 from '../migrations/0005_settings.js';

const migrations: Record<string, Migration> = {
  '0001_init': migration0001,
  '0002_question_bank': migration0002,
  '0003_exam': migration0003,
  '0004_practice': migration0004,
  '0005_settings': migration0005,
};

const provider: MigrationProvider = {
  async getMigrations(): Promise<Record<string, Migration>> {
    return migrations;
  },
};

export async function migrate(db: Kysely<any>): Promise<void> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    console.log(`迁移 ${r.migrationName}: ${r.status}`);
  }
  if (error) {
    throw error;
  }
}
