// The Mac's heartbeat for the owner's system status: sent to the cloud with every notification tick (push-tick.js)
// and when the status page is opened here. The cloud keeps the last one (cloud/lib/health.js); the checks built from
// it are shared/system-checks.js.
import { execFileSync } from 'node:child_process';
import { ROOT, listLectures } from './store.js';
import { queueState, retryFailedAI } from './ingest.js';
import { moodleStatus } from './moodle.js';
import { publishState } from './publish.js';
import { aiStatus, probeAI, probeClaude, lessonRoute } from './ai.js';
import { geminiUsage } from './gemini.js';
import { adminAlert } from './updates.js';
import { growAllBanks, bankState } from './practice.js';
import { noticesState } from './notices.js';
import { macChecks, worst } from '../../shared/system-checks.js';

const CLOUD = (process.env.CLOUD_URL || '').replace(/\/$/, '');
const SECRET = process.env.STUDY_ADMIN_SECRET || '';

// ---------- is Claude answering? (checked every half hour) ----------
// An expired sign-in or a used-up limit makes every new file come in without a summary. This finds out before the
// next file does, alerts the owner (here and, through the heartbeat, on the phone), and once Claude answers again
// re-queues what failed meanwhile (retryFailedAI, a few tries per item).
const AI_EVERY = 30 * 60000;
let aiWatch = { ok: null, kind: null, reason: null, checkedAt: null, since: null };

export async function checkAI() {
  const r = await probeAI();
  // Lessons on Claude (AI_LESSONS=claude) with Gemini behind it: Claude is checked too, and its trouble is only a warning.
  const claude = lessonRoute()[0] === 'claude' && process.env.AI_PROVIDER === 'gemini' ? await probeClaude() : null;
  const changed = r.ok !== aiWatch.ok;
  const gemini = aiStatus().provider === 'gemini' || process.env.AI_PROVIDER === 'gemini';
  aiWatch = { ok: r.ok, kind: r.kind || null, reason: r.reason || null, provider: gemini ? 'gemini' : 'claude', usage: gemini ? geminiUsage() : null, claude: claude && { ok: claude.ok, kind: claude.kind || null, reason: claude.reason || null }, checkedAt: Date.now(), since: changed ? Date.now() : aiWatch.since };
  if (claude && !claude.ok) console.error('[ai] Claude (lessons) not answering – Gemini writes them meanwhile:', claude.reason);
  if (!r.ok && claude?.ok) {
    // Gemini is out (usually its daily quota) but Claude can still write the lessons that failed meanwhile.
    const n = await retryFailedAI({ auto: true }).catch(() => 0);
    if (n) console.log(`[ai] re-queued ${n} items on Claude`);
  }
  if (!r.ok) {
    console.error('[ai] not answering:', r.reason);
    const name = gemini ? 'Gemini' : 'Claude';
    // A used-up Gemini day only slows the question banks while Claude writes the lessons: no alert for that.
    if (!(claude?.ok && r.kind === 'limit')) adminAlert(r.kind === 'signed-out' ? (gemini ? 'המפתח של Gemini חסר או נדחה – בדקו את GEMINI_API_KEY ב-.env' : 'ה-Claude במחשב מנותק – צריך להתחבר מחדש (claude, ואז /login)') : r.kind === 'limit' ? `הגעת למגבלת השימוש ב-${name} – הסיכומים יחכו עד שהיא תתאפס` : `ה-${name} לא עונה: ${r.reason}`);
    return aiWatch;
  }
  if (changed && aiWatch.since) console.log('[ai] answering again');
  const n = await retryFailedAI({ auto: true }).catch(() => 0);
  if (n) console.log(`[ai] re-queued ${n} items that came in without AI material`);
  // Question banks that aren't full yet carry on (practice.js; a no-op while its worker is busy).
  if (!n && !bankState().working) growAllBanks();
  return aiWatch;
}

export function startAIWatch() {
  if (process.env.AI_WATCH === '0') return;
  setTimeout(() => checkAI().catch(() => {}), 2 * 60000).unref?.();
  setInterval(() => checkAI().catch(() => {}), AI_EVERY).unref?.();
}

/** The commit this Mac last pushed or pulled (origin/main) and its time – the cloud compares it with its build. */
function originHead() {
  try {
    const [head, at] = execFileSync('git', ['log', '-1', '--format=%H %ct', 'origin/main'], { cwd: ROOT, timeout: 5000 }).toString().trim().split(' ');
    return { head, headAt: Number(at) * 1000 };
  } catch {
    return null;
  }
}

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
    aiWatch,
    notices: noticesState(),
    git: originHead(),
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
