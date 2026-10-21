// The BGU student portal (portal.bgu.ac.il): the student's own weekly schedule, where room changes, cancellations
// and notices per lesson appear before (or instead of) the public course catalog. The portal has no tokens like
// Moodle's, so – at the student's explicit request – their portal sign-in (username, password, ID number) is kept
// encrypted with TOKEN_KEY, like the Moodle token, and used only to sign in to the portal again when its session
// ends. A failed sign-in is never retried automatically (it could lock the account); the student reconnects.
import { encrypt, decrypt, HttpError, json } from './util.js';

const PORTAL = (env) => (env.PORTAL_URL || 'https://portal.bgu.ac.il').replace(/\/$/, '');
const PAGE = '/private/academy/schedule-and-courses';
const CULTURE = 'he-IL';
const FRESH_MS = 30 * 60000;

// ---------- the portal's own API ----------
async function post(env, path, body, token) {
  const res = await fetch(`${PORTAL(env)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
    if (typeof data === 'string') data = JSON.parse(data); // some portal answers are JSON inside a string
  } catch { /* not JSON */ }
  return { status: res.status, data };
}

class PortalError extends Error {
  constructor(message, { badLogin = false } = {}) {
    super(message);
    this.badLogin = badLogin;
  }
}

async function login(env, creds) {
  const { status, data } = await post(env, '/Portal/Account/StandardLogin', {
    cultureCode: CULTURE, userName: creds.username, password: creds.password, id: creds.id, isKeepConnected: true, returnUrl: PAGE,
  });
  if (data?.succeed && data.token) return data.token;
  if (status >= 500 || status === 429 || !data) throw new PortalError(`הפורטל לא זמין כרגע (${status})`);
  throw new PortalError(data.message || 'ההתחברות לפורטל נכשלה – בדקו שם משתמש, סיסמה ותעודת זהות', { badLogin: true });
}

/** The first `scheduleByDays` anywhere in the page data (the schedule block of the page). */
function findSchedule(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 12) return null;
  if (Array.isArray(v.scheduleByDays)) return v.scheduleByDays;
  for (const x of Array.isArray(v) ? v : Object.values(v)) {
    const found = findSchedule(x, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The schedule's days, or null when the page came back without one (the session ended, or the page changed). */
async function fetchSchedule(env, token) {
  const { status, data } = await post(env, '/Portal/Api/Home/Index', { pageUrl: PAGE, cultureCode: CULTURE }, token);
  if (status === 401 || status === 403) return { days: null };
  if (status >= 400 || !data) throw new PortalError(`הפורטל החזיר שגיאה (${status})`);
  // The top-level field names help diagnose a changed portal (no personal data in them).
  return { days: findSchedule(data), keys: Object.keys(data).slice(0, 12).join(',') };
}

// ---------- the schedule as the site uses it ----------
const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const LETTER_DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

/** Decimal hours (10.5) or "10:30" → "10:30". */
export function toTime(v) {
  if (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v)) return v.slice(0, 5).padStart(5, '0');
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Which weekday (0 = Sunday) a day of `scheduleByDays` is: its own fields when it has them, else its position. */
function dayOf(day, i) {
  for (const k of ['dayOfWeek', 'dayNumber', 'dayIndex', 'weekDay', 'day']) {
    const n = Number(day?.[k]);
    if (Number.isInteger(n) && n >= 0 && n <= 7) return k === 'dayOfWeek' || n === 0 ? n % 7 : n - 1;
  }
  const name = clean(day?.dayName || day?.name || day?.title || day?.label || '');
  const full = HEB_DAYS.findIndex((d) => name.includes(d));
  if (full >= 0) return full;
  const letter = name.match(/יום\s*([א-ו])['׳]?/);
  if (letter) return LETTER_DAYS.indexOf(letter[1]);
  return i;
}

function lessonsIn(v, out, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 8) return out;
  if (!Array.isArray(v) && v.timeStart != null && (v.name || v.title)) out.push(v);
  else for (const x of Array.isArray(v) ? v : Object.values(v)) lessonsIn(x, out, depth + 1);
  return out;
}

export function parseSchedule(days) {
  const lessons = [];
  (days || []).forEach((d, i) => {
    const day = dayOf(d, i);
    for (const l of lessonsIn(d, [])) {
      const start = toTime(l.timeStart);
      if (!start) continue;
      lessons.push({
        day,
        start,
        end: toTime(l.timeEnd) || start,
        name: clean(l.name || l.title),
        type: clean(l.type),
        location: clean(typeof l.location === 'object' ? l.location?.name || l.location?.title : l.location),
        canceled: !!l.canceled,
        online: !!l.online,
        notifications: (Array.isArray(l.notifications) ? l.notifications : []).map((n) => ({
          title: clean(n.title || n.subject),
          content: clean(n.content || n.text || n.body).slice(0, 600),
          date: n.date || n.createdDate || null,
        })).filter((n) => n.title || n.content),
      });
    }
  });
  return lessons.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
}

// ---------- the student's portal account ----------
const row = (env, userId) => env.DB.prepare('SELECT * FROM portal_accounts WHERE user_id = ?').bind(userId).first();

/** Signs in again if the session ended, reads the schedule, saves it. Throws PortalError. */
export async function syncPortal(env, account) {
  let token = account.token ? await decrypt(env, account.token).catch(() => null) : null;
  let page = token ? await fetchSchedule(env, token) : { days: null };
  if (!page.days) {
    if (!account.ok) throw new PortalError('צריך להתחבר שוב לפורטל', { badLogin: true });
    const creds = JSON.parse(await decrypt(env, account.creds));
    try {
      token = await login(env, creds);
    } catch (e) {
      if (e.badLogin) await env.DB.prepare('UPDATE portal_accounts SET ok = 0, error = ? WHERE user_id = ?').bind(e.message.slice(0, 200), account.user_id).run();
      throw e;
    }
    page = await fetchSchedule(env, token);
    if (!page.days) throw new PortalError(`הפורטל לא החזיר את מערכת השעות (${page.keys || 'אין נתונים'})`);
  }
  const lessons = parseSchedule(page.days);
  const now = Date.now();
  await env.DB.prepare('UPDATE portal_accounts SET token = ?, data = ?, synced_at = ?, ok = 1, error = NULL WHERE user_id = ?')
    .bind(await encrypt(env, token), JSON.stringify(lessons), now, account.user_id).run();
  return lessons;
}

export const portalFresh = (account, maxAge = FRESH_MS) => account?.ok && Date.now() - (account.synced_at || 0) < maxAge;
export const portalLessons = (account) => {
  try { return JSON.parse(account?.data || '[]'); } catch { return []; }
};

function view(account) {
  if (!account) return { connected: false };
  return {
    connected: true,
    ok: !!account.ok,
    error: account.error || null,
    syncedAt: account.synced_at ? new Date(account.synced_at).toISOString() : null,
    username: account.username,
    lessons: portalLessons(account),
  };
}

/** The student's portal status and schedule – re-read first when it's older than half an hour. */
export async function portalStatus(env, user) {
  let account = await row(env, user.id);
  if (account?.ok && !portalFresh(account)) {
    await syncPortal(env, account).catch(() => {});
    account = await row(env, user.id);
  }
  return json(view(account));
}

/** Connect (or reconnect): checks the sign-in with the portal first, then stores it encrypted and reads the schedule. */
export async function connectPortal(env, user, body) {
  const creds = {
    username: String(body?.username || user.username || '').trim(),
    password: String(body?.password || ''),
    id: String(body?.id || '').replace(/\D/g, ''),
  };
  if (!creds.username || !creds.password || creds.username.length > 100 || creds.password.length > 200) throw new HttpError(400, 'צריך שם משתמש וסיסמה');
  if (!/^\d{5,9}$/.test(creds.id)) throw new HttpError(400, 'מספר תעודת הזהות לא תקין');
  let token;
  try {
    token = await login(env, creds);
  } catch (e) {
    // Not 401: the site reads a 401 as "your session on this site ended" and shows its own sign-in.
    if (e instanceof PortalError) throw new HttpError(e.badLogin ? 400 : 502, e.message, { badLogin: e.badLogin });
    throw e;
  }
  await env.DB.prepare(
    `INSERT INTO portal_accounts (user_id, username, creds, token, ok, created_at) VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, creds = excluded.creds, token = excluded.token, ok = 1, error = NULL`
  ).bind(user.id, creds.username, await encrypt(env, JSON.stringify(creds)), await encrypt(env, token), Date.now()).run();
  try {
    await syncPortal(env, await row(env, user.id));
  } catch (e) {
    if (!(e instanceof PortalError)) throw e;
    await env.DB.prepare('UPDATE portal_accounts SET error = ? WHERE user_id = ?').bind(e.message.slice(0, 200), user.id).run();
  }
  return portalStatus(env, user);
}

export async function refreshPortal(env, user) {
  const account = await row(env, user.id);
  if (!account) throw new HttpError(404, 'הפורטל לא מחובר');
  if (Date.now() - (account.synced_at || 0) < 60000) return portalStatus(env, user);
  try {
    await syncPortal(env, account);
  } catch (e) {
    if (!(e instanceof PortalError)) throw e;
    await env.DB.prepare('UPDATE portal_accounts SET error = ? WHERE user_id = ?').bind(e.message.slice(0, 200), user.id).run();
  }
  return portalStatus(env, user);
}

export async function disconnectPortal(env, user) {
  await env.DB.prepare('DELETE FROM portal_accounts WHERE user_id = ?').bind(user.id).run();
  return json({ connected: false });
}

/** Admin check from Cloudflare's network: can the cloud reach the portal at all (no sign-in involved)? */
export async function portalPing(env) {
  const t0 = Date.now();
  const { status } = await post(env, '/umbraco/api/PortalGeneralSettingsApi/GetPortalAppSettings', { cultureCode: CULTURE }).catch((e) => ({ status: `error: ${e.message}` }));
  return json({ status, ms: Date.now() - t0 });
}

export { PortalError };
