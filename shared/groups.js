// Which class groups a student is in, and which announcements are meant for them – shared by the site (client)
// and the cloud's phone notifications, so both show the same things.

import { otherGroupsByAnalysis } from './notices.js';
const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};
const sameTime = (a, b) => Math.abs(minutes(a) - minutes(b)) <= 15;
const num = (g) => String(Number(g));

// The portal names kinds its own way ("הרצאה", "תרגול"); the catalog writes "שעור", "תרגיל", "מעבדה".
const KIND = (t = '') => (/תרג/.test(t) ? 'תרגיל' : /מעבד/.test(t) ? 'מעבדה' : /שעור|שיעור|הרצא/.test(t) ? 'שעור' : null);
const roomNumbers = (s) => [...String(s || '').matchAll(/\d+/g)].map((m) => String(Number(m[0]))).sort().join(',');
// Words many course names share ("מבוא לפיזיקה", "מבוא לכלכלה", "מבוא למדעי המחשב") say nothing about which course it is.
const GENERIC = new Set(['מבוא', 'יסודות', 'קורס', 'להנדסה', 'לתעשיה', 'לתעשייה', 'וניהול', 'הנדסה']);
const words = (s) => String(s || '').replace(/["'׳״()\-–]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !GENERIC.has(w));
// A portal lesson of this course: their names share a telling word (or the lesson has no name to tell).
const sameCourse = (l, c) => !l.name || words(l.name).some((w) => words(`${c.name} ${c.short}`).includes(w)) || (c.code && l.name.includes(c.code.replace(/-/g, '')));

/**
 * The site course a portal lesson belongs to: by name or course code, else the one course whose catalog has a
 * meeting of the same kind on that day and time (the portal may name a course unlike the catalog). Null if unsure.
 */
export function courseOfLesson(courses, l) {
  if (!l?.name) return null;
  const named = courses.find((c) => sameCourse(l, c));
  if (named) return named;
  const timed = courses.filter((c) => (c.classes || []).some((g) => (!KIND(l.type) || KIND(l.type) === KIND(g.type))
    && (g.slots || []).some((sl) => sl.day === l.day && sameTime(sl.start, l.start))));
  return timed.length === 1 ? timed[0] : null;
}

/**
 * The student's groups read off their portal schedule: a catalog group is theirs when every one of its weekly
 * meetings is a lesson of that course in their portal schedule (same day, about the same start, same kind).
 * Several groups often meet at the same time in different rooms: the room, then BGU's numbering (tutorial 21
 * belongs to lecture 2) decides. Returns { [courseId]: { [type]: group } } for what it could tell for sure.
 */
export function groupsFromPortal(courses, lessons) {
  const out = {};
  if (!lessons?.length) return out;
  for (const c of courses) {
    const own = lessons.filter((l) => sameCourse(l, c));
    const byType = {};
    for (const g of c.classes || []) {
      if (!g.slots?.length) continue;
      const matches = g.slots.map((sl) => own.find((l) => l.day === sl.day && sameTime(l.start, sl.start) && (!KIND(l.type) || KIND(l.type) === KIND(g.type))));
      if (matches.some((m) => !m)) continue;
      const rooms = g.slots.filter((sl, i) => roomNumbers(sl.place) && roomNumbers(sl.place) === roomNumbers(matches[i].location)).length;
      (byType[g.type] ||= []).push({ g, rooms });
    }
    const picks = {};
    const unsure = {};
    for (const [type, list] of Object.entries(byType)) {
      const best = Math.max(...list.map((x) => x.rooms));
      const top = list.filter((x) => x.rooms === best);
      if (top.length === 1) picks[type] = top[0].g.group;
      else unsure[type] = top.map((x) => x.g.group);
    }
    // BGU numbers tutorials after their lecture: lecture 2 → tutorials 21, 22…
    const lecture = picks['שעור'];
    for (const [type, groups] of Object.entries(unsure)) {
      const tutorial = Object.entries(picks).find(([t]) => t !== 'שעור')?.[1];
      const narrowed = type === 'שעור'
        ? groups.filter((g) => tutorial && tutorial.length > g.length && tutorial.startsWith(g))
        : groups.filter((g) => lecture && g.length > lecture.length && g.startsWith(lecture));
      if (narrowed.length === 1) picks[type] = narrowed[0];
    }
    if (Object.keys(picks).length) out[c.id] = picks;
  }
  return out;
}

// "קבוצה 21", "קבוצת תרגול 11", "תרגול 12", "קב' 2" – the number of a group, and what kind the words say it is.
const GROUP_RE = /(קבוצ(?:ה|ת)(?:\s+(?:תרגול|לימוד|שיעור))?|תרגול|תרגיל|שיעור|קב['׳])\s*(?:מס['׳]?\s*)?(\d{1,3})(?!\d)/g;
const kindOf = (word) => (/תרגול|תרגיל/.test(word) ? 'תרגיל' : /שיעור/.test(word) ? 'שעור' : null);
// "מר מ. רפאילוב" → ["רפאילוב"]; "ד"ר א. גורן, גב' ש. כהן" → ["גורן", "כהן"]
const surnames = (lecturer = '') => String(lecturer).split(/[,;]/).map((p) => p.trim().split(/\s+/).at(-1)).filter((n) => n && n.length >= 3 && !/[.'"׳״]$/.test(n));
const mentions = (text, name) => new RegExp(`(?:^|[^\\u0590-\\u05FF\\w])[ולבהמשכ]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\u0590-\\u05FF\\w])`).test(text);

/**
 * True when a course announcement is clearly meant for other groups than the student's: it names group numbers of
 * the course and none is theirs, or it names only staff of other groups. Unclear posts count as relevant.
 * mine: the student's groups in this course, { [type]: group }.
 */
export function forOtherGroups(text, course, mine, analysis = null) {
  // Claude's reading of the notice, when there is one, knows better than the heuristics below (shared/notices.js).
  const byAnalysis = otherGroupsByAnalysis(analysis, mine);
  if (byAnalysis !== null) return byAnalysis;
  const classes = course?.classes || [];
  if (!classes.length || !mine || !Object.keys(mine).length) return false;
  const t = String(text || '');
  const named = [];
  for (const m of t.matchAll(GROUP_RE)) {
    const kind = kindOf(m[1]);
    const n = num(m[2]);
    if (classes.some((g) => num(g.group) === n && (!kind || g.type === kind))) named.push({ kind, n });
  }
  if (named.length) return !named.some(({ kind, n }) => Object.entries(mine).some(([type, g]) => [].concat(g).some((x) => num(x) === n) && (!kind || type === kind)));
  const own = new Set();
  const others = new Set();
  for (const g of classes) for (const name of surnames(g.lecturer)) ([].concat(mine[g.type] ?? []).includes(g.group) ? own : others).add(name);
  const staff = [...new Set([...own, ...others])].filter((name) => mentions(t, name));
  return staff.length > 0 && !staff.some((name) => own.has(name));
}

/**
 * The groups the degree committee follows, from its list of registration lines per course ([lecture] or
 * [lecture, tutorial] group numbers): { [courseId]: { 'שעור': [groups], 'תרגיל': [groups] } } – the same shape as a
 * student's `classGroups`, but with every group the cohort has. Types come from the course's catalog groups.
 */
export function cohortGroups(lines, courses) {
  const out = {};
  for (const c of courses || []) {
    const list = lines?.[c.id];
    if (!list?.length) continue;
    const by = {};
    for (const line of list) {
      for (const n of line) {
        const type = (c.classes || []).find((g) => g.group === n)?.type;
        if (type && !(by[type] ||= []).includes(n)) by[type].push(n);
      }
    }
    if (Object.keys(by).length) out[c.id] = by;
  }
  return out;
}

/**
 * Is a portal lesson (a notice's lesson: { name, type, day, start }) one of the cohort's? The catalog groups of its
 * course that meet then, of that kind, decide; a lesson that can't be placed counts as the cohort's (nothing is lost).
 */
export function lessonInCohort(lesson, courses, cohort) {
  const course = courseOfLesson(courses, lesson);
  const mine = course && cohort?.[course.id];
  if (!mine) return true;
  const kind = KIND(lesson.type);
  const candidates = (course.classes || []).filter((g) => (!kind || kind === g.type) && g.slots?.some((sl) => sl.day === lesson.day && sameTime(sl.start, lesson.start)));
  if (!candidates.length) return true;
  return candidates.some((g) => (mine[g.type] || []).includes(g.group));
}
