// BGU's public course catalog (bgu4u "קובץ הקורסים"): for every course with a code and a term, the course page
// lists the class groups (lecture / tutorial / lab, lecturer, weekly times and rooms) and each group's exam
// sittings (מועד א׳/ב׳ and midterm quizzes, with date, start time once published, and place).
// Stored on the course as `classes` and `exams` and published with courses.json, so every student sees them.
import { listCourses, patchCourse } from './store.js';
import { announceExamDates, announceClassChange } from './updates.js';

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

const DAYS = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5, ש: 6 };

/**
 * The class-groups table → [{ group, type, lecturer, slots: [{ day (0 = Sunday), start, end, place, mode }] }].
 * A group that meets more than once a week continues on rows without a group number.
 */
export function parseClasses(html) {
  const start = html.indexOf('פרטי קבוצות לימוד');
  if (start < 0) return [];
  const end = html.indexOf('פרטי בחינה', start);
  const table = html.slice(start, end > 0 ? end : undefined);
  const groups = [];
  for (const row of table.split(/<tr[^>]*>/i).slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    const details = cells.find((c) => c.includes('זמני לימוד'));
    let g = groups[groups.length - 1];
    if (/^\s*\d+\s*$/.test(clean(cells[0] || ''))) {
      g = { group: clean(cells[0]), type: clean(cells[1] || ''), lecturer: clean(cells[2] || ''), slots: [] };
      groups.push(g);
    }
    if (!g || !details) continue;
    for (const part of details.split(/<span[^>]*>\s*זמני לימוד:\s*<\/span>/i).slice(1)) {
      const text = clean(part.replace(/<br\s*\/?>/gi, ' | '));
      const t = text.match(/יום\s*([א-ש])['׳]?\s*\|?\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      if (!t || DAYS[t[1]] == null) continue;
      const place = (text.match(/מקום לימוד:\s*([^|]*)/)?.[1] || '').replace(/\s+\[/, ' [').trim();
      const mode = (text.match(/אופן לימוד:\s*([^|]*)/)?.[1] || '').replace(/\s*החל משבוע 1 כל שבוע\s*$/, '').trim();
      g.slots.push({ day: DAYS[t[1]], start: t[2].padStart(5, '0'), end: t[3].padStart(5, '0'), place, mode });
    }
  }
  return groups.filter((g) => g.slots.length);
}

/** Credit points and the passing grade from the course details ("נקודות זכות: 3.50", "ציון מעבר: 56"). */
export function parseDetails(html) {
  const val = (label) => {
    const i = html.indexOf(label);
    if (i < 0) return null;
    const m = html.slice(i, i + 400).match(/class="val">\s*([\d.]+)/);
    return m ? Number(m[1]) : null;
  };
  return { credits: val('נקודות זכות'), passGrade: val('ציון מעבר') };
}

const DAY_LETTER = 'אבגדהוש';
const slotLine = (s) => `יום ${DAY_LETTER[s.day]}׳ ${s.start}–${s.end}${s.place ? ` · ${s.place}` : s.mode ? ` · ${s.mode}` : ''}`;

/** Groups whose weekly times or rooms changed between two catalog reads. */
export function classChanges(before = [], after = []) {
  const key = (g) => `${g.type}|${g.group}`;
  const old = new Map(before.map((g) => [key(g), g]));
  const out = [];
  for (const g of after) {
    const o = old.get(key(g));
    if (!o) continue;
    const a = o.slots.map(slotLine).join(' / ');
    const b = g.slots.map(slotLine).join(' / ');
    if (a !== b) out.push({ type: g.type, group: g.group, before: a, after: b });
  }
  return out;
}

/** Fetches one course page (code "142-1-3141", term { year, semester }) → { exams, classes, details } or null. */
export async function fetchCatalog(code, term) {
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
  return { exams: parseExams(html), classes: parseClasses(html), details: parseDetails(html) };
}

const fmt = (iso) => iso.split('-').reverse().join('/');
const summary = (groups) => (Object.values(groups)[0] || []).map((x) => `${x.label}: ${fmt(x.date)}${x.time ? ` ${x.time}` : ''}`).join(' · ');

/**
 * Refreshes exam dates and class times of current courses (at most every 12 hours per course, or now with
 * force). A course whose exam dates appear or change gets an item in the updates feed.
 */
export async function syncCatalog({ force = false } = {}) {
  if (running) return { checked: 0, changed: 0, errors: [] };
  running = true;
  const result = { checked: 0, changed: 0, errors: [] };
  try {
    for (const c of listCourses()) {
      if (!c.code || !c.term) continue;
      const fresh = c.exams?.checkedAt && Date.now() - Date.parse(c.exams.checkedAt) < REFRESH_MS;
      if (!force && fresh && c.classes && c.credits != null) continue;
      try {
        const page = await fetchCatalog(c.code, c.term);
        result.checked++;
        if (!page) continue;
        const groups = page.exams;
        const before = JSON.stringify(c.exams?.groups || {});
        const now = new Date().toISOString();
        const changed = before !== JSON.stringify(groups);
        const patch = { exams: { groups, checkedAt: now, updatedAt: changed ? now : c.exams?.updatedAt || now } };
        if (page.classes.length) patch.classes = page.classes;
        if (page.details.credits != null) patch.credits = page.details.credits;
        if (page.details.passGrade != null) patch.passGrade = page.details.passGrade;
        await patchCourse(c.id, patch);
        // A room or time of an existing group moved: tell the students (they see it if it's their group).
        if (c.classes?.length && page.classes.length) {
          for (const ch of classChanges(c.classes, page.classes)) await announceClassChange(c.id, ch);
        }
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
