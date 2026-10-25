// What notices say about the timetable: a cancelled class, a room that moved, a new time – each for a date.
// Claude reads every notice (server/lib/notices.js) and writes, besides its kind, the date it is about (`onDate`),
// the class type, the groups and the room/time; this turns those readings into changes and answers, for one
// meeting of a student's timetable on one date, what the notices make of it. Used by the site (the timetable and the
// "next class" lists) and by the cloud's class reminders, so both show the same thing.
//
// A change lives only as long as it is news: a one-off cancellation or move is marked until that meeting has ended,
// then the mark drops and the meeting is the regular one again. A change that says it is permanent (`repeats`)
// stays for every later week.

export const CHANGE_KINDS = ['cancellation', 'room-change', 'time-change'];

const pad = (n) => String(n).padStart(2, '0');
export const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};
const num = (g) => String(Number(String(g).match(/\d+/)?.[0] ?? NaN));

export const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The first date on or after `from` that falls on `weekday` (0 = Sunday). */
export const nextDate = (from, weekday) => addDays(from, (weekday - weekdayOf(from) + 7) % 7);

const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
/** "יום רביעי" / "ביום ד'" / "רביעי" → 3 (Sunday = 0); -1 when no weekday is named. */
export function namedWeekday(t) {
  const s = String(t || '');
  const full = WEEKDAY_NAMES.findIndex((d) => s.includes(d));
  if (full >= 0) return full;
  const letter = s.match(/יום\s*([א-ו])['׳]/);
  return letter ? 'אבגדהוו'.indexOf(letter[1]) : -1;
}

const IL = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** The clock in Israel: { date: 'YYYY-MM-DD', min: minutes since midnight, day: weekday }. */
export function israelNow(ms = Date.now()) {
  const p = Object.fromEntries(IL.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, min: Number(p.hour) * 60 + Number(p.minute), day: weekdayOf(date) };
}

/** One notice (a feed item or a portal notice with `analysis`) as a change, or null if it isn't one we can place. */
function changeOf(it) {
  const a = it.analysis;
  if (!a || !CHANGE_KINDS.includes(a.kind)) return null;
  const posted = it.createdAt || it.postedAt || it.addedAt || null;
  const postedMs = posted ? Date.parse(posted) : NaN;
  const postedDate = Number.isFinite(postedMs) ? israelNow(postedMs).date : null;
  // A portal notice belongs to one of the student's own lessons (its weekday and start).
  const anchor = it.lessonDay != null && it.lessonStart ? { day: Number(it.lessonDay), start: it.lessonStart } : null;
  let onDate = /^\d{4}-\d{2}-\d{2}$/.test(a.onDate || '') ? a.onDate : null;
  // No date, or one on another weekday than the lesson: the lesson's next meeting from the day it was posted.
  if (anchor && postedDate && (!onDate || weekdayOf(onDate) !== anchor.day)) onDate = nextDate(postedDate, anchor.day);
  // A permanent change that names only a weekday ("בימי ראשון … שינוי קבוע"): it starts at the first such day from the posting.
  if (!onDate && a.repeats && postedDate && namedWeekday(a.day) >= 0) onDate = nextDate(postedDate, namedWeekday(a.day));
  if (!onDate) return null;
  return {
    key: it.key || it.id || `${it.lesson || ''}|${it.title || ''}|${posted}`,
    kind: a.kind,
    courseId: it.courseId || null,
    classType: a.classType || '',
    groups: Array.isArray(a.groups) ? a.groups : [],
    onDate,
    repeats: !!a.repeats,
    room: a.room || '',
    start: /^\d{2}:\d{2}$/.test(a.start || '') ? a.start : '',
    end: /^\d{2}:\d{2}$/.test(a.end || '') ? a.end : '',
    anchor,
    headline: a.headline || it.title || '',
    postedAt: posted || '',
  };
}

/**
 * The changes in a student's notices, oldest first (a later notice wins over an earlier one).
 * items: the updates feed (announcements, and the cloud's 'portal' items); lessons: portal lessons whose
 * `notifications` carry an `analysis` (the cloud's phone notifications read these directly).
 */
export function changesFrom({ items = [], lessons = [], noticeTime = Date.parse } = {}) {
  const seen = new Set();
  const out = [];
  const add = (c) => {
    if (!c || seen.has(c.key)) return;
    seen.add(c.key);
    out.push(c);
  };
  for (const it of items) if (it.type === 'announcement' || it.type === 'portal') add(changeOf(it));
  for (const l of lessons) {
    for (const n of l.notifications || []) {
      const at = noticeTime(n.date);
      add(changeOf({ analysis: n.analysis, key: `portal:${l.name}|${n.title}|${n.date}`, lesson: l.name, title: n.title, lessonDay: l.day, lessonStart: l.start, postedAt: Number.isFinite(at) ? new Date(at).toISOString() : null }));
    }
  }
  return out.sort((a, b) => String(a.postedAt).localeCompare(String(b.postedAt)));
}

/** slot: { courseId, type, group, day, start, end } – one weekly meeting of the student's timetable. */
function matches(c, slot) {
  if (c.anchor) {
    if (slot.day !== c.anchor.day || Math.abs(minutes(slot.start) - minutes(c.anchor.start)) > 15) return false;
    return !c.courseId || c.courseId === slot.courseId;
  }
  if (c.courseId !== slot.courseId || weekdayOf(c.onDate) !== slot.day) return false;
  if (c.classType && c.classType !== slot.type) return false;
  if (c.groups.length && !c.groups.map(num).includes(num(slot.group))) return false;
  // A notice that names a start (the cancelled lesson's own time) only touches the meeting at that time.
  if (c.start && c.kind !== 'time-change' && Math.abs(minutes(c.start) - minutes(slot.start)) > 15) return false;
  return true;
}

/**
 * What the notices make of this meeting on `date`: { canceled, room, start, end, headline } with only what changed,
 * or null. now: israelNow(). A one-off change is gone once its meeting has ended.
 */
export function changeFor(changes, slot, date, now) {
  let eff = null;
  for (const c of changes) {
    if (!(c.onDate === date || (c.repeats && date > c.onDate)) || !matches(c, slot)) continue;
    if (!c.repeats) {
      const end = c.kind === 'time-change' && c.end ? c.end : slot.end;
      if (date < now.date || (date === now.date && now.min >= minutes(end))) continue;
    }
    eff ||= { canceled: false, room: '', start: '', end: '', headline: '', kinds: [] };
    if (c.kind === 'cancellation') eff.canceled = true;
    if (c.kind === 'room-change' && c.room) eff.room = c.room;
    if (c.kind === 'time-change' && c.start) {
      eff.start = c.start;
      eff.end = c.end || `${pad(Math.floor((minutes(c.start) + minutes(slot.end) - minutes(slot.start)) / 60))}:${pad((minutes(c.start) + minutes(slot.end) - minutes(slot.start)) % 60)}`;
    }
    eff.headline = c.headline || eff.headline;
    if (!eff.kinds.includes(c.kind)) eff.kinds.push(c.kind);
  }
  return eff;
}
