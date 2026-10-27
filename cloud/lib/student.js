// The student's own data the cloud computes: deadlines (Moodle's "to do" list plus the site's homework, with
// submission status) and saved progress. Used by the API, the calendar feed and the phone notifications.
import { allowedCourseIds, withMoodle, cached } from './account.js';
import { rest } from './moodle.js';

const MIN = 60000;

// ---------- the student's pending submissions (Moodle's own "to do" list: submitted work drops off) ----------
export const siteByMoodle = (courses) => Object.fromEntries(courses.flatMap((c) => (c.moodleIds || []).map((m) => [m, c.id])));

/** Moodle's submission status → submitted, or a draft (files uploaded but "submit" not pressed yet). */
function submissionOf(st) {
  const s = st?.lastattempt?.submission?.status || st?.lastattempt?.teamsubmission?.status;
  return { submitted: s === 'submitted', draft: s === 'draft' };
}

/** Homework assignments the site shows in the student's courses, due from 3 days ago to 2 months ahead. */
async function siteAssignments(env, request, allowed) {
  const res = await env.ASSETS.fetch(new URL('/data/lectures.json', request.url));
  if (!res.ok || !(res.headers.get('Content-Type') || '').includes('json')) return [];
  const from = Date.now() - 3 * 86400000;
  const to = Date.now() + 60 * 86400000;
  const seen = new Set();
  return (await res.json())
    .filter((l) => allowed.has(l.courseId) && Number(l.source?.assignment?.id) > 0)
    .map((l) => ({ ...l.source.assignment, courseId: l.courseId }))
    .filter((a) => {
      const due = Date.parse(a.dueAt);
      if (!(due > from && due < to) || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
}

/**
 * The student's deadlines: Moodle's own "to do" list plus the homework the site shows, each with the student's
 * submission status (so submitted work shows as handed in and stops counting down, and an unsent draft is flagged).
 */
export async function studentDeadlines(env, user, courses, fresh = false, request = null) {
  const siteOf = siteByMoodle(courses);
  const allowed = new Set(allowedCourseIds(user, courses));
  const known = request ? await siteAssignments(env, request, allowed).catch(() => []) : [];
  const events = await cached(env, user, 'deadlines', fresh ? MIN : 10 * MIN, async () => {
    const now = Math.floor(Date.now() / 1000);
    return withMoodle(env, user, async (token) => {
      const r = await rest(env, token, 'core_calendar_get_action_events_by_timesort', { timesortfrom: now - 3 * 86400, limitnum: 50 });
      const list = (r.events || []).map((e) => ({
        id: `ev${e.id}`,
        moodleKey: `${e.modulename}:${e.instance}`,
        module: e.modulename,
        instance: e.instance,
        moodleCourseId: e.course?.id || null,
        courseName: e.course?.fullname || '',
        title: e.activityname || e.name,
        eventName: e.name,
        dueAt: new Date(e.timesort * 1000).toISOString(),
        url: e.url || e.action?.url || '',
        action: e.action?.name || '',
        actionable: !!e.action?.actionable,
      }));
      // Moodle's calendar names a module by its course-module id (the number in …/mod/assign/view.php?id=…), which is
      // not the assignment's own id (the one mod_assign_* and the Mac use). Without the real id the submission status
      // fails and the site's own copy of the same homework shows up as a second, identical deadline.
      const cmidOf = (u) => Number(/[?&]id=(\d+)/.exec(u || '')?.[1]) || 0;
      const idByCmid = new Map(known.map((a) => [cmidOf(a.url), Number(a.id)]).filter(([c]) => c));
      const unknown = list.filter((e) => e.module === 'assign' && !idByCmid.has(cmidOf(e.url)));
      if (unknown.length) {
        const courseids = [...new Set(unknown.map((e) => e.moodleCourseId).filter(Boolean))];
        const found = courseids.length ? await rest(env, token, 'mod_assign_get_assignments', { courseids }).catch(() => null) : null;
        for (const c of found?.courses || []) for (const a of c.assignments || []) idByCmid.set(Number(a.cmid), Number(a.id));
      }
      for (const e of list) {
        const real = e.module === 'assign' ? idByCmid.get(cmidOf(e.url)) : 0;
        if (!real) continue;
        e.legacyKey = e.moodleKey; // what students' "done" marks and sent reminders were keyed by before this
        e.instance = real;
        e.moodleKey = `assign:${real}`;
      }
      // Submitted assignments drop off Moodle's list, so the site's own homework is checked one by one too.
      const ids = [...new Set([...list.filter((e) => e.module === 'assign').map((e) => Number(e.instance)), ...known.map((a) => Number(a.id))])].slice(0, 15);
      const status = Object.fromEntries(await Promise.all(ids.map((id) =>
        rest(env, token, 'mod_assign_get_submission_status', { assignid: id }).then((st) => [id, submissionOf(st)]).catch(() => [id, null]))));
      for (const e of list) if (e.module === 'assign' && status[e.instance]) Object.assign(e, status[e.instance]);
      for (const a of known) {
        if (list.some((e) => e.moodleKey === `assign:${a.id}`) || !status[a.id]) continue; // not visible to this student
        list.push({ id: `as${a.id}`, moodleKey: `assign:${a.id}`, module: 'assign', instance: a.id, moodleCourseId: null, siteCourseId: a.courseId, courseName: '', title: a.name, eventName: a.name, dueAt: a.dueAt, url: a.url || '', action: '', actionable: false, ...status[a.id] });
      }
      return list;
    });
  });
  return events.map((e) => ({ ...e, courseId: siteOf[e.moodleCourseId] || e.siteCourseId || null }));
}

export async function loadProgress(env, user) {
  const row = await env.DB.prepare('SELECT data FROM progress WHERE user_id = ?').bind(user.id).first();
  return row ? JSON.parse(row.data) : {};
}
