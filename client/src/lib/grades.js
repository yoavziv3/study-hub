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

/**
 * What the remaining components (usually the final exam) need for a target final grade.
 * components: [{weight, grade}] – the ones without a grade are "remaining" and assumed to get the same grade.
 */
export function needed(components, target, minExam = null) {
  const list = (components || []).map((c) => ({ weight: num(c.weight) || 0, grade: num(c.grade) }));
  const total = list.reduce((s, c) => s + c.weight, 0);
  const known = list.filter((c) => c.grade != null).reduce((s, c) => s + (c.weight * c.grade) / 100, 0);
  const rest = list.filter((c) => c.grade == null).reduce((s, c) => s + c.weight, 0);
  if (!rest) return { total, known, rest, final: known, need: null };
  const raw = (target - known) / (rest / 100);
  const need = Math.max(raw, num(minExam) ?? 0);
  return {
    total,
    known,
    rest,
    need,
    impossible: need > 100,
    secured: raw <= 0 && !(num(minExam) > 0),
    best: known + rest, // with 100 on everything left
  };
}

export const fmtAvg = (v) => (v == null ? '—' : v.toFixed(2));
export const ceil1 = (v) => Math.ceil(v * 10 - 1e-9) / 10;
