// /api/* for the cloud site: Moodle sign-in, the student's own data, a calendar feed, and the admin channel
// the Mac uses to pull course files of students' courses (tokens never leave Cloudflare).
import { json, fail, readJson, HttpError, safeEqual } from './lib/util.js';
import { ensureSchema } from './lib/db.js';
import { rest, tokenFor, moodleSite, isCurrentAcademic, MoodleError } from './lib/moodle.js';
import {
  requireUser, establish, logout, deleteAccount, throttled, recordFailure, meView, siteCourses, refreshEnrollments,
  withMoodle, cached, allowedCourseIds, moodleToken,
} from './lib/account.js';
import { calendarFeed } from './lib/ics.js';

const MIN = 60000;

export async function handleApi(ctx) {
  try {
    return await route(ctx);
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message, e.extra);
    if (e instanceof MoodleError) return fail(502, e.code === 'unavailable' ? e.message : `המודל החזיר שגיאה: ${e.message}`);
    // Never log request bodies (they may contain a password) – only the error itself.
    console.error('[api]', e?.message);
    return fail(500, 'שגיאה בשרת');
  }
}

async function route({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  await ensureSchema(env.DB);

  // ---------- sign in / out ----------
  if (path === '/api/auth/login' && method === 'POST') {
    const { username = '', password = '' } = await readJson(request, 4000);
    const u = String(username).trim();
    if (!u || !password || u.length > 100 || String(password).length > 200) throw new HttpError(400, 'צריך שם משתמש וסיסמה');
    if (await throttled(env, request, u)) throw new HttpError(429, 'יותר מדי ניסיונות התחברות. נסו שוב בעוד רבע שעה.');
    let token;
    try {
      token = await tokenFor(env, u, String(password));
    } catch (e) {
      if (e instanceof MoodleError && e.code !== 'unavailable') {
        await recordFailure(env, request, u);
        throw new HttpError(401, e.message);
      }
      throw e;
    }
    return establish(env, request, token);
  }
  if (path === '/api/auth/token' && method === 'POST') {
    const { token = '' } = await readJson(request, 4000);
    const t = String(token).trim();
    if (!/^[0-9a-f]{32}$/i.test(t)) throw new HttpError(400, 'המפתח צריך להיות 32 תווים (ספרות ואותיות a–f)');
    if (await throttled(env, request, `token:${t.slice(0, 6)}`)) throw new HttpError(429, 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.');
    try {
      return await establish(env, request, t);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) await recordFailure(env, request, `token:${t.slice(0, 6)}`);
      throw e;
    }
  }
  if (path === '/api/auth/logout' && method === 'POST') return logout(env, request);

  // ---------- calendar feed (calendar apps can't send cookies: the URL itself is the secret) ----------
  const cal = path.match(/^\/api\/cal\/([0-9a-f]{36})\.ics$/);
  if (cal && method === 'GET') {
    const user = await env.DB.prepare('SELECT * FROM users WHERE cal_key = ?').bind(cal[1]).first();
    if (!user) return new Response('Not found', { status: 404 });
    const courses = await siteCourses(env, request);
    const [deadlines, progress] = await Promise.all([studentDeadlines(env, user, courses).catch(() => []), loadProgress(env, user)]);
    return new Response(calendarFeed({ user, deadlines, progress, courses }), {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900' },
    });
  }

  // ---------- admin channel (the Mac that builds course material) ----------
  if (path.startsWith('/api/admin/')) return admin({ request, env, url, path, method });

  // ---------- everything below needs a signed-in student ----------
  let user = await requireUser(env, request);

  if (path === '/api/me' && method === 'GET') {
    user = await refreshEnrollments(env, user);
    return json(meView(user, await siteCourses(env, request)));
  }
  if (path === '/api/me' && method === 'DELETE') return deleteAccount(env, user);

  if (path === '/api/me/settings' && method === 'PUT') {
    const { reminderDays } = await readJson(request, 2000);
    const days = [...new Set((reminderDays || []).map(Number).filter((d) => Number.isInteger(d) && d > 0 && d <= 14))].sort((a, b) => b - a);
    await env.DB.prepare('UPDATE users SET reminder_days = ? WHERE id = ?').bind(days.join(','), user.id).run();
    return json({ ok: true, reminderDays: days });
  }

  if (path === '/api/progress') {
    if (method === 'GET') return json(await loadProgress(env, user));
    if (method === 'PUT') {
      const body = await readJson(request, 400_000);
      await env.DB.prepare('INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
        .bind(user.id, JSON.stringify(body), Date.now())
        .run();
      return json({ ok: true });
    }
  }

  if (path === '/api/me/deadlines' && method === 'GET') {
    const courses = await siteCourses(env, request);
    return json(await studentDeadlines(env, user, courses, url.searchParams.has('fresh')));
  }

  if (path === '/api/me/grades' && method === 'GET') {
    const courses = await siteCourses(env, request);
    const siteOf = siteByMoodle(courses);
    const data = await cached(env, user, 'grades', 30 * MIN, () =>
      withMoodle(env, user, (token) => rest(env, token, 'gradereport_overview_get_course_grades', {})));
    return json((data.grades || []).filter((g) => siteOf[g.courseid]).map((g) => ({ courseId: siteOf[g.courseid], moodleId: g.courseid, grade: g.grade })));
  }
  const grade = path.match(/^\/api\/me\/grades\/([\w-]+)$/);
  if (grade && method === 'GET') {
    const courses = await siteCourses(env, request);
    const course = courses.find((c) => c.id === grade[1]);
    if (!course || !allowedCourseIds(user, courses).includes(course.id)) throw new HttpError(403, 'אין גישה לקורס הזה');
    const mine = new Set(JSON.parse(user.courses || '[]').map((c) => c.id));
    const moodleId = (course.moodleIds || []).find((m) => mine.has(m));
    const data = await cached(env, user, `grades:${moodleId}`, 30 * MIN, () =>
      withMoodle(env, user, (token) => rest(env, token, 'gradereport_user_get_grade_items', { courseid: moodleId, userid: user.moodle_userid })));
    const items = (data.usergrades?.[0]?.gradeitems || [])
      .filter((g) => g.itemtype === 'mod' || g.itemtype === 'course')
      .map((g) => ({
        name: g.itemtype === 'course' ? 'ציון הקורס' : g.itemname,
        total: g.itemtype === 'course',
        grade: g.gradeformatted && g.gradeformatted !== '-' ? g.gradeformatted : null,
        percentage: g.percentageformatted && g.percentageformatted !== '-' ? g.percentageformatted : null,
        range: g.rangeformatted || '',
        feedback: g.feedback ? String(g.feedback).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) : '',
        url: g.itemmodule && g.cmid ? `${moodleSite(env)}/mod/${g.itemmodule}/view.php?id=${g.cmid}` : null,
      }));
    return json({ courseId: course.id, items });
  }

  return fail(404, 'לא נמצא');
}

// ---------- the student's pending submissions (Moodle's own "to do" list: submitted work drops off) ----------
const siteByMoodle = (courses) => Object.fromEntries(courses.flatMap((c) => (c.moodleIds || []).map((m) => [m, c.id])));

async function studentDeadlines(env, user, courses, fresh = false) {
  const siteOf = siteByMoodle(courses);
  const events = await cached(env, user, 'deadlines', fresh ? 0 : 10 * MIN, async () => {
    const now = Math.floor(Date.now() / 1000);
    const r = await withMoodle(env, user, (token) =>
      rest(env, token, 'core_calendar_get_action_events_by_timesort', { timesortfrom: now - 3 * 86400, limitnum: 50 }));
    return (r.events || []).map((e) => ({
      id: `ev${e.id}`,
      moodleKey: `${e.modulename}:${e.instance}`,
      module: e.modulename,
      moodleCourseId: e.course?.id || null,
      courseName: e.course?.fullname || '',
      title: e.activityname || e.name,
      eventName: e.name,
      dueAt: new Date(e.timesort * 1000).toISOString(),
      url: e.url || e.action?.url || '',
      action: e.action?.name || '',
      actionable: !!e.action?.actionable,
    }));
  });
  return events.map((e) => ({ ...e, courseId: siteOf[e.moodleCourseId] || null }));
}

async function loadProgress(env, user) {
  const row = await env.DB.prepare('SELECT data FROM progress WHERE user_id = ?').bind(user.id).first();
  return row ? JSON.parse(row.data) : {};
}

// ---------- admin ----------
// Moodle calls the Mac may make through a student's token, always limited to that one course.
const ADMIN_FUNCTIONS = {
  core_course_get_contents: (p, c) => Number(p.courseid) === c,
  mod_assign_get_assignments: (p, c) => Array.isArray(p.courseids) && p.courseids.length === 1 && Number(p.courseids[0]) === c,
  mod_forum_get_forums_by_courses: (p, c) => Array.isArray(p.courseids) && p.courseids.length === 1 && Number(p.courseids[0]) === c,
  mod_quiz_get_quizzes_by_courses: (p, c) => Array.isArray(p.courseids) && p.courseids.length === 1 && Number(p.courseids[0]) === c,
  mod_forum_get_forum_discussions: (p) => Number(p.forumid) > 0,
};

async function admin({ request, env, url, path, method }) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.ADMIN_SECRET || env.ADMIN_SECRET.length < 32 || !safeEqual(auth, `Bearer ${env.ADMIN_SECRET}`)) return fail(404, 'לא נמצא');

  if (path === '/api/admin/courses' && method === 'GET') {
    // This year's Moodle courses of all signed-in students, with how many students each has.
    const rows = (await env.DB.prepare('SELECT courses FROM users WHERE token_ok = 1').all()).results;
    const byId = new Map();
    for (const r of rows) {
      for (const c of JSON.parse(r.courses || '[]')) {
        if (!isCurrentAcademic(c)) continue;
        const e = byId.get(c.id) || { moodleId: c.id, shortname: c.shortname, fullname: c.fullname, students: 0 };
        e.students++;
        byId.set(c.id, e);
      }
    }
    return json([...byId.values()].sort((a, b) => b.students - a.students));
  }

  if (path === '/api/admin/moodle' && method === 'POST') {
    const { course, wsfunction, params = {} } = await readJson(request, 20_000);
    const check = ADMIN_FUNCTIONS[wsfunction];
    if (!check || !check(params, Number(course))) throw new HttpError(400, 'פעולה לא מורשית');
    return json(await asCourseMember(env, Number(course), (token) => rest(env, token, wsfunction, params)));
  }

  if (path === '/api/admin/file' && method === 'GET') {
    const course = Number(url.searchParams.get('course'));
    const fileurl = url.searchParams.get('url') || '';
    if (!fileurl.startsWith(`${moodleSite(env)}/webservice/pluginfile.php/`)) throw new HttpError(400, 'כתובת קובץ לא תקינה');
    return asCourseMember(env, course, async (token) => {
      const res = await fetch(`${fileurl}${fileurl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`);
      if (!res.ok) throw new MoodleError(`הורדה נכשלה (${res.status})`, 'download');
      const headers = new Headers({ 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'no-store' });
      if (res.headers.get('Content-Length')) headers.set('Content-Length', res.headers.get('Content-Length'));
      return new Response(res.body, { headers });
    });
  }

  return fail(404, 'לא נמצא');
}

/** Run `fn` with the token of some student enrolled in the course; expired tokens are skipped (and flagged). */
async function asCourseMember(env, moodleCourseId, fn) {
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
