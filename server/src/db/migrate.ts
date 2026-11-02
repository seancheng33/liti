import { Migrator, type Kysely, type Migration, type MigrationProvider } from 'kysely';
import * as migration0001 from '../migrations/0001_init.js';
import * as migration0002 from '../migrations/0002_question_bank.js';
import * as migration0003 from '../migrations/0003_exam.js';
import * as migration0004 from '../migrations/0004_practice.js';
import * as migration0005 from '../migrations/0005_settings.js';
import * as migration0006 from '../migrations/0006_user_prefs.js';
import * as migration0007 from '../migrations/0007_question_media.js';
import * as migration0008 from '../migrations/0008_exam_enhance.js';
import * as migration0009 from '../migrations/0009_practice_wrong_group.js';
import * as migration0010 from '../migrations/0010_exam_window.js';
import * as migration0011 from '../migrations/0011_exam_scale.js';
import * as migration0012 from '../migrations/0012_proctor.js';
import * as migration0013 from '../migrations/0013_fix_proctor_timestamps.js';
import * as migration0014 from '../migrations/0014_audit.js';

const migrations: Record<string, Migration> = {
  '0001_init': migration0001,
  '0002_question_bank': migration0002,
  '0003_exam': migration0003,
  '0004_practice': migration0004,
  '0005_settings': migration0005,
  '0006_user_prefs': migration0006,
  '0007_question_media': migration0007,
  '0008_exam_enhance': migration0008,
  '0009_practice_wrong_group': migration0009,
  '0010_exam_window': migration0010,
  '0011_exam_scale': migration0011,
  '0012_proctor': migration0012,
  '0013_fix_proctor_timestamps': migration0013,
  '0014_audit': migration0014,
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
