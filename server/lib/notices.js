// Claude reads every new notice – Moodle course announcements (from the feed, updates.js) and the portal's notices on
// students' lessons (through the cloud's admin channel) – and writes what kind of notice it is, which groups it is
// for and what changed (shared/notices.js). The material of the courses goes to Gemini; this stays with Claude
// (generateJSON use: 'claude'), on a lighter model (NOTICES_MODEL) since a notice is short.
// Every reading passes checkNotice (checks.js) before it is saved. Runs after each Moodle sync and every 15 minutes;
// a notice that fails is tried again a few times. Without it the site works as before, on the plain text.
import { generateJSON, claudeStatus } from './ai.js';
import { NOTICE_SCHEMA, NOTICE_SYSTEM, noticePrompt } from './prompts.js';
import { checkNotice } from './checks.js';
import { startRun } from './runlog.js';
import { NOTICE_VERSION, noticeTime } from '../../shared/notices.js';
import { israelNow } from '../../shared/schedule-changes.js';
import { getCourse } from './store.js';
import { pendingNotices, setNoticeAnalysis } from './updates.js';

const MODEL = process.env.NOTICES_MODEL || 'claude-sonnet-5-5';
const EVERY = 15 * 60000;
const PER_RUN = 20;
const CLOUD = (process.env.CLOUD_URL || '').replace(/\/$/, '');
const SECRET = process.env.STUDY_ADMIN_SECRET || '';
const cloudOn = () => CLOUD && SECRET.length >= 32;
const isStop = (e) => /429|usage|limit|authenticate|login|OAuth|not found/i.test(String(e?.message || e));

let running = false;
let lastOk = null;
let lastError = null;
export const noticesState = () => ({ lastOk, lastError, model: MODEL, ready: claudeStatus().ready });

const plain = (html = '') => String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').trim();

/** One notice → a checked reading (or null when nothing usable came back). */
async function read({ source, course, classes, lesson, title, body, postedAt }, checks) {
  // The day it was posted (Israel), so "tomorrow" and "Wednesday" become dates (checkNotice verifies them).
  const ms = noticeTime(postedAt);
  const il = Number.isFinite(ms) ? israelNow(ms) : null;
  const posted = il ? { date: il.date, weekday: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][il.day] } : null;
  const raw = await generateJSON({
    use: 'claude',
    model: MODEL,
    system: NOTICE_SYSTEM,
    prompt: noticePrompt({ source, course, classes, lesson, title, body: plain(body).slice(0, 6000), posted }),
    schema: NOTICE_SCHEMA,
    effort: 'low',
    maxTokens: 2000,
  });
  const checked = checkNotice(raw, { body: plain(body), title, classes: source === 'portal' ? [] : classes, posted: il?.date || null });
  checks.push(...checked.checks);
  return checked.value && { ...checked.value, ...(source === 'portal' ? { groups: [] } : {}), v: NOTICE_VERSION, by: MODEL, at: new Date().toISOString() };
}

async function admin(pathname, init = {}) {
  const res = await fetch(`${CLOUD}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`cloud ${pathname}: HTTP ${res.status}`);
  return res.json();
}

export async function analyzeNotices({ trigger = 'schedule' } = {}) {
  if (running || !claudeStatus().ready) return null;
  running = true;
  const result = { announcements: 0, portal: 0, failed: 0 };
  const checks = [];
  const run = startRun('notices', { trigger, input: { model: MODEL } });
  try {
    // Moodle announcements on this Mac's feed.
    for (const it of pendingNotices().slice(0, PER_RUN)) {
      const course = getCourse(it.courseId);
      try {
        const a = await read({ source: 'moodle', course: course?.name || it.courseId, classes: course?.classes || [], title: it.title, body: it.body, postedAt: it.createdAt || it.addedAt }, checks);
        await setNoticeAnalysis(it.id, a);
        if (a) result.announcements++;
      } catch (e) {
        if (isStop(e)) throw e;
        await setNoticeAnalysis(it.id, null);
        result.failed++;
      }
    }
    // The portal's notices (kept in the cloud; deduplicated there across students).
    if (cloudOn()) {
      const pending = await admin('/api/admin/notices/pending');
      const done = [];
      try {
        for (const n of pending.slice(0, PER_RUN)) {
          try {
            const a = await read({ source: 'portal', course: n.course, lesson: n.lesson, title: n.title, body: n.content, postedAt: n.postedAt || n.date }, checks);
            done.push({ key: n.key, analysis: a || null });
            if (a) result.portal++;
          } catch (e) {
            if (isStop(e)) throw e;
            done.push({ key: n.key, analysis: null });
            result.failed++;
          }
        }
      } finally {
        if (done.length) await admin('/api/admin/notices/result', { method: 'POST', body: JSON.stringify({ items: done }) });
      }
    }
    lastOk = Date.now();
    run.ok(result, checks);
    if (result.announcements || result.portal) console.log(`[notices] read ${result.announcements} announcements, ${result.portal} portal notices`);
    return result;
  } catch (e) {
    lastError = { at: Date.now(), message: String(e.message || e).slice(0, 200) };
    run.fail(e, checks);
    console.error('[notices]', lastError.message);
    return null;
  } finally {
    running = false;
  }
}

export function startNotices() {
  if (process.env.NOTICES === '0') return;
  setTimeout(() => analyzeNotices().catch(() => {}), 3 * 60000).unref?.();
  setInterval(() => analyzeNotices().catch(() => {}), EVERY).unref?.();
}
