// The BGU student portal's own API (portal.bgu.ac.il), as its web app uses it: sign in, read the schedule page,
// turn its "scheduleByDays" into the site's lessons. Used by the Mac (server/lib/portal-relay.js) – the portal's
// firewall only answers requests from Israel, not from Cloudflare's servers.

const base = (url) => (url || 'https://portal.bgu.ac.il').replace(/\/$/, '');
const PAGE = '/private/academy/schedule-and-courses';
const CULTURE = 'he-IL';

// ---------- the portal's own API ----------
async function post(url, path, body, token) {
  const res = await fetch(`${base(url)}${path}`, {
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

export class PortalError extends Error {
  constructor(message, { badLogin = false } = {}) {
    super(message);
    this.badLogin = badLogin;
  }
}

/** creds: { username, password, id } → the portal's bearer token. */
export async function login(url, creds) {
  const { status, data } = await post(url, '/Portal/Account/StandardLogin', {
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
export async function fetchSchedule(url, token) {
  const { status, data } = await post(url, '/Portal/Api/Home/Index', { pageUrl: PAGE, cultureCode: CULTURE }, token);
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


/** Whether the portal answers from here at all (no sign-in involved), and who blocked it if not. */
export async function ping(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base(url)}/umbraco/api/PortalGeneralSettingsApi/GetPortalAppSettings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ cultureCode: CULTURE }), signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    const headers = Object.fromEntries(['server', 'via', 'x-cache', 'x-amz-cf-pop'].map((h) => [h, res.headers.get(h)]));
    return { status: res.status, ms: Date.now() - t0, headers, body: text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300) };
  } catch (e) {
    return { status: `error: ${e.message}`, ms: Date.now() - t0 };
  }
}
