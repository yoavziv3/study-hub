// The Mac's heartbeat for the owner's system status: sent to the cloud with every notification tick (push-tick.js)
// and when the status page is opened here. The cloud keeps the last one (cloud/lib/health.js); the checks built from
// it are shared/system-checks.js.
import { listLectures } from './store.js';
import { queueState } from './ingest.js';
import { moodleStatus } from './moodle.js';
import { publishState } from './publish.js';
import { aiStatus } from './ai.js';
import { macChecks, worst } from '../../shared/system-checks.js';

const CLOUD = (process.env.CLOUD_URL || '').replace(/\/$/, '');
const SECRET = process.env.STUDY_ADMIN_SECRET || '';

export function macHealth() {
  const m = moodleStatus();
  const q = queueState();
  const lectures = listLectures();
  return {
    owner: m.user?.id || null,
    moodle: { connected: m.connected, lastSync: m.lastSync },
    problems: m.health?.problems || [],
    queue: { running: !!q.running, pending: q.pending.length },
    processing: lectures.filter((l) => l.status === 'processing').map((l) => l.title).slice(0, 5),
    failed: lectures
      .filter((l) => l.status === 'error')
      .map((l) => ({ id: l.id, title: l.title || l.originalFile, error: String(l.error || '').slice(0, 160), at: l.updatedAt || l.createdAt }))
      .slice(0, 10),
    publish: publishState(),
    ai: aiStatus().ready,
  };
}

/** The whole status (from the cloud), or this Mac's part of it when the cloud can't be reached. */
export async function systemStatus() {
  const mac = macHealth();
  if (CLOUD && SECRET.length >= 32) {
    try {
      const res = await fetch(`${CLOUD}/api/admin/system`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      const checks = macChecks(mac, Date.now());
      return { at: Date.now(), state: 'bad', checks, error: `הענן לא עונה (${e.message}) – מוצג רק המצב של המחשב` };
    }
  }
  const checks = macChecks(mac, Date.now());
  return { at: Date.now(), state: worst(checks), checks, error: 'האתר בענן לא מוגדר כאן (CLOUD_URL, STUDY_ADMIN_SECRET)' };
}
