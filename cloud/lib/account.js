// Students, sessions and course access.
import { ensureSchema } from './db.js';
import { encrypt, decrypt, randomId, sha256, getCookie, HttpError, json } from './util.js';
import { rest, enrolledCourses, isCurrentAcademic, MoodleError } from './moodle.js';

const DAY = 86400000;
const SESSION_DAYS = 30;
const COOKIE = 'sh_session';
const ENROLL_REFRESH = 6 * 3600000;

// ---------- site courses (from the static build) ----------
export async function siteCourses(env, request) {
  const res = await env.ASSETS.fetch(new URL('/data/courses.json', request.url));
  if (!res.ok || !(res.headers.get('Content-Type') || '').includes('json')) return [];
  return res.json();
}

/** The course a lecture belongs to, from the published lecture index (ids keep their first course's prefix
 *  even if a lecture is moved, so the prefix can't be trusted for access checks). */
export async function lectureCourse(env, request, lectureId) {
  if (!/^[\w]+-[\w]+$/.test(lectureId)) return null;
  const res = await env.ASSETS.fetch(new URL('/data/lectures.json', request.url));
  if (!res.ok || !(res.headers.get('Content-Type') || '').includes('json')) return null;
  return (await res.json()).find((l) => l.id === lectureId)?.courseId || null;
}

const enrolled = (user) => {
  try {
    return JSON.parse(user.courses || '[]');
  } catch {
    return [];
  }
};

/**
 * Site courses the student may open: those linked to a Moodle course they are enrolled in. A course that is another
 * group of a carried one (sameAs) stands for that course: every group sees the same material, written once.
 */
export function allowedCourseIds(user, courses) {
  const ids = new Set(enrolled(user).map((c) => c.id));
  const known = new Set(courses.map((c) => c.id));
  const mine = courses.filter((c) => (c.moodleIds || []).some((m) => ids.has(m))).map((c) => (known.has(c.sameAs) ? c.sameAs : c.id));
  return [...new Set(mine)];
}

/**
 * Courses whose updates and material the student sees: their own (allowedCourseIds) – and, for the site's owner
 * (the Moodle user the Mac is signed in as, health.js), every course, also ones they aren't enrolled in.
 */
export async function visibleCourseIds(env, user, courses) {
  const owner = await env.DB.prepare("SELECT value FROM push_meta WHERE key = 'owner'").first();
  return owner && owner.value === user.moodle_userid ? courses.filter((c) => !c.sameAs).map((c) => c.id) : allowedCourseIds(user, courses);
}

export function meView(user, courses) {
  const allowed = allowedCourseIds(user, courses);
  const linked = new Set(courses.flatMap((c) => c.moodleIds || []));
  return {
    user: { name: user.fullname, username: user.username },
    courses: allowed,
    // This year's courses the student is enrolled in that the site has not built yet (e.g. linear algebra).
    pending: enrolled(user).filter((c) => isCurrentAcademic(c) && !linked.has(c.id)).map((c) => ({ moodleId: c.id, name: c.fullname })),
    reminderDays: String(user.reminder_days || '3,1').split(',').map(Number).filter(Boolean),
    calendarPath: `/api/cal/${user.cal_key}.ics`,
    moodleOk: !!user.token_ok,
  };
}

// ---------- sessions ----------
export async function currentUser(env, request) {
  await ensureSchema(env.DB);
  const sid = getCookie(request, COOKIE);
  if (!sid || !/^[0-9a-f]{64}$/.test(sid)) return null;
  const row = await env.DB.prepare('SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?')
    .bind(await sha256(sid))
    .first();
  if (!row || row.session_expires < Date.now()) return null;
  return row;
}

export async function requireUser(env, request) {
  const user = await currentUser(env, request);
  if (!user) throw new HttpError(401, 'צריך להתחבר');
  return user;
}

const sessionCookie = (sid, maxAge) => `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/** A Moodle token was obtained (password login or pasted key): create/refresh the student and open a session. */
export async function establish(env, request, token) {
  await ensureSchema(env.DB);
  let info;
  try {
    info = await rest(env, token, 'core_webservice_get_site_info');
  } catch (e) {
    if (e instanceof MoodleError && /token/i.test(e.code || '')) throw new HttpError(401, 'המפתח של המודל לא תקין');
    throw e;
  }
  const courses = await enrolledCourses(env, token, info.userid);
  const now = Date.now();
  const sealed = await encrypt(env, token);
  const existing = await env.DB.prepare('SELECT id FROM users WHERE moodle_userid = ?').bind(info.userid).first();
  let userId;
  if (existing) {
    userId = existing.id;
    await env.DB.prepare('UPDATE users SET username = ?, fullname = ?, token = ?, token_ok = 1, courses = ?, courses_at = ?, last_login = ? WHERE id = ?')
      .bind(info.username, info.fullname, sealed, JSON.stringify(courses), now, now, userId)
      .run();
  } else {
    const r = await env.DB.prepare('INSERT INTO users (moodle_userid, username, fullname, token, token_ok, courses, courses_at, cal_key, created_at, last_login) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)')
      .bind(info.userid, info.username, info.fullname, sealed, JSON.stringify(courses), now, randomId(18), now, now)
      .run();
    userId = r.meta.last_row_id;
  }
  const sid = randomId(32);
  await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(sid), userId, now, now + SESSION_DAYS * DAY)
    .run();
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  return json(meView(user, await siteCourses(env, request)), 200, { 'Set-Cookie': sessionCookie(sid, SESSION_DAYS * 86400) });
}

export async function logout(env, request) {
  const sid = getCookie(request, COOKIE);
  if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(sid)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

/** "Disconnect and delete everything": the encrypted tokens (Moodle, portal), progress, cache, phone notifications and all sessions. */
export async function deleteAccount(env, user) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM progress WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM cache WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM push_subs WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM push_sent WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM portal_links WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM portal_state WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM user_file_chunks WHERE file_id IN (SELECT id FROM user_files WHERE user_id = ?)').bind(user.id),
    env.DB.prepare('DELETE FROM user_files WHERE user_id = ?').bind(user.id),
    env.DB.prepare('UPDATE reports SET user_id = NULL WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

// ---------- login throttling (failed attempts per IP and per username, 15 minutes) ----------
const WINDOW = 15 * 60000;
async function attemptKeys(request, username) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return [
    [`ip:${await sha256(ip)}`, 10],
    [`user:${await sha256(String(username).toLowerCase())}`, 5],
  ];
}
export async function throttled(env, request, username) {
  await ensureSchema(env.DB);
  const since = Date.now() - WINDOW;
  for (const [key, max] of await attemptKeys(request, username)) {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?').bind(key, since).first();
    if (r.n >= max) return true;
  }
  return false;
}
export async function recordFailure(env, request, username) {
  const now = Date.now();
  const stmts = (await attemptKeys(request, username)).map(([key]) => env.DB.prepare('INSERT INTO attempts (key, at) VALUES (?, ?)').bind(key, now));
  if (Math.random() < 0.1) stmts.push(env.DB.prepare('DELETE FROM attempts WHERE at < ?').bind(now - WINDOW));
  await env.DB.batch(stmts);
}

// ---------- the student's Moodle token ----------
/** Decrypted token, or a 403 asking the student to sign in to Moodle again. */
export async function moodleToken(env, user) {
  if (!user.token || !user.token_ok) throw new HttpError(403, 'החיבור למודל פג – צריך להתחבר מחדש', { relogin: true });
  return decrypt(env, user.token);
}

/** Run a Moodle call with the student's token; an expired token is remembered so the site can ask to reconnect. */
export async function withMoodle(env, user, fn) {
  const token = await moodleToken(env, user);
  try {
    return await fn(token);
  } catch (e) {
    if (e instanceof MoodleError && /invalidtoken/i.test(e.code || '')) {
      await env.DB.prepare('UPDATE users SET token_ok = 0 WHERE id = ?').bind(user.id).run();
      throw new HttpError(403, 'החיבור למודל פג – צריך להתחבר מחדש', { relogin: true });
    }
    throw e;
  }
}

/** Enrollments are re-read from Moodle every few hours, so new courses show up without signing in again. */
export async function refreshEnrollments(env, user) {
  if (!user.token_ok || Date.now() - (user.courses_at || 0) < ENROLL_REFRESH) return user;
  try {
    const courses = await withMoodle(env, user, (token) => enrolledCourses(env, token, user.moodle_userid));
    const now = Date.now();
    await env.DB.prepare('UPDATE users SET courses = ?, courses_at = ? WHERE id = ?').bind(JSON.stringify(courses), now, user.id).run();
    return { ...user, courses: JSON.stringify(courses), courses_at: now };
  } catch (e) {
    if (e instanceof HttpError) return { ...user, token_ok: 0 };
    return user; // Moodle down: keep the last known enrollments
  }
}

/** Per-student cache of Moodle answers (deadlines, grades) so the site doesn't hit Moodle on every page view. */
export async function cached(env, user, key, ttlMs, fn) {
  const row = await env.DB.prepare('SELECT data, at FROM cache WHERE user_id = ? AND key = ?').bind(user.id, key).first();
  if (row && Date.now() - row.at < ttlMs) return JSON.parse(row.data);
  const data = await fn();
  await env.DB.prepare('INSERT INTO cache (user_id, key, data, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET data = excluded.data, at = excluded.at')
    .bind(user.id, key, JSON.stringify(data), Date.now())
    .run();
  return data;
}

/** Run `fn` with the token of some student enrolled in the course; expired tokens are skipped (and flagged). */
export async function asCourseMember(env, moodleCourseId, fn) {
  const rows = (await env.DB.prepare('SELECT * FROM users WHERE token_ok = 1 ORDER BY last_login DESC').all()).results;
  const members = rows.filter((u) => JSON.parse(u.courses || '[]').some((c) => c.id === moodleCourseId));
  if (!members.length) throw new HttpError(404, 'אין סטודנט מחובר בקורס הזה');
  let lastError = null;
  for (const user of members.slice(0, 3)) {
    try {
      return await fn(await moodleToken(env, user));
    } catch (e) {
      if (e instanceof MoodleError && /invalidtoken/i.test(e.code || '')) {
        await env.DB.prepare('UPDATE users SET token_ok = 0 WHERE id = ?').bind(user.id).run();
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError || new HttpError(404, 'אין סטודנט מחובר בקורס הזה');
}
