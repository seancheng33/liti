// Run inside liti container: verify a backup db (integrity + row counts)
const D = require('/app/server/node_modules/better-sqlite3');
const file = process.argv[2] || '/app/data/_verify.db';
const db = new D(file, { readonly: true });
const ic = db.pragma('integrity_check', { simple: true });
const n = (t) => db.prepare('select count(*) n from ' + t).get().n;
const counts = {};
for (const t of ['user', 'question', 'paper', 'attempt', 'password_reset', 'audit_log']) {
  try { counts[t] = n(t); } catch { counts[t] = 'missing'; }
}
console.log('integrity:', ic);
console.log('counts:', JSON.stringify(counts));
db.close();
if (ic !== 'ok') process.exit(1);
