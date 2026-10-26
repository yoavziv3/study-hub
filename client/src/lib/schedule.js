// The weekly timetable: class times and rooms come from the university's course catalog (on each course as
// `classes`); each student picks their own lecture / tutorial group once per course.
// On top of that, the BGU portal's lessons and Claude's reading of the notices (shared/schedule-changes.js) say what is
// different on a given date: a class that is not held, a room that moved, a new time.

import { changesFrom, changeFor, israelNow, addDays, weekdayOf } from '../../../shared/schedule-changes.js';
import { courseOfLesson } from '../../../shared/groups.js';

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const TYPE_ORDER = ['שעור', 'תרגיל', 'מעבדה'];
/** The catalog writes "שעור"; on the site it reads "שיעור". */
export const typeLabel = (t) => (t === 'שעור' ? 'שיעור' : t);

export const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

/** The kinds of groups a course has (lecture, tutorial, lab…), lectures first. */
export function classTypes(course) {
  const types = [...new Set((course?.classes || []).map((g) => g.type))];
  return types.sort((a, b) => (TYPE_ORDER.indexOf(a) + 1 || 9) - (TYPE_ORDER.indexOf(b) + 1 || 9));
}

/**
 * The groups of one type, with the ones that belong to the chosen lecture group first
 * (BGU numbers tutorials after their lecture: lecture 2 → tutorials 21, 22…).
 */
export function groupsOf(course, type, lectureGroup) {
  const list = (course?.classes || []).filter((g) => g.type === type);
  if (!lectureGroup || type === 'שעור') return list;
  const mine = (g) => g.group.length > lectureGroup.length && g.group.startsWith(lectureGroup);
  return [...list.filter(mine), ...list.filter((g) => !mine(g))];
}

/** The student's chosen group per type: { 'שעור': '1', 'תרגיל': '11' }. */
export const chosen = (course, progress) => progress.classGroups?.[course.id] || {};

/** A room as the portal writes it, e.g. "גוטמן [32], חדר 307" → "[32] גוטמן, 307"; "" when online. */
export function roomLabel(slot) {
  if (!slot?.place) return slot?.mode || '';
  const m = slot.place.match(/^(.*?)\s*\[(\d+)\]\s*(?:חדר\s*)?(.*)$/);
  return m ? `[${m[2]}] ${m[1].trim()}${m[3] ? `, ${m[3].trim()}` : ''}` : slot.place;
}

/** A group's rooms across its weekly meetings, portal-style, de-duplicated. */
export const groupRooms = (g) => [...new Set(g.slots.map(roomLabel).filter(Boolean))].join(' · ');

/** Which groups of a type match a free-text room/building query (e.g. "307", "גוטמן"). */
export function matchRoom(course, type, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return (course?.classes || []).filter((g) => g.type === type && g.slots.some((sl) => (sl.place || '').toLowerCase().includes(q)));
}

/** After a lecture group is chosen, its one matching tutorial/lab (BGU numbers it 21, 22… under lecture 2). */
export function soleMatch(course, type, lectureGroup) {
  if (!lectureGroup || type === 'שעור') return null;
  const mine = (course?.classes || []).filter((g) => g.type === type && g.group.length > lectureGroup.length && g.group.startsWith(lectureGroup));
  return mine.length === 1 ? mine[0].group : null;
}

/** Everything the share link needs: { [courseId]: { [type]: group } } for courses with a full pick. */
export function shareableGroups(courses, progress) {
  const out = {};
  for (const c of courses) {
    const pick = chosen(c, progress);
    const types = classTypes(c);
    if (types.length && types.every((t) => pick[t])) out[c.id] = Object.fromEntries(types.map((t) => [t, pick[t]]));
  }
  return out;
}

/** A share payload → only picks that still fit the current catalog (groups can change between semesters). */
export function validShared(courses, shared) {
  const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
  const out = {};
  for (const [cid, picks] of Object.entries(shared || {})) {
    const c = byId[cid];
    if (!c) continue;
    const ok = {};
    for (const [type, group] of Object.entries(picks)) {
      if ((c.classes || []).some((g) => g.type === type && g.group === String(group))) ok[type] = String(group);
    }
    if (Object.keys(ok).length) out[cid] = ok;
  }
  return out;
}

/** Whether the student still has a group to pick in this course. */
export const missingGroups = (course, progress) => classTypes(course).filter((t) => !chosen(course, progress)[t]);

/** Every weekly meeting of the student's chosen groups, across courses. */
export function mySlots(courses, progress) {
  const out = [];
  for (const c of courses) {
    const pick = chosen(c, progress);
    for (const g of c.classes || []) {
      if (pick[g.type] !== g.group) continue;
      for (const s of g.slots) out.push({ ...s, course: c, type: g.type, group: g.group, lecturer: g.lecturer, key: `${c.id}-${g.group}-${s.day}-${s.start}` });
    }
  }
  return out.sort((a, b) => a.day - b.day || minutes(a.start) - minutes(b.start));
}

/**
 * Meetings the student's portal schedule has that the catalog can't give: some courses list their groups without
 * days and times (physics), so no group can be matched and `mySlots` has nothing for them. Those lessons are shown as
 * the portal has them (day, time, room), with no group. A lesson `have` already covers (same course, same day,
 * about the same start) is left out.
 */
export function portalOnlySlots(courses, lessons, have) {
  const out = [];
  for (const l of lessons || []) {
    const course = courseOfLesson(courses, l);
    if (!course || !l.start || !l.end) continue;
    if (have.some((s) => s.course.id === course.id && s.day === l.day && Math.abs(minutes(s.start) - minutes(l.start)) <= 15)) continue;
    out.push({ day: l.day, start: l.start, end: l.end, place: l.location || '', mode: l.online ? 'אונליין' : '', course, type: l.type, group: null, lecturer: '', fromPortal: true, key: `${course.id}-portal-${l.day}-${l.start}` });
  }
  return out;
}

/**
 * The next meetings from now on (today's remaining first), with how far away they are. A meeting that isn't held
 * (cancelled) is skipped for that date, and one that moved is placed at its new time and room.
 */
export function upcoming(slots, now = new Date(), limit = 4, ctx = null) {
  const il = israelNow(now.getTime());
  const out = [];
  for (const base of slots) {
    for (let k = 0; k < 14; k++) {
      const date = addDays(il.date, k);
      if (weekdayOf(date) !== base.day) continue;
      const s = slotOn(base, date, ctx);
      if ((k === 0 && minutes(s.end) <= il.min) || s.canceled) continue;
      out.push({ ...s, days: k, startIn: k * 1440 + minutes(s.start) - il.min, live: k === 0 && minutes(s.start) <= il.min });
      break;
    }
  }
  return out.sort((a, b) => a.startIn - b.startIn).slice(0, limit);
}

/** "עכשיו", "בעוד 25 דקות", "היום ב־14:00", "מחר ב־10:00", "ביום רביעי ב־16:00". */
export function whenLabel(s) {
  if (s.live) return 'עכשיו';
  if (s.days === 0 && s.startIn < 60) return `בעוד ${Math.max(1, s.startIn)} דקות`;
  if (s.days === 0) return `היום ב־${s.start}`;
  if (s.days === 1) return `מחר ב־${s.start}`;
  return `ביום ${DAY_NAMES[s.day]} ב־${s.start}`;
}

// ---------- what is different on a date: the portal, and what the notices say ----------
const numbers = (s) => [...String(s || '').matchAll(/\d+/g)].map((m) => String(Number(m[0]))).sort().join(',');
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/**
 * The context the timetable is read in: the notices' changes (updates feed: course announcements, and in the cloud
 * the student's own portal notices), the portal's lessons (cloud, when connected) and the clock in Israel.
 */
export const scheduleContext = ({ items = [], lessons = null, now = new Date() } = {}) => ({
  changes: changesFrom({ items }),
  lessons: lessons?.length ? lessons : null,
  now: israelNow(now.getTime()),
});

/**
 * One weekly meeting as it is on `date`: the portal's room (when it differs from the catalog's), a cancellation
 * (`canceled`: shown until that meeting has ended, then it is the regular one again), a room or time a notice moved,
 * and the portal's notices. Matched by weekday and start time (within a quarter of an hour).
 */
export function slotOn(s, date, ctx) {
  const out = { ...s, date, catalogPlace: s.place, canceled: false, moved: false, timeMoved: false, notices: [], note: '' };
  if (!ctx) return out;
  const p = ctx.lessons?.find((l) => l.day === s.day && Math.abs(minutes(l.start) - minutes(s.start)) <= 15);
  if (p) {
    if (p.location && numbers(p.location) && numbers(s.place) && numbers(p.location) !== numbers(s.place)) { out.place = p.location; out.moved = true; }
    out.notices = p.notifications || [];
    // The portal flags the cancelled meeting of this week – until it would have ended.
    const thisWeek = addDays(ctx.now.date, s.day - ctx.now.day);
    out.canceled = !!p.canceled && date === thisWeek && (date > ctx.now.date || ctx.now.min < minutes(s.end));
  }
  const ch = changeFor(ctx.changes, { courseId: s.course.id, type: s.type, group: s.group, day: s.day, start: s.start, end: s.end }, date, ctx.now);
  if (ch) {
    if (ch.canceled) out.canceled = true;
    if (ch.room) { out.place = ch.room; out.moved = true; }
    if (ch.start) { out.origStart = s.start; out.origEnd = s.end; out.start = ch.start; out.end = ch.end || hhmm(minutes(ch.start) + minutes(s.end) - minutes(s.start)); out.timeMoved = true; }
    out.note = ch.headline;
  }
  return out;
}

/** The student's meetings as they are this week (Sunday to Saturday; on Saturday, the coming week), for the week view. */
export function thisWeek(slots, ctx) {
  if (!ctx) return slots.map((s) => slotOn(s, null, null));
  const sunday = addDays(ctx.now.date, ctx.now.day === 6 ? 1 : -ctx.now.day);
  return slots.map((s) => slotOn(s, addDays(sunday, s.day), ctx));
}
