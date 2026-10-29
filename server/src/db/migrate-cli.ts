import { loadConfig } from '../config.js';
import { createDb } from './index.js';
import { migrate } from './migrate.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config);
  await migrate(db);
  await db.destroy();
  console.log('迁移完成');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
