// Notices read by Claude: Moodle course announcements and the portal's notices on lessons. On the Mac, Claude reads
// each new one (server/lib/notices.js) and writes an "analysis" – what kind of notice it is, which groups it is for,
// what changed (room, day, time, date) and a one-line headline – checked by fixed rules (checks.js checkNotice).
// Announcements carry it on their feed item (data/updates.json); portal notices have theirs in the cloud's
// notice_analysis table, by the notice's key. This file is how the cloud and the site use it.
// Without an analysis (Claude busy, the Mac off) everything works as before: the plain text and the
// group-number heuristics of groups.js.

export const NOTICE_KINDS = {
  'room-change': { label: 'שינוי חדר', icon: '📍', urgent: true },
  cancellation: { label: 'ביטול', icon: '🚫', urgent: true },
  'time-change': { label: 'שינוי שעה', icon: '🕒', urgent: true },
  'date-change': { label: 'שינוי מועד', icon: '📅', urgent: true },
  exam: { label: 'מבחן / בוחן', icon: '📝', urgent: false },
  deadline: { label: 'הגשה', icon: '⏰', urgent: false },
  material: { label: 'חומר', icon: '📚', urgent: false },
  general: { label: 'הודעה', icon: '📣', urgent: false },
};

const shortHash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** A portal notice's key (also its push_sent key, as "portal:<key>"): the lesson, the notice's title, date and start. */
export const noticeKey = (lessonName, n) => shortHash(`${lessonName}|${n.title}|${n.date}|${String(n.content || '').slice(0, 80)}`);

/** The portal writes a notice's date as ISO or as dd/mm/yyyy [hh:mm] (Israel time); ms, or NaN when there is none. */
export function noticeTime(d) {
  if (!d) return NaN;
  const m = String(d).match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  return m ? Date.UTC(+m[3], m[2] - 1, +m[1], (m[4] || 12) - 3, +(m[5] || 0)) : Date.parse(d);
}

/** Readings are versioned: v2 adds the date, class type and times the timetable needs (older ones are read again). */
export const NOTICE_VERSION = 2;

const num = (s) => String(Number(String(s).match(/\d+/)?.[0] ?? NaN));

/**
 * Is a notice for other groups than the student's? From Claude's reading when there is one (its `groups`: the group
 * numbers it is for, none = everyone); null when it can't tell, so the caller falls back to the text heuristics.
 */
export function otherGroupsByAnalysis(analysis, mine) {
  if (!analysis || !Array.isArray(analysis.groups)) return null;
  if (!analysis.groups.length || !mine || !Object.keys(mine).length) return false;
  const nums = analysis.groups.map(num);
  // mine: { [type]: group } for a student, or { [type]: [groups] } for the committee's cohort (every group it has).
  return !Object.values(mine).flat().some((g) => nums.includes(num(g)));
}

/** "📍 מבוא לכלכלה: התרגול של קבוצה 21 עובר לחדר 210" – or null without a usable analysis. */
export function noticeTitle(analysis, courseShort) {
  if (!analysis?.headline) return null;
  const k = NOTICE_KINDS[analysis.kind] || NOTICE_KINDS.general;
  return `${k.icon} ${courseShort ? `${courseShort}: ` : ''}${analysis.headline}`;
}

/** A lesson that changes (room, cancellation, time, date) – sent as a high-priority push. */
export const noticeUrgent = (analysis) => !!(analysis?.headline && NOTICE_KINDS[analysis.kind]?.urgent);
