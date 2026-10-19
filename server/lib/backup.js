// Weekly backup of the cloud database (student accounts, progress, reports) to this Mac.
// The cloud's admin channel returns the data; tokens inside stay encrypted with the cloud-only key.
// Files go to backups/ (not in git), the last 8 are kept. Restore: scripts/restore-backup.js.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './store.js';
import { adminAlert } from './updates.js';

const DIR = path.join(ROOT, 'backups');
const KEEP = 8;
const EVERY = 7 * 86400000;
const CLOUD = (process.env.CLOUD_URL || '').replace(/\/$/, '');
const SECRET = process.env.STUDY_ADMIN_SECRET || '';

const files = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^cloud-.*\.json$/.test(f)).sort() : []);

export function backupStatus() {
  const last = files().at(-1);
  return { enabled: !!(CLOUD && SECRET), last: last ? fs.statSync(path.join(DIR, last)).mtime.toISOString() : null, count: files().length, dir: DIR };
}

export async function backupNow() {
  if (!CLOUD || !SECRET) throw new Error('הענן לא מוגדר (CLOUD_URL / STUDY_ADMIN_SECRET)');
  const res = await fetch(`${CLOUD}/api/admin/backup`, { headers: { Authorization: `Bearer ${SECRET}` }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`הענן החזיר ${res.status}`);
  const data = await res.json();
  await fsp.mkdir(DIR, { recursive: true, mode: 0o700 });
  const file = path.join(DIR, `cloud-${data.at.replace(/[:.]/g, '-')}.json`);
  await fsp.writeFile(file, JSON.stringify(data), { mode: 0o600 });
  for (const old of files().slice(0, -KEEP)) await fsp.rm(path.join(DIR, old), { force: true });
  console.log(`[backup] saved ${path.basename(file)}: ${data.users.length} users`);
  return { file: path.basename(file), users: data.users.length, progress: data.progress.length, reports: data.reports.length };
}

/** Checked a few times a day; backs up when the last backup is a week old. */
export function startBackups() {
  if (!CLOUD || !SECRET) return;
  const check = async () => {
    const { last } = backupStatus();
    if (last && Date.now() - new Date(last).getTime() < EVERY) return;
    try {
      await backupNow();
    } catch (e) {
      console.error('[backup]', e.message);
      adminAlert(`הגיבוי השבועי של חשבונות הסטודנטים נכשל: ${e.message}`);
    }
  };
  setTimeout(check, 60000);
  setInterval(check, 6 * 3600000);
}
