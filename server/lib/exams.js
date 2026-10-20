// Official exam dates from BGU's public course catalog (bgu4u "קובץ הקורסים"): for every course with a code
// and a term, the course page lists each group's מועד א׳/ב׳ and midterm quizzes (בוחן) with date, start time
// (once published) and place.
// Stored on the course as `exams` and published with courses.json, so every student sees them.
import { listCourses, patchCourse } from './store.js';
import { announceExamDates } from './updates.js';

const CATALOG = 'https://bgu4u.bgu.ac.il/pls/scwp/!app.ann';
const REFRESH_MS = 12 * 3600000;
let running = false;

const clean = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// "ע"ש משפחת מרקוס,גוטמן [32], חדרים: ,206,207" → "גוטמן [32], חדרים 206, 207"; "חדרים: 00" = not assigned yet.
function placeLines(html) {
  return html
    .split(/<br\s*\/?>/i)
    .map(clean)
    .filter(Boolean)
    .map((line) => {
      const [where, rooms = ''] = line.replace(/^ע"ש משפחת מרקוס\s*,\s*/, '').split(/,?\s*חדרים:\s*/);
      const list = rooms.split(',').map((r) => r.trim()).filter((r) => r && !/^0+$/.test(r));
      return `${where.replace(/\s+\[/, ' [').trim()}${list.length ? `, ${list.length === 1 ? 'חדר' : 'חדרים'} ${list.join(', ')}` : ''}`;
    });
}

/** "א'" → מועד א׳, "בוחן-2" → בוחן 2. */
function sitting(label) {
  const q = label.match(/^בוחן\s*-?\s*(\d*)/);
  if (q) return { key: `q${q[1] || 1}`, label: `בוחן${q[1] ? ` ${q[1]}` : ''}`, quiz: true };
  const m = label.match(/^([אבג])['׳]?$/);
  return m ? { key: { א: 'a', ב: 'b', ג: 'c' }[m[1]], label: `מועד ${m[1]}׳`, quiz: false } : null;
}

/** The exam table of a course page → { [group]: [{ key, label, quiz, date, time, place: [] }] } sorted by date. */
export function parseExams(html) {
  const start = html.indexOf('פרטי בחינה');
  if (start < 0) return {};
  const table = html.slice(start, html.indexOf('</table>', start));
  const groups = {};
  let group = null;
  for (const row of table.split(/<tr[^>]*>/i).slice(1)) {
    const raw = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (raw.length < 4) continue;
    const cells = raw.map(clean);
    if (/^\d+$/.test(cells[0])) group = cells[0];
    const which = sitting(cells[1]);
    const d = cells[2].match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!group || !which || !d) continue;
    const time = cells[2].match(/\b(\d{1,2}:\d{2})\b/)?.[1] || '';
    (groups[group] ||= []).push({ ...which, date: `${d[3]}-${d[2]}-${d[1]}`, time, place: placeLines(raw[3]) });
  }
  for (const list of Object.values(groups)) list.sort((a, b) => a.date.localeCompare(b.date));
  return groups;
}

/** Fetches one course page: code "142-1-3141", term { year, semester }. */
export async function fetchExams(code, term) {
  const m = String(code).match(/^(\d{3})-(\d)-(\d{4})$/);
  if (!m || !term?.year || !term?.semester) return null;
  const body = new URLSearchParams({
    rc_rowid: '', lang: 'he', st: 'a', step: '3', rn_course: m[3], rn_course_details: '', rn_course_department: m[1],
    rn_course_degree_level: m[2], rn_course_ins: '0', rn_year: String(term.year), rn_semester: String(term.semester),
  });
  const res = await fetch(CATALOG, { method: 'POST', body, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`קובץ הקורסים: ${res.status}`);
  // The catalog is served in ISO-8859-8 (Hebrew).
  const html = new TextDecoder('iso-8859-8').decode(await res.arrayBuffer());
  if (!html.includes('פרטי קורס')) return null; // course not in the catalog for this term
  return parseExams(html);
}

const fmt = (iso) => iso.split('-').reverse().join('/');
const summary = (groups) => (Object.values(groups)[0] || []).map((x) => `${x.label}: ${fmt(x.date)}${x.time ? ` ${x.time}` : ''}`).join(' · ');

/**
 * Refreshes the exam dates of current courses (at most every 12 hours per course, or now with force).
 * A course whose dates appear or change gets an item in the updates feed.
 */
export async function syncExamDates({ force = false } = {}) {
  if (running) return { checked: 0, changed: 0, errors: [] };
  running = true;
  const result = { checked: 0, changed: 0, errors: [] };
  try {
    for (const c of listCourses()) {
      if (!c.code || !c.term) continue;
      if (!force && c.exams?.checkedAt && Date.now() - Date.parse(c.exams.checkedAt) < REFRESH_MS) continue;
      try {
        const groups = await fetchExams(c.code, c.term);
        result.checked++;
        if (!groups) continue;
        const before = JSON.stringify(c.exams?.groups || {});
        const now = new Date().toISOString();
        const changed = before !== JSON.stringify(groups);
        await patchCourse(c.id, { exams: { groups, checkedAt: now, updatedAt: changed ? now : c.exams?.updatedAt || now } });
        if (changed && Object.keys(groups).length) {
          result.changed++;
          await announceExamDates(c.id, { first: before === '{}', text: summary(groups) });
        }
      } catch (e) {
        result.errors.push(`${c.short}: ${e.message}`);
      }
    }
  } finally {
    running = false;
  }
  return result;
}
