// Weekly load report: every Sunday morning, what the coming week holds in each course – submissions, exams and
// quizzes day by day, new material from the past week – with a load level per day and for the week.
//
// The core is deterministic (dates, counts, load points: shared/weekly-load.js). The AI only writes the words at
// the edge: a one-line headline and one piece of advice per course. Its output goes through fixed checks
// (checkWeeklyText) – a headline may not name a course or carry numbers (each student sees only their own
// courses), advice must belong to a course in the report and may not mention a date that isn't in it – and
// anything that fails is replaced by a fixed text. Saved as data/weekly/<week start>.json (published with the rest
// of data/), announced in the updates feed, and logged in the run log.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, listCourses, listLectures } from './store.js';
import { aiStatus, generateJSON } from './ai.js';
import { updatesView, announceWeekly } from './updates.js';
import { schedulePublish } from './publish.js';
import { startRun } from './runlog.js';
import { withLoad } from '../../shared/weekly-load.js';

const DIR = path.join(DATA_DIR, 'weekly');
const DAY = 86400000;
const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const IL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' });
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function israel(ms) {
  const p = Object.fromEntries(IL.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, day: WEEKDAY[p.weekday], hour: Number(p.hour) };
}
const ddmm = (date) => `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;
const timeIL = (iso) => new Date(iso).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });

/** The 7 days a report made at `now` covers: from that day on (Israel time). Made on Sunday, that's the whole week. */
export function weekOf(now = Date.now()) {
  return { start: israel(now).date, dates: Array.from({ length: 7 }, (_, i) => israel(now + i * DAY).date) };
}
/** The Sunday the current week started on. */
const sundayOf = (now) => israel(now - israel(now).day * DAY).date;

// ---------- the facts (deterministic) ----------
export function weeklyFacts(now = Date.now()) {
  const week = weekOf(now);
  const inWeek = new Set(week.dates);
  const courses = listCourses().filter((c) => c.ai !== false);
  const ids = new Set(courses.map((c) => c.id));
  const short = Object.fromEntries(courses.map((c) => [c.id, c.short]));
  const items = [];

  // Submissions due this week (the course's Moodle assignments). Whether one was handed in is personal, and the
  // report is shared with every student of the course, so it isn't part of it.
  for (const d of updatesView().deadlines) {
    const date = israel(Date.parse(d.dueAt)).date;
    if (!inWeek.has(date) || !ids.has(d.courseId)) continue;
    items.push({ type: 'deadline', courseId: d.courseId, title: d.title, date, time: timeIL(d.dueAt) });
  }
  // Exams and quizzes this week, from the course catalog (any of the course's groups – the same sitting).
  const exams = new Map();
  for (const c of courses) {
    for (const list of Object.values(c.exams?.groups || {})) {
      for (const e of list) exams.set(`${c.id}|${e.date}|${e.label}`, { c, e });
    }
  }
  for (const { c, e } of exams.values()) {
    if (!inWeek.has(e.date)) continue;
    items.push({ type: e.quiz ? 'quiz' : 'exam', courseId: c.id, title: e.label, date: e.date, time: e.time || '' });
  }
  // Exams in the two weeks after this one: worth starting on now.
  const soon = [...exams.values()]
    .filter(({ e }) => e.date > week.dates[6] && Date.parse(e.date) - Date.parse(week.dates[6]) <= 14 * DAY)
    .map(({ c, e }) => ({ courseId: c.id, label: e.label, date: e.date, quiz: !!e.quiz }));

  const since = now - 7 * DAY;
  const fresh = listLectures().filter((l) => ids.has(l.courseId) && l.status === 'ready' && Date.parse(l.createdAt) > since);

  const report = {
    week: week.start,
    range: `${ddmm(week.dates[0])}–${ddmm(week.dates[6])}`,
    generatedAt: new Date(now).toISOString(),
    days: week.dates.map((date) => ({
      date,
      weekday: HE_DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()],
      items: items.filter((it) => it.date === date).sort((a, b) => (a.time || '').localeCompare(b.time || '')),
    })),
    courses: courses.map((c) => ({
      courseId: c.id,
      short: c.short,
      deadlines: items.filter((it) => it.courseId === c.id && it.type === 'deadline').length,
      exams: items.filter((it) => it.courseId === c.id && it.type !== 'deadline').length,
      soon: soon.filter((s) => s.courseId === c.id),
      newMaterial: fresh.filter((l) => l.courseId === c.id).map((l) => l.title).slice(0, 6),
    })),
  };
  return { report: withLoad(report), short };
}

// ---------- the words (AI) and their checks ----------
const WEEKLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'courses'],
  properties: {
    headline: { type: 'string' },
    courses: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['courseId', 'advice'], properties: { courseId: { type: 'string' }, advice: { type: 'string' } } } },
  },
};

function weeklyPrompt(report) {
  return `להלן העובדות על שבוע הלימודים הקרוב (${report.range}) של סטודנט שנה א' בהנדסת תעשייה וניהול. כל המספרים והתאריכים כבר חושבו – אל תשנה אותם ואל תמציא חדשים.

${JSON.stringify({ level: report.levelLabel, busiest: report.busiest, days: report.days.map((d) => ({ date: d.date, weekday: d.weekday, points: d.points, items: d.items })), courses: report.courses }, null, 1)}

כתוב בעברית, בגוף שני:
- headline: משפט אחד (עד 20 מילים) על אופי השבוע ועל איך כדאי לגשת אליו. בלי שמות של קורסים ובלי מספרים או תאריכים.
- courses: לכל קורס ברשימה (לפי courseId) עצה קצרה ומעשית לשבוע הזה (עד 30 מילים): מה להקדים, על מה לחזור, מתי להתחיל. תאריך מותר רק אם הוא מופיע בעובדות, בפורמט יום.חודש.`;
}

/** Fixed checks on the AI's words. Returns the words to use and the findings (runlog / checks.js format). */
export function checkWeeklyText(ai, report, short) {
  const checks = [];
  const names = Object.values(short);
  const allowedDates = new Set([...report.days.map((d) => ddmm(d.date)), ...report.courses.flatMap((c) => c.soon.map((s) => ddmm(s.date)))]);
  const datesIn = (t) => [...t.matchAll(/\b(\d{1,2})[./](\d{1,2})\b/g)].map((m) => `${Number(m[1])}.${Number(m[2])}`);

  let headline = String(ai?.headline || '').trim();
  if (!headline) checks.push({ rule: 'weekly.headline', level: 'fixed', detail: 'אין כותרת – הוחלפה בנוסח קבוע' });
  else if (headline.length > 200) checks.push({ rule: 'weekly.headline', level: 'fixed', detail: 'כותרת ארוכה מדי – הוחלפה בנוסח קבוע' });
  else if (names.some((n) => headline.includes(n))) checks.push({ rule: 'weekly.headline', level: 'fixed', detail: 'הכותרת מזכירה קורס – הוחלפה בנוסח קבוע' });
  else if (/\d/.test(headline)) checks.push({ rule: 'weekly.headline', level: 'fixed', detail: 'הכותרת כוללת מספרים – הוחלפה בנוסח קבוע' });
  if (checks.length) headline = '';

  const advice = {};
  for (const x of ai?.courses || []) {
    const text = String(x.advice || '').trim();
    if (!short[x.courseId] || !report.courses.some((c) => c.courseId === x.courseId)) {
      checks.push({ rule: 'weekly.course', level: 'fixed', detail: `עצה לקורס שלא בדוח (${x.courseId}) – הוסרה` });
    } else if (!text || text.length > 300) {
      checks.push({ rule: 'weekly.advice', level: 'fixed', detail: `עצה ריקה או ארוכה מדי ב${short[x.courseId]} – הוחלפה` });
    } else if (datesIn(text).some((d) => !allowedDates.has(d))) {
      checks.push({ rule: 'weekly.date', level: 'fixed', detail: `עצה ב${short[x.courseId]} מזכירה תאריך שלא בעובדות – הוחלפה` });
    } else advice[x.courseId] = text;
  }
  return { headline, advice, checks };
}

/** Text that doesn't need a model – used when the AI is unavailable or its words failed a check. */
function fixedHeadline(report) {
  return { light: 'שבוע רגוע – זמן טוב לחזור על החומר ולהתקדם בכרטיסיות.', medium: 'שבוע עם כמה הגשות – כדאי לפזר את העבודה ולא להשאיר הכל לרגע האחרון.', heavy: 'שבוע עמוס – תכננו מראש, התחילו מוקדם ושימו את ההגשות הקרובות ראשונות.' }[report.level];
}
function fixedAdvice(c) {
  if (c.exams) return 'יש מבחן או בוחן השבוע – חזרו על המבחנים הקודמים ועל שאלות התרגול.';
  if (c.deadlines) return c.deadlines === 1 ? 'יש הגשה השבוע – כדאי להתחיל בה כבר בתחילת השבוע.' : 'יש כמה הגשות השבוע – התחילו מהקרובה ביותר.';
  if (c.soon.length) return `${c.soon[0].quiz ? 'בוחן' : 'מבחן'} מתקרב – התחילו לחזור על החומר כבר השבוע.`;
  if (c.newMaterial.length) return 'עלה חומר חדש – עברו על הסיכום וענו על שאלות התרגול.';
  return 'אין הגשות השבוע – זמן טוב לחזור על השיעורים האחרונים.';
}

// ---------- the run ----------
export function weeklyReports() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(0, 26)
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
}

export async function runWeekly({ trigger = 'manual', now = Date.now() } = {}) {
  const { report, short } = weeklyFacts(now);
  const run = startRun('weekly', { trigger, input: { week: report.week, items: report.days.reduce((s, d) => s + d.items.length, 0), courses: report.courses.length } });
  let ai = null;
  let checks = [];
  let aiError = null;
  if (aiStatus().ready) {
    try {
      ai = await generateJSON({ system: 'אתה יועץ לימודים קצר ומעשי. אתה מנסח בלבד – העובדות והחישובים כבר נתונים.', prompt: weeklyPrompt(report), schema: WEEKLY_SCHEMA, effort: 'low', maxTokens: 3000 });
    } catch (e) {
      aiError = e.message;
    }
  }
  const words = ai ? checkWeeklyText(ai, report, short) : { headline: '', advice: {}, checks: [] };
  checks = [...words.checks, ...(ai ? [] : [{ rule: 'weekly.ai', level: 'fixed', detail: aiError ? `ה AI לא זמין (${aiError.slice(0, 80)}) – נוסח קבוע` : 'אין חיבור ל AI – נוסח קבוע' }])];
  const final = {
    ...report,
    headline: words.headline || fixedHeadline(report),
    headlineBy: words.headline ? 'ai' : 'fixed',
    courses: report.courses.map((c) => ({ ...c, advice: words.advice[c.courseId] || fixedAdvice(c), adviceBy: words.advice[c.courseId] ? 'ai' : 'fixed' })),
    checks: checks.map((c) => c.detail),
  };
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = path.join(DIR, `${final.week}.json.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(final, null, 2));
  fs.renameSync(tmp, path.join(DIR, `${final.week}.json`));
  await announceWeekly(final);
  schedulePublish('דוח עומס שבועי');
  run.ok({ file: `data/weekly/${final.week}.json`, level: final.level, total: final.total, busiest: final.busiest, ai: !!ai, aiWords: Object.keys(words.advice).length + (words.headline ? 1 : 0) }, checks);
  return final;
}

/** Sunday from 07:00 (Israel), once a week; checked every hour so a Mac that was asleep catches up. */
export function startWeekly() {
  const check = () => {
    const now = Date.now();
    const il = israel(now);
    // Already have one made since this week's Sunday (scheduled or by hand).
    const latest = weeklyReports()[0]?.week;
    if (latest && latest >= sundayOf(now)) return;
    if (il.day === 0 && il.hour < 7) return;
    runWeekly({ trigger: 'schedule', now }).catch((e) => console.error('[weekly]', e.message));
  };
  setTimeout(check, 60000).unref?.();
  setInterval(check, 3600000).unref?.();
}
