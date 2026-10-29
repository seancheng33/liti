import { Migrator, type Kysely, type Migration, type MigrationProvider } from 'kysely';
import * as migration0001 from '../migrations/0001_init.js';

const migrations: Record<string, Migration> = {
  '0001_init': migration0001,
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
