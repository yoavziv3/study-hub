// Phone notifications for students of the cloud site (Web Push): a deadline coming up, an exam or quiz tomorrow,
// flashcards waiting for review, a class starting in a quarter of an hour, a room / time change in the student's
// own group, and new material or announcements in their courses. Pages Functions have no timer, so a cron Worker
// (workers/push-cron, with the Mac as backup) calls the admin "tick" every 5 minutes; each tick works out what is
// due and sends what hasn't been sent yet (push_sent).
import { HttpError, json, israel } from './util.js';
import { siteCourses, allowedCourseIds } from './account.js';
import { siteByMoodle, studentDeadlines } from './student.js';
import { examSittings } from './ics.js';
import { sendPush, pushConfigured, PUSH_HOST } from './webpush.js';
import { parseJson, noticeReadings, withReadings } from './portal.js';
import { watchMoodle, cloudUpdates, mergeUpdates } from './moodle-watch.js';
import { saveHeartbeat, ownerUserId, systemStatus, publishedItems, buildInfo } from './health.js';
import { forOtherGroups } from '../../shared/groups.js';
import { noticeKey, noticeTitle, noticeUrgent, noticeTime } from '../../shared/notices.js';
import { changesFrom, changeFor } from '../../shared/schedule-changes.js';

const DAY = 86400000;
const MAX_SUBS = 5;
const MAX_SENDS = 30; // push requests per tick (Cloudflare limits outgoing requests per invocation)
const CLOUD_WAIT = 30 * 60000; // a new Moodle file spotted by the cloud waits this long for the Mac's own notice
const DEADLINES_FRESH = 3 * 3600000; // deadline reminders only from a recent Moodle answer (submitted work drops off)

export const KINDS = ['deadlines', 'exams', 'cards', 'classes', 'rooms', 'material', 'announcements', 'portal'];
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
/** The weekly meetings of the student's chosen groups, until each course's exams start. */
function mySlots(courses, progress, today) {
  const out = [];
  for (const c of courses) {
    const pick = progress.classGroups?.[c.id] || {};
    const firstExam = examSittings(c, progress).filter((e) => !e.quiz).map((e) => e.date).sort()[0];
    if (firstExam && today >= firstExam) continue;
    for (const g of c.classes || []) {
      if (pick[g.type] !== g.group) continue;
      for (const sl of g.slots || []) out.push({ c, g, sl });
    }
  }
  return out;
}

// The portal's lesson at the same weekday and (about the same) time as a catalog meeting.
const portalLesson = (portal, sl) => (portal || []).find((l) => l.day === sl.day && Math.abs(minutes(l.start) - minutes(sl.start)) <= 15);
// Rooms are written differently in the catalog and the portal: compare their numbers (building, room).
const numbers = (s) => [...String(s || '').matchAll(/\d+/g)].map((m) => String(Number(m[0]))).sort().join(',');
const roomChanged = (catalog, portal) => !!portal && numbers(portal) !== '' && numbers(catalog) !== '' && numbers(portal) !== numbers(catalog);

// Moodle posts arrive as many short lines; a notification gets one compact line.
const oneLine = (t = '') => String(t).replace(/\r/g, '').split(/\n+/).map((x) => x.trim()).filter(Boolean).join(' · ');

/**
 * Notifications due now for one student. `since`: when they first turned notifications on (older news isn't sent);
 * `isSent(key)`: what they already got.
 */
export function dueNotifications({ user, progress, courses, feedCourses = courses, deadlines, updates, now, since = 0, isSent = () => false, portal = null }) {
  const prefs = prefsOf(progress);
  const il = israel(now);
  const daytime = il.hour >= 8 && il.hour < 22;
  const out = [];
  const short = Object.fromEntries(courses.map((c) => [c.id, c.short]));

  // 0. Their Moodle connection expired: no deadlines or grades until they sign in again. Once per expiry (a new
  //    sign-in changes last_login), and again each week while it stays expired.
  if (!user.token_ok && daytime) {
    out.push({
      key: `relogin:${user.last_login || 0}:${Math.floor(now / (7 * DAY))}`,
      title: 'החיבור שלך למודל פג',
      body: 'בלי החיבור ההגשות, הציונים והתזכורות לא מתעדכנים. היכנסו לאתר ולחצו על "התחברות מחדש".',
      url: '/',
    });
  }

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
  //    With the portal connected, its room (and a cancellation) wins over the course catalog.
  //    The notices' changes (shared/schedule-changes.js, from Claude's reading of announcements and portal notices) win
  //    over both: a cancelled class, a room that moved, a new time.
  if (prefs.classes) {
    const changes = changesFrom({ items: updates, lessons: portal || [], noticeTime });
    for (const { c, g, sl } of mySlots(courses, progress, il.date)) {
      if (sl.day !== il.day) continue;
      const ch = changeFor(changes, { courseId: c.id, type: g.type, group: g.group, day: sl.day, start: sl.start, end: sl.end }, il.date, il);
      const start = ch?.start || sl.start;
      const startIn = minutes(start) - il.min;
      if (startIn <= 0 || startIn > 16) continue;
      const label = g.type === 'שעור' ? 'שיעור' : g.type;
      const p = portalLesson(portal, sl);
      const key = `class:${c.id}:${g.group}:${sl.day}:${sl.start}:${il.date}`;
      if (p?.canceled || ch?.canceled) {
        out.push({ key, title: `לא מתקיים: ${c.short} · ${label} של ${start}`, body: ch?.headline || p?.notifications?.[0]?.title || 'לפי מערכת השעות בפורטל', url: '/schedule', urgency: 'high', ttl: 15 * 60 });
        continue;
      }
      const place = ch?.room || p?.location || sl.place || sl.mode;
      const end = ch?.end || sl.end;
      out.push({
        key,
        title: `בעוד ${startIn} דקות: ${c.short} · ${label}`,
        body: [place, `${start}–${end}`, portal ? '' : 'לפי קובץ הקורסים'].filter(Boolean).join(' · '),
        url: '/schedule',
        urgency: 'high',
        ttl: 15 * 60,
      });
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
  // 7. The portal: a notice on one of the student's lessons (room change, cancellation…), or a room that differs from
  //    the course catalog's. Each once; notices older than a week (or from before notifications were on) are skipped.
  if (prefs.portal && portal && daytime) {
    for (const l of portal) {
      for (const n of l.notifications || []) {
        const at = Date.parse(n.date);
        if (Number.isFinite(at) && (now - at > 7 * DAY || at < since - DAY)) continue;
        // With Claude's reading (notices.js): what changed, in one line, as the title.
        const read = noticeTitle(n.analysis, l.name);
        out.push({
          key: `portal:${noticeKey(l.name, n)}`,
          title: read || `עדכון בפורטל · ${l.name}`,
          body: [n.title, oneLine(n.content).slice(0, 160)].filter(Boolean).join(' – '),
          url: '/schedule',
          ...(noticeUrgent(n.analysis) ? { urgency: 'high' } : {}),
        });
      }
    }
    for (const { c, g, sl } of mySlots(courses, progress, il.date)) {
      const p = portalLesson(portal, sl);
      // A lesson with its own notice already told the student (above); this covers silent room changes.
      if (!p || p.canceled || p.notifications?.length || !roomChanged(sl.place, p.location)) continue;
      const label = g.type === 'שעור' ? 'שיעור' : g.type;
      out.push({
        key: `portalroom:${c.id}:${g.group}:${sl.day}:${sl.start}:${numbers(p.location)}`,
        title: `החדר השתנה: ${c.short} · ${label}`,
        body: `${p.location} (בקובץ הקורסים: ${sl.place})`,
        url: '/schedule',
      });
    }
  }

  // 8. The weekly load report is out (Sunday morning, from the Mac's weekly.js) – once, with its headline.
  if (prefs.announcements && daytime) {
    for (const it of updates) {
      if (it.type !== 'report' || now - Date.parse(it.addedAt) > DAY || Date.parse(it.addedAt) < since || isSent(`upd:${it.id}`)) continue;
      out.push({ key: `upd:${it.id}`, title: it.title, body: it.body, url: '/weekly' });
    }
  }

  // 6. New material and course announcements in the student's courses: the Mac's published feed, plus what the
  //    cloud spotted in Moodle itself (moodle-watch.js) while the Mac hasn't processed it yet. A burst – the start
  //    of a semester, a big Moodle sync – becomes one notification per course and type.
  if ((prefs.material || prefs.announcements) && daytime) {
    // These follow the courses whose feed the student sees (the owner: all of them).
    const short = Object.fromEntries(feedCourses.map((c) => [c.id, c.short]));
    const groups = new Map();
    // An item is "sent" by its own id or by its Moodle key (the cloud and the Mac name the same post alike).
    const sentKeys = (it) => [`upd:${it.id}`, ...(it.key && it.key !== it.id ? [`upd:${it.key}`] : [])];
    for (const it of updates) {
      const wanted = (it.type === 'material' && prefs.material) || (it.type === 'announcement' && prefs.announcements);
      const at = Date.parse(it.addedAt);
      if (!wanted || now - at > 2 * DAY || at < since || sentKeys(it).some(isSent) || !short[it.courseId]) continue;
      // A file the cloud spotted waits half an hour for the Mac, whose notice comes with the summary.
      if (it.cloud && it.type === 'material' && now - at < CLOUD_WAIT) continue;
      // "No tutorial in group 22 tomorrow" isn't for a student in group 21.
      const course = feedCourses.find((c) => c.id === it.courseId);
      if (it.type === 'announcement' && forOtherGroups(`${it.title}\n${it.body}`, course, progress.classGroups?.[it.courseId], it.analysis)) continue;
      const k = `${it.type}:${it.courseId}`;
      groups.set(k, [...(groups.get(k) || []), it]);
    }
    for (const list of groups.values()) {
      const [it] = list;
      const material = it.type === 'material';
      // The Mac's notice for a file the cloud already announced: now it's ready on the site.
      const ready = (x) => material && !x.cloud && x.fileKey && isSent(`upd:moodlefile:${x.fileKey}`);
      if (list.length === 1) {
        out.push({
          key: `upd:${it.id}`,
          keys: sentKeys(it),
          title: material ? (ready(it) ? `מוכן באתר: ${it.title.replace(/^[^:]*:\s*/, '')}` : it.title) : noticeTitle(it.analysis, short[it.courseId]) || `הודעה ב${short[it.courseId]}: ${it.title}`,
          body: material
            ? it.cloud ? it.body
              : feedCourses.find((c) => c.id === it.courseId)?.ai === false ? 'החומר כבר באתר' : 'החומר כבר באתר, עם סיכום, שאלות וכרטיסיות'
            : oneLine(it.body).slice(0, 180),
          url: material ? (it.lectureId ? `/lecture/${it.lectureId}` : it.cloud ? it.url : '/updates') : '/updates',
          ...(!material && noticeUrgent(it.analysis) ? { urgency: 'high' } : {}),
        });
      } else {
        out.push({
          key: `upd:${it.id}`,
          keys: list.flatMap(sentKeys),
          title: `${list.length} ${material ? 'חומרים חדשים' : 'הודעות חדשות'} ב${short[it.courseId]}`,
          body: list.slice(0, 3).map((x) => (material ? x.title.replace(/^[^:]*:\s*/, '') : x.title)).join(' · '),
          url: material ? `/course/${it.courseId}` : '/updates',
        });
      }
    }
  }
  return out;
}

const BACKUP_AFTER = 8 * 60000; // the Mac steps in only when the cron Worker hasn't ticked for this long

/**
 * Called every 5 minutes through the admin channel: by the cron Worker (workers/push-cron) and, as a backup, by
 * the Mac. The Mac's ticks ({ backup: true }) are skipped while the Worker is running, so the two never race.
 */
export async function notifyTick(env, request, { source = 'unknown', backup = false, mac = null } = {}) {
  const now = Date.now();
  const db = env.DB;
  // The Mac's heartbeat rides on its ticks, also the skipped ones (the owner's status page shows it).
  if (mac) await saveHeartbeat(env, mac, now);
  const last = await db.prepare("SELECT value FROM push_meta WHERE key = 'last_tick'").first();
  if (backup && last && now - last.value < BACKUP_AFTER) return json({ ok: true, skipped: true });
  const mark = (key) => db.prepare('INSERT INTO push_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, now);
  await db.batch([mark('last_tick'), mark(`last_tick:${String(source).slice(0, 20)}`)]);
  const courses = await siteCourses(env, request);
  // Moodle as seen from here, a few courses per tick – new files and posts are known (and shown in the updates
  // feed) even while the Mac is off, whether or not anyone has phone notifications.
  const found = await watchMoodle(env, courses, now).catch((e) => { console.error('[moodle-watch]', e?.message); return 0; });
  if (!pushConfigured(env)) return json({ ok: false, reason: 'not configured', found });
  const subs = (await db.prepare('SELECT * FROM push_subs').all()).results;
  if (!subs.length) return json({ ok: true, users: 0, sent: 0, found });
  const ids = [...new Set(subs.map((s) => s.user_id))];
  const inIds = `(${ids.map(() => '?').join(',')})`;
  const [users, progressRows, sentRows, deadlineRows, portalRows] = await Promise.all([
    db.prepare(`SELECT * FROM users WHERE id IN ${inIds}`).bind(...ids).all(),
    db.prepare(`SELECT user_id, data FROM progress WHERE user_id IN ${inIds}`).bind(...ids).all(),
    db.prepare(`SELECT user_id, key FROM push_sent WHERE user_id IN ${inIds}`).bind(...ids).all(),
    db.prepare(`SELECT user_id, data, at FROM cache WHERE key = 'deadlines' AND user_id IN ${inIds}`).bind(...ids).all(),
    db.prepare(`SELECT user_id, ok, data, groups FROM portal_links WHERE user_id IN ${inIds}`).bind(...ids).all(),
  ]);
  const portalOf = new Map(portalRows.results.map((r) => [r.user_id, r]));
  const readings = portalRows.results.some((r) => r.ok && r.data) ? await noticeReadings(env) : new Map();
  const progressOf = new Map(progressRows.results.map((r) => [r.user_id, r.data]));
  const sent = new Set(sentRows.results.map((r) => `${r.user_id}|${r.key}`));
  const deadlineCache = new Map(deadlineRows.results.map((r) => [r.user_id, r]));

  const siteOf = siteByMoodle(courses);
  const macItems = await publishedItems(env, request);
  const updates = mergeUpdates(macItems, await cloudUpdates(env, courses.map((c) => c.id), { since: now - 2 * DAY }));

  // What needs the owner's attention (a part that stopped, a failed publish…) – to the owner's phone.
  let alerts = [];
  const owner = await ownerUserId(env);
  if (owner && subs.some((s) => s.user_id === owner)) {
    const status = await systemStatus(env, { courses, macItems, build: await buildInfo(env, request).catch(() => null), now }).catch((e) => { console.error('[health]', e?.message); return null; });
    const il = israel(now);
    if (status && il.hour >= 8 && il.hour < 23) {
      alerts = status.checks.flatMap((c) => (c.alerts || []).map((a) => ({
        key: a.once ? `health:${a.key}` : `health:${a.key}:${il.date}`,
        title: `מחברת · ${c.title}`,
        body: a.text,
        url: '/system',
      })));
    }
  }

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
    // New material and announcements: the owner hears about every course, everyone else about their own.
    const visible = new Set(user.id === owner ? courses.map((c) => c.id) : allowed);
    const feedCourses = courses.filter((c) => visible.has(c.id));
    // The portal schedule the Mac read (portal.js): its lessons, and the groups they show – which win over the ones
    // the student picked by hand, so classes, exams and group announcements follow their real registration.
    const link = portalOf.get(user.id);
    const portal = link?.ok && link.data ? withReadings(parseJson(link.data, null), readings) : null;
    const portalGroups = link?.ok ? parseJson(link.groups, {}) : {};
    if (Object.keys(portalGroups).length) {
      const merged = { ...progress.classGroups };
      for (const [cid, picks] of Object.entries(portalGroups)) merged[cid] = { ...merged[cid], ...picks };
      progress = { ...progress, classGroups: merged };
    }
    let deadlines = null;
    const row = deadlineCache.get(user.id);
    if (user.id === refresh) {
      deadlines = await studentDeadlines(env, user, courses, true, request).catch(() => null);
    } else if (row && now - row.at <= DEADLINES_FRESH) {
      try { deadlines = JSON.parse(row.data).map((e) => ({ ...e, courseId: siteOf[e.moodleCourseId] || e.siteCourseId || null })); } catch { /* skip */ }
    }
    const devices = subs.filter((s) => s.user_id === user.id);
    const isSent = (key) => sent.has(`${user.id}|${key}`);
    const since = Math.min(...devices.map((d) => d.created_at || 0));
    const due = [
      ...(user.id === owner ? alerts : []),
      ...dueNotifications({ user, progress, courses: mine, feedCourses, deadlines, updates, now, since, isSent, portal }),
    ].filter((n) => !isSent(n.key));
    if (!due.length) continue;
    for (const n of due) {
      if (budget < devices.length) break;
      budget -= devices.length;
      const ok = await deliver(env, devices, { title: n.title, body: n.body, url: n.url, tag: n.key }, { ttl: n.ttl, urgency: n.urgency });
      // Marked as sent even when every device refused it, so a broken device doesn't get retried forever.
      for (const key of n.keys || [n.key]) marks.push(db.prepare('INSERT OR IGNORE INTO push_sent (user_id, key, at) VALUES (?, ?, ?)').bind(user.id, key, now));
      total += ok;
    }
  }
  if (Math.random() < 0.05) marks.push(db.prepare('DELETE FROM push_sent WHERE at < ?').bind(now - 30 * DAY));
  if (marks.length) await db.batch(marks);
  return json({ ok: true, users: users.results.length, sent: total, found });
}

