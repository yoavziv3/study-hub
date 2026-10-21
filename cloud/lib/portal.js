// The student's BGU portal schedule (room changes, cancellations, notices – before the public course catalog has
// them). The portal's firewall only answers from Israel, so the Mac that builds the site does the reading
// (server/lib/portal-relay.js); the cloud keeps each student's link and what was read.
//
// The sign-in (username, password, ID number) is sealed in the student's browser with the Mac's public key
// (RSA-OAEP, PORTAL_PUBLIC_KEY): the cloud stores it but can't open it, and neither can anyone holding the admin
// secret. The Mac opens it only to sign in to the portal when its session ended; a failed sign-in stops the link
// until the student reconnects (retrying could lock their account).
import { HttpError, json, israel } from './util.js';
import { siteCourses, allowedCourseIds } from './account.js';
import { groupsFromPortal } from '../../shared/groups.js';
import { ping } from '../../shared/portal-api.js';

const MIN = 60000;
const STALE = 30 * MIN; // re-read every half hour,
const STALE_SOON = 10 * MIN; // and every 10 minutes when a lesson of theirs starts within 25 minutes
const RELAY_SEEN = 'portal_relay';

const row = (env, userId) => env.DB.prepare('SELECT * FROM portal_links WHERE user_id = ?').bind(userId).first();
export const parseJson = (s, fallback) => {
  try { return JSON.parse(s || ''); } catch { return fallback; }
};
const minutesOf = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

async function relaySeenAt(env) {
  const r = await env.DB.prepare('SELECT value FROM push_meta WHERE key = ?').bind(RELAY_SEEN).first();
  return r?.value || null;
}

async function view(env, account) {
  const relay = await relaySeenAt(env);
  const base = { key: env.PORTAL_PUBLIC_KEY || null, relayOnline: !!relay && Date.now() - relay < 10 * MIN };
  if (!account) return { ...base, connected: false };
  return {
    ...base,
    connected: true,
    ok: !!account.ok,
    pending: !!account.ok && !account.synced_at,
    error: account.error || null,
    syncedAt: account.synced_at ? new Date(account.synced_at).toISOString() : null,
    username: account.username,
    lessons: parseJson(account.data, []),
    groups: parseJson(account.groups, {}),
  };
}

export async function portalStatus(env, user) {
  return json(await view(env, await row(env, user.id)));
}

/** Connect (or reconnect): stores the sealed sign-in; the Mac picks it up within a minute and reports back. */
export async function connectPortal(env, user, body) {
  if (!env.PORTAL_PUBLIC_KEY) throw new HttpError(503, 'החיבור לפורטל עוד לא הוגדר באתר');
  const username = String(body?.username || '').trim().slice(0, 100);
  const sealed = String(body?.sealed || '');
  if (!username || !/^[A-Za-z0-9+/=]{300,700}$/.test(sealed)) throw new HttpError(400, 'פרטי ההתחברות לא תקינים');
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO portal_links (user_id, username, sealed, ok, error, data, groups, synced_at, requested_at, created_at) VALUES (?, ?, ?, 1, NULL, NULL, NULL, NULL, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, sealed = excluded.sealed, ok = 1, error = NULL, synced_at = NULL, requested_at = excluded.requested_at`
  ).bind(user.id, username, sealed, now, now).run();
  return portalStatus(env, user);
}

/** "Refresh now": the Mac reads it on its next round (within a minute). */
export async function refreshPortal(env, user) {
  await env.DB.prepare('UPDATE portal_links SET requested_at = ? WHERE user_id = ? AND ok = 1').bind(Date.now(), user.id).run();
  return portalStatus(env, user);
}

export async function disconnectPortal(env, user) {
  await env.DB.prepare('DELETE FROM portal_links WHERE user_id = ?').bind(user.id).run();
  return json({ connected: false, key: env.PORTAL_PUBLIC_KEY || null });
}

// ---------- the Mac's side (admin channel) ----------
/** Links due for a read: new, asked for, half an hour old – or 10 minutes old with a lesson starting soon. */
export async function portalJobs(env) {
  const now = Date.now();
  await env.DB.prepare('INSERT INTO push_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(RELAY_SEEN, now).run();
  const il = israel(now);
  const rows = (await env.DB.prepare('SELECT user_id, sealed, data, synced_at, requested_at FROM portal_links WHERE ok = 1').all()).results;
  const due = rows.filter((r) => {
    if (!r.synced_at || (r.requested_at || 0) > r.synced_at) return true;
    const age = now - r.synced_at;
    if (age > STALE) return true;
    const soon = parseJson(r.data, []).some((l) => l.day === il.day && !l.canceled && minutesOf(l.start) - il.min > 0 && minutesOf(l.start) - il.min <= 25);
    return soon && age > STALE_SOON;
  });
  return json(due.slice(0, 10).map((r) => ({ userId: r.user_id, sealed: r.sealed })));
}

/** What the Mac read for one student: their lessons (and the groups they show), or why it couldn't. */
export async function portalResult(env, request, body) {
  const userId = Number(body?.userId);
  const account = await row(env, userId);
  if (!account) return json({ ok: false, reason: 'no such link' });
  if (!body.ok) {
    const error = String(body.error || 'הקריאה מהפורטל נכשלה').slice(0, 200);
    await env.DB.prepare(`UPDATE portal_links SET error = ?${body.badLogin ? ', ok = 0' : ''} WHERE user_id = ?`).bind(error, userId).run();
    return json({ ok: true });
  }
  const lessons = (Array.isArray(body.lessons) ? body.lessons : []).slice(0, 80);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  const courses = await siteCourses(env, request);
  const allowed = new Set(user ? allowedCourseIds(user, courses) : []);
  const groups = groupsFromPortal(courses.filter((c) => allowed.has(c.id)), lessons);
  await env.DB.prepare('UPDATE portal_links SET data = ?, groups = ?, synced_at = ?, error = NULL WHERE user_id = ?')
    .bind(JSON.stringify(lessons), JSON.stringify(groups), Date.now(), userId).run();
  return json({ ok: true, groups });
}

/** Can the cloud reach the portal from Cloudflare's network? (It can't – the portal's firewall blocks it.) */
export async function portalPing(env) {
  return json(await ping(env.PORTAL_URL));
}
