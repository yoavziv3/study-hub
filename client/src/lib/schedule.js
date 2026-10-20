// The weekly timetable: class times and rooms come from the university's course catalog (on each course as
// `classes`); each student picks their own lecture / tutorial group once per course.

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

/** The next meetings from now on (today's remaining first), with how far away they are. */
export function upcoming(slots, now = new Date(), limit = 4) {
  const today = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return slots
    .map((s) => {
      let days = (s.day - today + 7) % 7;
      if (days === 0 && minutes(s.end) <= nowMin) days = 7;
      const startIn = days * 1440 + minutes(s.start) - nowMin;
      return { ...s, days, startIn, live: days === 0 && minutes(s.start) <= nowMin };
    })
    .sort((a, b) => a.startIn - b.startIn)
    .slice(0, limit);
}

/** "עכשיו", "בעוד 25 דקות", "היום ב־14:00", "מחר ב־10:00", "ביום רביעי ב־16:00". */
export function whenLabel(s) {
  if (s.live) return 'עכשיו';
  if (s.days === 0 && s.startIn < 60) return `בעוד ${Math.max(1, s.startIn)} דקות`;
  if (s.days === 0) return `היום ב־${s.start}`;
  if (s.days === 1) return `מחר ב־${s.start}`;
  return `ביום ${DAY_NAMES[s.day]} ב־${s.start}`;
}
