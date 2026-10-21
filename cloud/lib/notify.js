// Phone notifications for students of the cloud site (Web Push): a deadline coming up, an exam or quiz tomorrow,
// flashcards waiting for review, a class starting in a quarter of an hour, and a room / time change in the
// student's own group. Pages Functions have no timer, so the Mac that builds the site calls the admin "tick"
// every few minutes; each tick works out what is due and sends what hasn't been sent yet (push_sent).
import { HttpError, json } from './util.js';
import { siteCourses, allowedCourseIds } from './account.js';
import { siteByMoodle, studentDeadlines } from './student.js';
import { examSittings } from './ics.js';
import { sendPush, pushConfigured, PUSH_HOST } from './webpush.js';

const DAY = 86400000;
const MAX_SUBS = 5;
const MAX_SENDS = 30; // push requests per tick (Cloudflare limits outgoing requests per invocation)
const DEADLINES_FRESH = 3 * 3600000; // deadline reminders only from a recent Moodle answer (submitted work drops off)

export const KINDS = ['deadlines', 'exams', 'cards', 'classes', 'rooms'];
const prefsOf = (progress) => ({ ...Object.fromEntries(KINDS.map((k) => [k, true])), ...(progress.notify || {}) });

// ---------- subscriptions ----------
export async function saveSubscription(env, user, request, body) {
  const sub = body?.subscription || {};
  const endpoint = String(sub.endpoint || '');
  const p256dh = String(sub.keys?.p256dh || '');
  const auth = String(sub.keys?.auth || '');
  if (!PUSH_HOST.test(endpoint) || endpoint.length > 1000 || !/^[\w-]{80,100}$/.test(p256dh) || !/^[\w-]{16,30}$/.test(auth)) {
    throw new HttpError(400, 'המנוי להתראות לא תקין');
  }
  const ua = (request.headers.get('User-Agent') || '').slice(0, 200);
  await env.DB.prepare(
    `INSERT INTO push_subs (endpoint, user_id, p256dh, auth, ua, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua`
  ).bind(endpoint, user.id, p256dh, auth, ua, Date.now()).run();
  // A few devices per student; the oldest goes first.
  await env.DB.prepare(`DELETE FROM push_subs WHERE user_id = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at DESC LIMIT ${MAX_SUBS})`)
    .bind(user.id, user.id).run();
  return json({ ok: true });
}

export async function removeSubscription(env, user, body) {
  await env.DB.prepare('DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?').bind(user.id, String(body?.endpoint || '')).run();
  return json({ ok: true });
}

async function deliver(env, subs, data, opts) {
  let ok = 0;
  const gone = [];
  for (const s of subs) {
    const status = await sendPush(env, s, data, opts).catch(() => 0);
    if (status >= 200 && status < 300) ok++;
    else if (status === 404 || status === 410) gone.push(s.endpoint);
  }
  if (gone.length) await env.DB.batch(gone.map((e) => env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(e)));
  return ok;
}

export async function sendTest(env, user) {
  if (!pushConfigured(env)) throw new HttpError(503, 'התראות לטלפון עוד לא הוגדרו בשרת');
  const subs = (await env.DB.prepare('SELECT * FROM push_subs WHERE user_id = ?').bind(user.id).all()).results;
  if (!subs.length) throw new HttpError(400, 'אין מכשיר רשום להתראות');
  const ok = await deliver(env, subs, { title: 'מחברת · התראת בדיקה', body: 'מעולה – ההתראות מגיעות לטלפון 🎉', url: '/updates', tag: 'test' });
  if (!ok) throw new HttpError(502, 'שליחת ההתראה נכשלה – נסו לכבות ולהדליק את ההתראות מחדש');
  return json({ ok: true, devices: ok });
}

// ---------- Israel time ----------
const IL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function israel(ms) {
  const p = Object.fromEntries(IL.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, day: WEEKDAY[p.weekday], hour: Number(p.hour), min: Number(p.hour) * 60 + Number(p.minute) };
}
const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};
const timeIL = (iso) => new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', hour: '2-digit', minute: '2-digit' });
function whenText(ms) {
  if (ms < DAY) {
    const h = Math.max(1, Math.round(ms / 3600000));
    return h === 1 ? 'בעוד שעה' : h === 2 ? 'בעוד שעתיים' : `בעוד ${h} שעות`;
  }
  const d = Math.round(ms / DAY);
  return d === 1 ? 'בעוד יום' : d === 2 ? 'בעוד יומיים' : `בעוד ${d} ימים`;
}

// ---------- what each student should hear about now ----------
export function dueNotifications({ user, progress, courses, deadlines, updates, now }) {
  const prefs = prefsOf(progress);
  const il = israel(now);
  const daytime = il.hour >= 8 && il.hour < 22;
  const out = [];
  const short = Object.fromEntries(courses.map((c) => [c.id, c.short]));

  // 1. Submissions coming up – at the closest reminder threshold already crossed (the student's 3 / 1 days…).
  if (prefs.deadlines && daytime && deadlines) {
    const days = String(user.reminder_days || '3,1').split(',').map(Number).filter(Boolean);
    const done = progress.deadlinesDone || {};
    const list = [
      ...deadlines.filter((d) => !d.submitted && !done[d.moodleKey]).map((d) => ({ key: d.moodleKey, title: d.title, dueAt: d.dueAt, courseId: d.courseId, draft: d.draft })),
      ...(progress.manualDeadlines || []).filter((d) => !d.done).map((d) => ({ key: `manual:${d.id}`, title: d.title, dueAt: d.dueAt, courseId: d.courseId })),
    ];
    for (const d of list) {
      const due = Date.parse(d.dueAt);
      if (!(due > now)) continue;
      const crossed = days.filter((x) => due - x * DAY <= now);
      if (!crossed.length) continue;
      const x = Math.min(...crossed);
      out.push({
        key: `dl:${d.key}:${x}`,
        title: `⏰ הגשה ${whenText(due - now)}: ${d.title}`,
        body: [short[d.courseId], `עד ${timeIL(d.dueAt)}`, d.draft ? 'יש טיוטה שעוד לא נשלחה!' : ''].filter(Boolean).join(' · '),
        url: '/updates',
      });
    }
  }

  // 2. An exam or quiz tomorrow – in the evening before.
  if (prefs.exams && il.hour >= 17 && il.hour < 22) {
    const tomorrow = israel(now + DAY).date;
    for (const c of courses) {
      for (const ev of examSittings(c, progress)) {
        if (ev.date !== tomorrow) continue;
        out.push({
          key: `exam:${c.id}:${ev.key}:${ev.date}`,
          title: `מחר ${ev.quiz ? 'בוחן' : 'מבחן'} ב${c.short}`,
          body: [ev.label, ev.time, ev.place?.join(', '), 'בהצלחה!'].filter(Boolean).join(' · '),
          url: `/course/${c.id}/prep`,
        });
      }
    }
  }

  // 3. Flashcards waiting – once a day, in the evening.
  if (prefs.cards && il.hour >= 18 && il.hour < 22) {
    const n = Object.values(progress.cards || {}).filter((c) => c?.due && c.due <= now).length;
    if (n > 0) {
      out.push({
        key: `cards:${il.date}`,
        title: n === 1 ? 'כרטיסייה אחת מחכה לחזרה' : `${n} כרטיסיות מחכות לחזרה`,
        body: 'כמה דקות של חזרה עכשיו – והחומר נשאר בזיכרון לטווח ארוך.',
        url: '/review',
      });
    }
  }

  // 4. A class of the student's groups starting within the next quarter of an hour (until the course's exams).
  if (prefs.classes) {
    for (const c of courses) {
      const pick = progress.classGroups?.[c.id] || {};
      const firstExam = examSittings(c, progress).filter((e) => !e.quiz).map((e) => e.date).sort()[0];
      if (firstExam && il.date >= firstExam) continue;
      for (const g of c.classes || []) {
        if (pick[g.type] !== g.group) continue;
        for (const sl of g.slots || []) {
          const startIn = minutes(sl.start) - il.min;
          if (sl.day !== il.day || startIn <= 0 || startIn > 16) continue;
          const label = g.type === 'שעור' ? 'שיעור' : g.type;
          out.push({
            key: `class:${c.id}:${g.group}:${sl.day}:${sl.start}:${il.date}`,
            title: `בעוד ${startIn} דקות: ${c.short} · ${label}`,
            body: [sl.place || sl.mode, `${sl.start}–${sl.end}`].filter(Boolean).join(' · '),
            url: '/schedule',
            urgency: 'high',
            ttl: 15 * 60,
          });
        }
      }
    }
  }

  // 5. The room or time of the student's own group changed in the course catalog.
  if (prefs.rooms && daytime) {
    for (const it of updates) {
      if (it.type !== 'class-change' || now - Date.parse(it.addedAt) > 2 * DAY) continue;
      if (!courses.some((c) => c.id === it.courseId)) continue;
      if (progress.classGroups?.[it.courseId]?.[it.classType] !== it.group) continue;
      out.push({ key: `room:${it.id}`, title: it.title, body: it.body, url: '/schedule' });
    }
  }
  return out;
}

const BACKUP_AFTER = 8 * 60000; // the Mac steps in only when the cron Worker hasn't ticked for this long

/**
 * Called every 5 minutes through the admin channel: by the cron Worker (workers/push-cron) and, as a backup, by
 * the Mac. The Mac's ticks ({ backup: true }) are skipped while the Worker is running, so the two never race.
 */
export async function notifyTick(env, request, { source = 'unknown', backup = false } = {}) {
  if (!pushConfigured(env)) return json({ ok: false, reason: 'not configured' });
  const now = Date.now();
  const db = env.DB;
  const last = await db.prepare("SELECT value FROM push_meta WHERE key = 'last_tick'").first();
  if (backup && last && now - last.value < BACKUP_AFTER) return json({ ok: true, skipped: true });
  const mark = (key) => db.prepare('INSERT INTO push_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, now);
  await db.batch([mark('last_tick'), mark(`last_tick:${String(source).slice(0, 20)}`)]);
  const subs = (await db.prepare('SELECT * FROM push_subs').all()).results;
  if (!subs.length) return json({ ok: true, users: 0, sent: 0 });
  const ids = [...new Set(subs.map((s) => s.user_id))];
  const inIds = `(${ids.map(() => '?').join(',')})`;
  const [users, progressRows, sentRows, deadlineRows] = await Promise.all([
    db.prepare(`SELECT * FROM users WHERE id IN ${inIds}`).bind(...ids).all(),
    db.prepare(`SELECT user_id, data FROM progress WHERE user_id IN ${inIds}`).bind(...ids).all(),
    db.prepare(`SELECT user_id, key FROM push_sent WHERE user_id IN ${inIds}`).bind(...ids).all(),
    db.prepare(`SELECT user_id, data, at FROM cache WHERE key = 'deadlines' AND user_id IN ${inIds}`).bind(...ids).all(),
  ]);
  const progressOf = new Map(progressRows.results.map((r) => [r.user_id, r.data]));
  const sent = new Set(sentRows.results.map((r) => `${r.user_id}|${r.key}`));
  const deadlineCache = new Map(deadlineRows.results.map((r) => [r.user_id, r]));

  const courses = await siteCourses(env, request);
  const siteOf = siteByMoodle(courses);
  let updates = [];
  const upd = await env.ASSETS.fetch(new URL('/data/updates.json', request.url));
  if (upd.ok && (upd.headers.get('Content-Type') || '').includes('json')) updates = (await upd.json()).items || [];

  // Moodle is asked for one student's deadlines per tick at most (the oldest answer first); the rest use the cache
  // that the site itself keeps fresh while they browse.
  const stale = users.results
    .filter((u) => u.token_ok && now - (deadlineCache.get(u.id)?.at || 0) > DEADLINES_FRESH)
    .sort((a, b) => (deadlineCache.get(a.id)?.at || 0) - (deadlineCache.get(b.id)?.at || 0));
  const refresh = stale[0]?.id;

  let budget = MAX_SENDS;
  let total = 0;
  const marks = [];
  for (const user of users.results) {
    if (budget <= 0) break;
    let progress = {};
    try { progress = JSON.parse(progressOf.get(user.id) || '{}'); } catch { /* keep empty */ }
    const allowed = new Set(allowedCourseIds(user, courses));
    const mine = courses.filter((c) => allowed.has(c.id));
    let deadlines = null;
    const row = deadlineCache.get(user.id);
    if (user.id === refresh) {
      deadlines = await studentDeadlines(env, user, courses, true, request).catch(() => null);
    } else if (row && now - row.at <= DEADLINES_FRESH) {
      try { deadlines = JSON.parse(row.data).map((e) => ({ ...e, courseId: siteOf[e.moodleCourseId] || e.siteCourseId || null })); } catch { /* skip */ }
    }
    const due = dueNotifications({ user, progress, courses: mine, deadlines, updates, now }).filter((n) => !sent.has(`${user.id}|${n.key}`));
    if (!due.length) continue;
    const devices = subs.filter((s) => s.user_id === user.id);
    for (const n of due) {
      if (budget < devices.length) break;
      budget -= devices.length;
      const ok = await deliver(env, devices, { title: n.title, body: n.body, url: n.url, tag: n.key }, { ttl: n.ttl, urgency: n.urgency });
      // Marked as sent even when every device refused it, so a broken device doesn't get retried forever.
      marks.push(db.prepare('INSERT OR IGNORE INTO push_sent (user_id, key, at) VALUES (?, ?, ?)').bind(user.id, n.key, now));
      total += ok;
    }
  }
  if (Math.random() < 0.05) marks.push(db.prepare('DELETE FROM push_sent WHERE at < ?').bind(now - 30 * DAY));
  if (marks.length) await db.batch(marks);
  return json({ ok: true, users: users.results.length, sent: total });
}

