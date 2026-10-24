// The degree committee's overlay: every course's weekly meetings on one grid, to see when nobody has class.
// A student registers one "line" per course – a lecture group with its tutorial group (BGU numbers a tutorial after
// its lecture: tutorial 21 belongs to lecture 2), or just a lecture group. A cell's "busy" share is the share of
// students expected to have class then, assuming the cohort splits evenly over the lines the faculty offers it:
// per course the share of its lines meeting in that cell, and over courses 1 − Π(1 − share).

import { minutes } from './schedule.js';

export const CELL = 30; // minutes per grid row
export const DAYS = [0, 1, 2, 3, 4, 5];

const byGroup = (a, b) => Number(a.group) - Number(b.group);
export const lineId = (groups) => groups.join('+');

/** All registration lines a course's catalog groups allow: [{ id, groups, label, slots }]. */
export function possibleLines(classes = []) {
  const lectures = classes.filter((g) => g.type === 'שעור');
  const others = classes.filter((g) => g.type !== 'שעור').sort(byGroup);
  const lectureOf = (g) => lectures.find((l) => l.group === g.group.slice(0, -1));
  const out = [];
  const withTutorial = new Set();
  for (const t of others) {
    const l = lectureOf(t);
    if (l) withTutorial.add(l.group);
    const groups = l ? [l.group, t.group] : [t.group];
    out.push({ id: lineId(groups), groups, slots: [...(l?.slots || []), ...t.slots], lecturer: [l?.lecturer, t.lecturer].filter(Boolean).join(' / ') });
  }
  for (const l of lectures.sort(byGroup)) if (!withTutorial.has(l.group)) out.push({ id: l.group, groups: [l.group], slots: l.slots, lecturer: l.lecturer });
  return out;
}

/** The committee's courses: the site's (with classes) and the extra ones, each with its lines and which are on. */
export function committeeCourses(courses, data, saved) {
  const all = [...courses.filter((c) => c.classes?.length), ...(data?.extra || []).filter((c) => c.classes?.length && !courses.some((x) => x.id === c.id))];
  return all.map((c) => {
    const lines = possibleLines(c.classes);
    const defaults = (data?.lines?.[c.id] || []).map(lineId);
    const chosen = saved?.[c.id] || defaults;
    return { id: c.id, short: c.short, name: c.name, color: c.color, lines: lines.map((l) => ({ ...l, on: chosen.includes(l.id) })) };
  });
}

const HOUR_FROM = 8;
const HOUR_TO = 21;
/** Rows of the grid: [{ from, to }] minutes, between the earliest and latest meeting (at least 8:00–20:00). */
export function gridRows(cc) {
  const slots = cc.flatMap((c) => c.lines.filter((l) => l.on).flatMap((l) => l.slots));
  const from = Math.min(HOUR_FROM, ...slots.map((s) => Math.floor(minutes(s.start) / 60))) * 60;
  const to = Math.min(24, Math.max(20, ...slots.map((s) => Math.ceil(minutes(s.end) / 60)))) * 60;
  const rows = [];
  for (let m = from; m < to; m += CELL) rows.push({ from: m, to: m + CELL });
  return rows;
}

const overlaps = (s, row) => minutes(s.start) < row.to && row.from < minutes(s.end);

/**
 * busy[day][row] = { share: 0..1 of students with class, by: [{ course, share, lines }] }.
 * Courses with no line switched on don't count.
 */
export function occupancy(cc, rows, days = DAYS) {
  const active = cc.map((c) => ({ c, on: c.lines.filter((l) => l.on) })).filter((x) => x.on.length);
  return days.map((day) => rows.map((row) => {
    const by = [];
    let free = 1;
    for (const { c, on } of active) {
      const meeting = on.filter((l) => l.slots.some((s) => s.day === day && overlaps(s, row)));
      if (!meeting.length) continue;
      const share = meeting.length / on.length;
      free *= 1 - share;
      by.push({ course: c, share, lines: meeting.map((l) => l.id) });
    }
    return { share: 1 - free, by };
  }));
}

/** Free windows per day: stretches of rows where at most (1 − minFree) of the students have class, ≥ minMinutes long. */
export function freeWindows(grid, rows, days, minFree = 1, minMinutes = 60) {
  const out = [];
  grid.forEach((col, i) => {
    let start = null;
    let worst = 0;
    const close = (end) => {
      if (start != null && end - start >= minMinutes) out.push({ day: days[i], from: start, to: end, busy: worst });
      start = null;
      worst = 0;
    };
    col.forEach((cell, r) => {
      if (1 - cell.share >= minFree - 1e-9) {
        if (start == null) start = rows[r].from;
        worst = Math.max(worst, cell.share);
      } else close(rows[r].from);
    });
    close(rows.length ? rows[rows.length - 1].to : 0);
  });
  return out;
}

export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
