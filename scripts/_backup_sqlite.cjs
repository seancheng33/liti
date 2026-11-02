// Run inside liti container: hot backup SQLite db (WAL-safe)
const D = require('/app/server/node_modules/better-sqlite3');
const ts = process.argv[2] || String(Date.now());
const db = new D('/app/data/app.db');
db.backup(`/app/data/backup-${ts}.db`)
  .then(() => {
    console.log('backup written: /app/data/backup-' + ts + '.db');
    db.close();
  })
  .catch((e) => {
    console.error('backup failed:', e.message);
    process.exit(1);
  });
