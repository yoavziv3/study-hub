// /data/* on the cloud site: course material is served only to signed-in students enrolled in that course.
// Lists (courses, lectures, updates) are filtered to the student's courses; per-course files are allowed or refused.
import { json, fail } from './lib/util.js';
import { currentUser, siteCourses, allowedCourseIds, visibleCourseIds, lectureCourse } from './lib/account.js';
import { cloudUpdates, mergeUpdates } from './lib/moodle-watch.js';
import { forCourses } from '../shared/weekly-load.js';
import { portalFeed } from './lib/portal.js';

const PUBLIC = new Set(['/data/status.json', '/data/build.json']);

export async function gate({ request, env }) {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  if (PUBLIC.has(path)) return env.ASSETS.fetch(request);
  try {
    const user = await currentUser(env, request);
    if (!user) return fail(401, 'צריך להתחבר');
    const courses = await siteCourses(env, request);
    // Enrolled courses, and what the student may see: the same, except for the site's owner, who sees every course.
    const enrolled = new Set(allowedCourseIds(user, courses));
    const allowed = new Set(await visibleCourseIds(env, user, courses));

    // The SPA fallback answers unknown paths with index.html – treat that as "not found".
    const asset = async () => {
      const res = await env.ASSETS.fetch(new URL(url.pathname, url.origin));
      if (!res.ok || (res.headers.get('Content-Type') || '').includes('text/html')) return null;
      return res;
    };
    const privately = (res) => {
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'private, no-cache');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(res.body, { status: res.status, headers });
    };

    // Courses the owner sees but isn't enrolled in are marked, so the site lists them apart from "my courses".
    if (path === '/data/courses.json') return json(courses.filter((c) => allowed.has(c.id)).map((c) => (enrolled.has(c.id) ? c : { ...c, other: true })));
    if (path === '/data/lectures.json') {
      const res = await asset();
      return json(res ? (await res.json()).filter((l) => allowed.has(l.courseId)) : []);
    }
    if (path === '/data/updates.json') {
      const res = await asset();
      const upd = res ? await res.json() : { items: [] };
      // Shared feed: new material and course announcements of the student's courses – the Mac's, plus what the
      // cloud spotted in Moodle that the Mac hasn't processed yet. Deadlines and reminders are personal and come
      // from /api/me/deadlines.
      // The weekly load report's item names no course, so every student gets it (the report itself is filtered below).
      const mine = (upd.items || []).filter((i) => (allowed.has(i.courseId) && (i.type === 'material' || i.type === 'announcement')) || i.type === 'report');
      const fresh = await cloudUpdates(env, [...allowed]).catch(() => []);
      // The portal's notices on the student's own lessons (portal.js) – theirs alone, read from their portal link.
      const portal = await portalFeed(env, user, courses).catch(() => []);
      return json({
        since: upd.since,
        items: [...mergeUpdates(mine, fresh), ...portal].sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
        deadlines: [],
        settings: {},
      });
    }

    if (path === '/data/weekly.json') {
      // Weekly load reports, each limited to the student's own courses (totals recomputed).
      const res = await asset();
      const reports = res ? await res.json() : [];
      return json(reports.map((r) => forCourses(r, allowed)).filter((r) => r.courses.length));
    }

    let m = path.match(/^\/data\/(courses|bundles|search|links)\/([\w-]+)\.json$/);
    let courseId = m?.[2];
    if (!m) {
      // A lecture's JSON or original file: allowed by the course the lecture belongs to.
      m = path.match(/^\/data\/(?:lectures\/([\w]+-[\w]+)\.json|orig\/([\w]+-[\w]+)\/[^/]+|pdf\/([\w]+-[\w]+)\.pdf|thumb\/([\w]+-[\w]+)\.jpg)$/);
      courseId = m ? await lectureCourse(env, request, m[1] || m[2] || m[3] || m[4]) : null;
    }
    if (!m) return fail(404, 'לא נמצא');
    if (!allowed.has(courseId)) return fail(403, 'החומר הזה פתוח רק לסטודנטים הרשומים לקורס');
    const res = await asset();
    return res ? privately(res) : fail(404, 'לא נמצא');
  } catch (e) {
    console.error('[gate]', e?.message);
    return fail(500, 'שגיאה בשרת');
  }
}
