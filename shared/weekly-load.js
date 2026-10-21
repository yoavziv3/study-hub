// The weekly load report's arithmetic, shared by the Mac (server/lib/weekly.js, which builds the report) and the
// cloud (cloud/gate.js, which serves each student only their own courses and so recomputes the totals).
// Deterministic on purpose: the same week always gets the same load, whatever the AI wrote around it.
export const POINTS = { deadline: 3, exam: 5, quiz: 3 };
export const LEVELS = [
  { id: 'light', label: 'שבוע קל', max: 5 },
  { id: 'medium', label: 'שבוע בינוני', max: 11 },
  { id: 'heavy', label: 'שבוע עמוס', max: Infinity },
];
const DAY_LEVELS = [
  { id: 'free', max: 0 },
  { id: 'light', max: 3 },
  { id: 'medium', max: 5 },
  { id: 'heavy', max: Infinity },
];

export const itemPoints = (it) => POINTS[it.type] || 0;
export const levelOf = (points) => LEVELS.find((l) => points <= l.max);
export const dayLevelOf = (points) => DAY_LEVELS.find((l) => points <= l.max).id;

/** Fills in each day's points and level, the week's total, its level and its busiest day. */
export function withLoad(report) {
  const days = report.days.map((d) => {
    const points = d.items.reduce((s, it) => s + itemPoints(it), 0);
    return { ...d, points, level: dayLevelOf(points) };
  });
  const total = days.reduce((s, d) => s + d.points, 0);
  const busiest = days.reduce((b, d) => (d.points > (b?.points || 0) ? d : b), null);
  return { ...report, days, total, level: levelOf(total).id, levelLabel: levelOf(total).label, busiest: busiest?.date || null };
}

/** The report limited to the given courses (a student sees only their own), with the totals recomputed. */
export function forCourses(report, allowed) {
  return withLoad({
    ...report,
    days: report.days.map((d) => ({ ...d, items: d.items.filter((it) => allowed.has(it.courseId)) })),
    courses: report.courses.filter((c) => allowed.has(c.courseId)),
  });
}
