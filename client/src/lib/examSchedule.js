// The exam schedule: every sitting (מועד א׳, מועד ב׳, midterm quizzes) of the student's courses on one timeline, with
// the days left and a warning when two courses' sittings are close together; and, for the degree committee, an
// overview of every course's dates (all exam groups) with the gaps between them.
import { examEvents } from './exam.js';
import { israelNow } from '../../../shared/schedule-changes.js';

const DAY = 86400000;
export const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
export const todayIL = () => israelNow().date;
const valid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

/** Every sitting of the student's own courses, by date: [{ course, key, label, quiz, date, time, place[], official, days }]. */
export function myExams(courses, progress, today = todayIL()) {
  const out = [];
  for (const course of courses) {
    if (course.other) continue;
    const { events, group, differ, groups } = examEvents(course, progress);
    for (const e of events) if (valid(e.date)) out.push({ ...e, course, group, differ, groups, days: dayDiff(today, e.date) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

/** Sittings of different courses within `within` days of each other: attaches `near: [{ with, gap }]` to both. */
export function markNear(list, within = 2) {
  const out = list.map((e) => ({ ...e, near: [] }));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].date > out[i].date && dayDiff(out[i].date, out[j].date) > within) break;
      if (out[i].course.id === out[j].course.id) continue;
      const gap = dayDiff(out[i].date, out[j].date);
      out[i].near.push({ with: out[j], gap });
      out[j].near.push({ with: out[i], gap });
    }
  }
  return out;
}

export const gapText = (gap) => (gap === 0 ? 'באותו יום' : gap === 1 ? 'הפרש של יום' : `הפרש של ${gap} ימים`);

/**
 * The committee's overview: per course, the distinct dates of each kind of sitting across all exam groups (with which
 * groups have it), and, for מועד א׳ and מועד ב׳, the gaps between consecutive dates of different courses.
 */
export function overview(courses) {
  const rows = [];
  for (const course of courses) {
    const groups = course.exams?.groups || {};
    const kinds = new Map();
    for (const [g, list] of Object.entries(groups)) {
      for (const e of list) {
        if (!valid(e.date)) continue;
        const k = kinds.get(e.key) || { key: e.key, label: e.label, quiz: !!e.quiz, dates: new Map() };
        const d = k.dates.get(`${e.date}|${e.time || ''}`) || { date: e.date, time: e.time || '', groups: [], place: new Set() };
        d.groups.push(g);
        for (const p of e.place || []) d.place.add(p);
        k.dates.set(`${e.date}|${e.time || ''}`, d);
        kinds.set(e.key, k);
      }
    }
    if (!kinds.size) continue;
    rows.push({
      course,
      kinds: [...kinds.values()].map((k) => ({ ...k, dates: [...k.dates.values()].map((d) => ({ ...d, place: [...d.place] })).sort((a, b) => a.date.localeCompare(b.date)) }))
        .sort((a, b) => (a.quiz === b.quiz ? a.key.localeCompare(b.key) : a.quiz ? 1 : -1)),
      groupCount: Object.keys(groups).length,
    });
  }
  const gapsFor = (key) => {
    // One date per course and kind – the first, unless the groups differ: then every distinct date counts.
    const points = rows.flatMap((r) => (r.kinds.find((k) => k.key === key)?.dates || []).map((d) => ({ course: r.course, ...d })))
      .sort((a, b) => a.date.localeCompare(b.date));
    const gaps = [];
    for (let i = 0; i + 1 < points.length; i++) {
      if (points[i].course.id === points[i + 1].course.id) continue;
      gaps.push({ from: points[i], to: points[i + 1], gap: dayDiff(points[i].date, points[i + 1].date) });
    }
    return gaps;
  };
  return { rows, a: gapsFor('a'), b: gapsFor('b') };
}
