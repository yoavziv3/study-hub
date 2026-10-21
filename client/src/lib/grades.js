// Grade average and "what do I need on the exam": everything is computed from what the student typed in.
// A course counts towards the average when it has a numeric final grade and credits (נק"ז); a pass/fail course
// ("עובר") adds credits but not to the average – as in the university's own transcript.
import { termKey } from './terms.js';

export const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** Every course on the grades page: site courses and the extra ones, each with { key, name, credits, term, … }. */
export function gradeRows(courses, progress) {
  const g = progress.grades || {};
  const site = courses.map((c) => {
    const mine = g[c.id] || {};
    return {
      key: c.id,
      course: c,
      name: c.short || c.name,
      termKey: termKey(c.term),
      catalogCredits: num(c.credits) || null,
      credits: num(mine.credits) ?? (num(c.credits) || null),
      final: num(mine.final),
      pass: !!mine.pass,
      entry: mine,
    };
  });
  const extra = (progress.extraCourses || []).map((x) => ({
    key: x.id, extra: true, name: x.name, termKey: x.termKey, catalogCredits: null, credits: num(x.credits), final: num(x.final), pass: !!x.pass, entry: g[x.id] || {},
  }));
  return [...site, ...extra];
}

/** { avg, counted (credits in the average), earned (credits of passed courses), n } */
export function average(rows) {
  let sum = 0;
  let counted = 0;
  let earned = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.credits) continue;
    if (r.pass) { earned += r.credits; continue; }
    if (r.final == null) continue;
    sum += r.final * r.credits;
    counted += r.credits;
    n++;
    if (r.final >= (num(r.course?.passGrade) || 56)) earned += r.credits;
  }
  return { avg: counted ? sum / counted : null, counted, earned, n };
}

const isExam = (c) => c.kind === 'exam' || (!c.kind && /מבחן|בחינה/.test(c.name || ''));

/**
 * The components with some graded "מגן" (shield) components left out: their weight moves to the final exam
 * (or, without one, spreads over the other components), as the university does when a shield doesn't help.
 */
function withoutShields(list, drop) {
  if (!drop.size) return list;
  const moved = list.filter((_, i) => drop.has(i)).reduce((s, c) => s + c.weight, 0);
  const kept = list.filter((_, i) => !drop.has(i));
  const exams = kept.filter((c) => isExam(c) && c.grade == null);
  const to = exams.length ? exams : kept;
  const base = to.reduce((s, c) => s + c.weight, 0) || 1;
  return kept.map((c) => (to.includes(c) ? { ...c, weight: c.weight + (moved * c.weight) / base } : c));
}

function score(list) {
  const known = list.filter((c) => c.grade != null).reduce((s, c) => s + (c.weight * c.grade) / 100, 0);
  const rest = list.filter((c) => c.grade == null).reduce((s, c) => s + c.weight, 0);
  return { known, rest };
}

/**
 * What the remaining components (usually the final exam) need for a target final grade.
 * components: [{weight, grade, shield?, kind?, name}] – the ones without a grade are "remaining" and assumed to get
 * the same grade. Graded shield components count only when they help: every way of leaving them out is tried, and
 * the easiest one wins. `dropped` names the shields left out in that case.
 */
export function needed(components, target, minExam = null) {
  const list = (components || []).map((c) => ({ name: c.name, kind: c.kind, shield: !!c.shield, weight: num(c.weight) || 0, grade: num(c.grade) }));
  const total = list.reduce((s, c) => s + c.weight, 0);
  const shields = list.map((c, i) => (c.shield && c.grade != null ? i : -1)).filter((i) => i >= 0).slice(0, 6);
  const options = [];
  for (let mask = 0; mask < 1 << shields.length; mask++) {
    const drop = new Set(shields.filter((_, b) => mask & (1 << b)));
    const { known, rest } = score(withoutShields(list, drop));
    options.push({ known, rest, dropped: [...drop].map((i) => list[i].name), raw: rest ? (target - known) / (rest / 100) : null });
  }
  const { rest } = options[0];
  if (!rest) {
    const top = options.reduce((a, b) => (b.known > a.known ? b : a));
    return { total, known: top.known, rest, final: top.known, need: null, dropped: top.dropped };
  }
  const easiest = options.reduce((a, b) => (b.raw < a.raw ? b : a));
  const need = Math.max(easiest.raw, num(minExam) ?? 0);
  return {
    total,
    known: Math.max(...options.map((o) => o.known)),
    rest,
    need,
    dropped: easiest.dropped,
    impossible: need > 100,
    secured: easiest.raw <= 0 && !(num(minExam) > 0),
    best: Math.max(...options.map((o) => o.known + o.rest)), // with 100 on everything left
  };
}

/** The calculator's starting components: the syllabus's, when the course has them. */
export const syllabusComponents = (course, newId) =>
  (course?.grading?.components || []).map((c) => ({ id: newId(), name: c.name, weight: c.weight, kind: c.kind, shield: !!c.shield, grade: null }));

export const fmtAvg = (v) => (v == null ? '—' : v.toFixed(2));
export const ceil1 = (v) => Math.ceil(v * 10 - 1e-9) / 10;

/** A Moodle grade item as a 0–100 score: its percentage, or the grade scaled by its range ("0–10"). */
export function moodlePercent(item) {
  const pct = num(String(item.percentage || '').replace(/[%\s]/g, ''));
  if (pct != null) return pct;
  const grade = num(String(item.grade || '').replace(/,/g, ''));
  const max = num((String(item.range || '').match(/[\d.]+\s*$/) || [])[0]);
  if (grade == null) return null;
  return max && max !== 100 ? (grade / max) * 100 : grade;
}

const clean = (x) => String(x).replace(/\s+/g, ' ').trim();
// "בוחן 1" matches "בוחן 1 – חדו״א" but never "בוחן 10".
const sameName = (a, b) => {
  const [x, y] = [clean(a), clean(b)].sort((p, q) => p.length - q.length);
  return x === y || (x.length >= 4 && y.startsWith(x) && !/\d/.test(y[x.length]));
};

/** Puts a Moodle grade into the components: the one with the same name gets it, otherwise a new one (weight 0). */
export function withMoodleGrade(components, item, newId) {
  const grade = Math.round(moodlePercent(item) * 10) / 10;
  if (components.some((c) => sameName(c.name, item.name))) return components.map((c) => (sameName(c.name, item.name) ? { ...c, grade } : c));
  return [...components, { id: newId(), name: item.name, weight: 0, grade }];
}
export const usesMoodleGrade = (components, item) =>
  components.some((c) => sameName(c.name, item.name) && num(c.grade) === Math.round(moodlePercent(item) * 10) / 10);
