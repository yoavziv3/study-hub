// Grade composition from each course's syllabus. Where it comes from, in order: the syllabus page the university's
// course catalog links to (public, no sign-in), a syllabus PDF on the course's Moodle page, or else the course's
// opening lectures (lecturers often show the grade breakdown on the first slides). The text goes to the AI once,
// which returns the components and their weights ("בוחן מגן 7%", "בחינה סופית 76%"…), stored on the course as
// `grading` and published with courses.json – so the exam calculator on the grades page starts from the real
// weights. Re-read when the source text changes.
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { listCourses, patchCourse, listLectures, getSlides } from './store.js';
import { pdfTextPerPage } from './extract.js';
import { aiStatus, generateJSON } from './ai.js';
import { GRADING_SCHEMA, gradingPrompt } from './prompts.js';

const RECHECK_MS = 7 * 86400000;
const MAX_TEXT = 24000;

/** The syllabus link most of the course's groups point to, from the catalog page. */
export function parseSyllabusUrl(html) {
  const counts = new Map();
  for (const m of html.matchAll(/href="(https:\/\/moodle\.bgu\.ac\.il\/moodle\/local\/syllabus_creator\/syllabus_view\.php\?[^"]+)"/g)) {
    const url = m[1].replace(/&amp;/g, '&');
    counts.set(url, (counts.get(url) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The syllabus page as plain text (Moodle's page chrome and scripts left out). */
export async function fetchSyllabusText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`סילבוס: ${res.status}`);
  const html = await res.text();
  const main = html.match(/<div role="main"[\s\S]*?(?=<footer|$)/)?.[0] || html;
  return decode(
    main
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|tr|h\d)>|<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, MAX_TEXT);
}

const round = (n) => Math.round(Number(n) * 10) / 10;

/** The syllabus PDF on the course's Moodle page, as text (moodle.js is loaded lazily: it imports the catalog). */
async function moodleSyllabus(course) {
  const { syllabusFile } = await import('./moodle.js');
  const file = await syllabusFile(course.id).catch(() => null);
  if (!file) return null;
  try {
    return { text: (await pdfTextPerPage(file.path)).join('\n').slice(0, MAX_TEXT), url: file.href, source: 'moodle' };
  } finally {
    await fsp.rm(path.dirname(file.path), { recursive: true, force: true });
  }
}

/** The opening lectures' slides, where the grade breakdown is often presented. */
function lectureSyllabus(course) {
  const first = listLectures(course.id).filter((l) => (l.kind || 'lecture') === 'lecture' && l.status === 'ready').slice(0, 2);
  const text = first.map((l) => getSlides(l.id).map((s) => s.text).join('\n')).join('\n\n').slice(0, MAX_TEXT);
  return text.trim() ? { text, url: null, lectureId: first[0].id, source: 'lecture' } : null;
}

async function sourceOf(course) {
  if (course.syllabusUrl) return { text: await fetchSyllabusText(course.syllabusUrl), url: course.syllabusUrl, source: 'catalog' };
  return (await moodleSyllabus(course)) || lectureSyllabus(course);
}

/** Reads one course's syllabus if it's new or changed. Returns true when the grading was updated. */
export async function syncGrading(course, { force = false } = {}) {
  if (!aiStatus().ready || course.ai === false) return false;
  const g = course.grading;
  // Checked recently, and no new syllabus link appeared in the catalog since.
  if (!force && g?.checkedAt && Date.now() - Date.parse(g.checkedAt) < RECHECK_MS && (!course.syllabusUrl || g.url === course.syllabusUrl)) return false;
  const src = await sourceOf(course);
  if (!src) return false;
  const { text, url } = src;
  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
  const checkedAt = new Date().toISOString();
  if (!force && g?.hash === hash) {
    await patchCourse(course.id, { grading: { ...g, checkedAt } });
    return false;
  }
  const r = await generateJSON({ system: 'אתה עוזר שמחלץ מידע מדויק מסילבוסים של קורסים באוניברסיטה.', prompt: gradingPrompt({ course, text, fromLecture: src.source === 'lecture' }), schema: GRADING_SCHEMA, effort: 'medium', maxTokens: 4000 });
  const components = (r.found ? r.components : []).filter((c) => c.name && c.weight > 0).map((c) => ({ name: c.name.trim(), weight: round(c.weight), kind: c.kind, shield: !!c.shield }));
  const total = components.reduce((s, c) => s + c.weight, 0);
  await patchCourse(course.id, {
    grading: {
      components,
      // Weights that don't add up to 100 are kept but flagged, so the calculator says so.
      complete: Math.abs(total - 100) < 0.5,
      minExam: r.minExamGrade > 0 ? round(r.minExamGrade) : null,
      passGrade: r.passGrade > 0 ? round(r.passGrade) : null,
      notes: (r.notes || []).slice(0, 4),
      source: src.source,
      url,
      ...(src.lectureId && { lectureId: src.lectureId }),
      hash,
      checkedAt,
      extractedAt: checkedAt,
    },
  });
  return true;
}

/** Every course with a syllabus link (one at a time – each is an AI call). */
export async function syncAllGrading({ force = false } = {}) {
  const result = { updated: [], errors: [] };
  for (const c of listCourses()) {
    try {
      if (await syncGrading(c, { force })) result.updated.push(c.short);
    } catch (e) {
      result.errors.push(`${c.short}: ${e.message}`);
    }
  }
  return result;
}
