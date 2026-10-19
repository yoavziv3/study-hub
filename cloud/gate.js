// /data/* on the cloud site: course material is served only to signed-in students enrolled in that course.
// Lists (courses, lectures, updates) are filtered to the student's courses; per-course files are allowed or refused.
import { json, fail } from './lib/util.js';
import { currentUser, siteCourses, allowedCourseIds } from './lib/account.js';

const PUBLIC = new Set(['/data/status.json', '/data/build.json']);

export async function gate({ request, env }) {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  if (PUBLIC.has(path)) return env.ASSETS.fetch(request);
  try {
    const user = await currentUser(env, request);
    if (!user) return fail(401, 'צריך להתחבר');
    const courses = await siteCourses(env, request);
    const allowed = new Set(allowedCourseIds(user, courses));

    // The SPA fallback answers unknown paths with index.html – treat that as "not found".
    const asset = async () => {
      const res = await env.ASSETS.fetch(new URL(url.pathname, url.origin));
      if (!res.ok || (res.headers.get('Content-Type') || '').includes('text/html')) return null;
      return res;
    };
    const privately = (res) => {
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'private, no-cache');
      return new Response(res.body, { status: res.status, headers });
    };

    if (path === '/data/courses.json') return json(courses.filter((c) => allowed.has(c.id)));
    if (path === '/data/lectures.json') {
      const res = await asset();
      return json(res ? (await res.json()).filter((l) => allowed.has(l.courseId)) : []);
    }
    if (path === '/data/updates.json') {
      const res = await asset();
      const upd = res ? await res.json() : { items: [] };
      // Shared feed: new material and course announcements of the student's courses.
      // Deadlines and reminders are personal and come from /api/me/deadlines.
      return json({
        since: upd.since,
        items: (upd.items || []).filter((i) => allowed.has(i.courseId) && (i.type === 'material' || i.type === 'announcement')),
        deadlines: [],
        settings: {},
      });
    }

    let m = path.match(/^\/data\/(courses|bundles|search)\/([\w-]+)\.json$/);
    let courseId = m?.[2];
    if (!m) {
      // Lecture ids start with their course id: acc-9tdsp6zl, m68600-ab12cd.
      m = path.match(/^\/data\/(lectures\/([\w]+)-[\w]+\.json|orig\/([\w]+)-[\w]+\/[^/]+)$/);
      courseId = m?.[2] || m?.[3];
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
