// Turn a backup (backups/cloud-….json) into SQL that restores it into the cloud database:
//   node scripts/restore-backup.js backups/cloud-2026-10-25T….json > restore.sql
//   npx wrangler d1 execute study-hub --remote --file restore.sql
// Rows are upserted (INSERT OR REPLACE), so it can run over an existing database.
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/restore-backup.js <backup.json>');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const out = [];
for (const [table, key] of [['users', 'users'], ['progress', 'progress'], ['reports', 'reports'], ['committee_members', 'committee']]) {
  for (const row of data[key] || []) {
    const cols = Object.keys(row);
    out.push(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => lit(row[c])).join(', ')});`);
  }
}
process.stdout.write(out.join('\n') + '\n');
console.error(`${data.users.length} users, ${data.progress.length} progress rows, ${data.reports.length} reports (backup from ${data.at})`);
