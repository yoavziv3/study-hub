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
  // Each meeting remembers which group (and kind of group) it belongs to, for the labels on the grid.
  const slotsOf = (g) => (g?.slots || []).map((s) => ({ ...s, type: g.type, group: g.group, lecturer: g.lecturer }));
  const out = [];
  const withTutorial = new Set();
  for (const t of others) {
    const l = lectureOf(t);
    if (l) withTutorial.add(l.group);
    const groups = l ? [l.group, t.group] : [t.group];
    out.push({ id: lineId(groups), groups, slots: [...slotsOf(l), ...slotsOf(t)], lecturer: [l?.lecturer, t.lecturer].filter(Boolean).join(' / ') });
  }
  for (const l of lectures.sort(byGroup)) if (!withTutorial.has(l.group)) out.push({ id: l.group, groups: [l.group], slots: slotsOf(l), lecturer: l.lecturer });
  return out;
}

/** A line the faculty's list names, by its group numbers (its tutorial needn't carry its lecture's number). */
function lineFromGroups(classes, groups) {
  const found = groups.map((n, i) => classes.find((g) => g.group === n && (i === 0 ? g.type === 'שעור' || groups.length === 1 : g.type !== 'שעור')));
  if (found.some((g) => !g)) return null;
  const slotsOf = (g) => g.slots.map((s) => ({ ...s, type: g.type, group: g.group, lecturer: g.lecturer }));
  return { id: lineId(groups), groups, slots: found.flatMap(slotsOf), lecturer: [...new Set(found.map((g) => g.lecturer).filter(Boolean))].join(' / ') };
}

/** The committee's courses: the site's (with classes) and the extra ones, each with its lines and which are on. */
export function committeeCourses(courses, data, saved) {
  const all = [...courses.filter((c) => c.classes?.length), ...(data?.extra || []).filter((c) => c.classes?.length && !courses.some((x) => x.id === c.id))];
  return all.map((c) => {
    // The faculty's lines first; then the other lines the catalog's numbering allows (not those that would pair one of
    // their tutorials, or a lecture they cover, differently).
    const named = (data?.lines?.[c.id] || []).map((g) => lineFromGroups(c.classes, g)).filter(Boolean);
    const tutorials = new Set(named.flatMap((l) => l.groups.slice(1)));
    const lectures = new Set(named.map((l) => l.groups[0]));
    const lines = [...named, ...possibleLines(c.classes).filter((l) => !named.some((n) => n.id === l.id) && !l.groups.slice(1).some((g) => tutorials.has(g)) && !(l.groups.length === 1 && lectures.has(l.groups[0])))];
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

/**
 * The meetings behind the grid, per day: one block per course, kind of group and time, with the groups that meet then
 * and the share of the course's selected lines (so of its students) that have it. Overlapping blocks get lanes to sit
 * side by side. → [{ day, course, type, groups, lecturers, places, from, to, share, lane, lanes }]
 */
export function meetings(cc, days = DAYS) {
  const out = [];
  for (const c of cc) {
    const on = c.lines.filter((l) => l.on);
    if (!on.length) continue;
    const blocks = new Map();
    for (const l of on) {
      for (const s of l.slots) {
        const key = `${s.day}|${s.start}|${s.end}|${s.type}`;
        const b = blocks.get(key) || { day: s.day, course: c, type: s.type, from: minutes(s.start), to: minutes(s.end), groups: new Set(), lecturers: new Set(), places: new Set(), lines: new Set(), info: new Map() };
        b.groups.add(s.group);
        // Who teaches which group, and where it meets (the block lists every group that has this meeting).
        if (!b.info.has(s.group)) b.info.set(s.group, { group: s.group, lecturer: s.lecturer || '', place: s.place || s.mode || '' });
        if (s.lecturer) b.lecturers.add(s.lecturer);
        if (s.place || s.mode) b.places.add(s.place || s.mode);
        b.lines.add(l.id);
        blocks.set(key, b);
      }
    }
    for (const b of blocks.values()) out.push({ ...b, groups: [...b.groups].sort((x, y) => Number(x) - Number(y)), lecturers: [...b.lecturers], places: [...b.places], groupInfo: [...b.info.values()].sort((x, y) => Number(x.group) - Number(y.group)), share: b.lines.size / on.length });
  }
  // Lanes per day: a cluster of overlapping blocks shares the column's width.
  for (const day of days) {
    const list = out.filter((m) => m.day === day).sort((a, b) => a.from - b.from || a.to - b.to);
    let cluster = [];
    let end = 0;
    const close = () => { const lanes = Math.max(1, ...cluster.map((m) => m.lane + 1)); for (const m of cluster) m.lanes = lanes; cluster = []; };
    const laneEnds = [];
    for (const m of list) {
      if (cluster.length && m.from >= end) { close(); laneEnds.length = 0; end = 0; }
      let lane = laneEnds.findIndex((e) => e <= m.from);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = m.to;
      m.lane = lane;
      cluster.push(m);
      end = Math.max(end, m.to);
    }
    if (cluster.length) close();
  }
  return out;
}
