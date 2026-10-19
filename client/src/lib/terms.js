// Academic terms: each course carries { year, semester } (from its Moodle code, e.g. …2027 1 → תשפ״ז, סמסטר א׳).
// The current term decides which courses are "mine now"; earlier ones live under "לימודי עבר".

const UNITS = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];

/** 2027 (the academic year starting in autumn 2026) → תשפ״ז */
export function hebrewYear(academicYear) {
  let n = (academicYear + 3760) % 1000;
  let s = HUNDREDS[Math.floor(n / 100)];
  n %= 100;
  if (n === 15) s += 'טו';
  else if (n === 16) s += 'טז';
  else s += TENS[Math.floor(n / 10)] + UNITS[n % 10];
  return s.length > 1 ? `${s.slice(0, -1)}״${s.slice(-1)}` : `${s}׳`;
}

export const SEMESTER_LABEL = { 1: 'סמסטר א׳', 2: 'סמסטר ב׳', 3: 'סמסטר קיץ' };
const YEAR_LETTER = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];

export const termKey = (t) => (t ? `${t.year}-${t.semester}` : 'none');
const cmp = (a, b) => a.year - b.year || a.semester - b.semester;

/** The term the calendar is in: semester A Oct–Feb, B Mar–Jul; Aug–Sep already counts as next year's A. */
export function calendarTerm(d = new Date()) {
  const m = d.getMonth() + 1;
  const year = m >= 8 ? d.getFullYear() + 1 : d.getFullYear();
  return { year, semester: m >= 3 && m <= 7 ? 2 : 1 };
}

/** All terms that have courses, oldest first. Courses without a term count as current. */
export function termsOf(courses) {
  const map = new Map();
  for (const c of courses) if (c.term) map.set(termKey(c.term), c.term);
  return [...map.values()].sort(cmp);
}

/** The latest term that has started (by the calendar); before any started, the earliest one. */
export function currentTerm(courses, now = new Date()) {
  const terms = termsOf(courses);
  if (!terms.length) return null;
  const cal = calendarTerm(now);
  const started = terms.filter((t) => cmp(t, cal) <= 0);
  return started.length ? started.at(-1) : terms[0];
}

export const inTerm = (course, term) => !term || !course.term || termKey(course.term) === termKey(term);

/** "שנה א׳" counted from the student's first academic year that has courses. */
export function studyYearLabel(term, terms) {
  if (!term || !terms.length) return '';
  const i = term.year - terms[0].year;
  return `שנה ${YEAR_LETTER[i] || i + 1}׳`;
}

export function termLabel(term, terms) {
  if (!term) return '';
  return `${studyYearLabel(term, terms)} · ${SEMESTER_LABEL[term.semester] || ''} · ${hebrewYear(term.year)}`;
}
