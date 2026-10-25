// Fixed (deterministic) checks after every AI step. A model's output is never used as is: each check cleans what
// can be cleaned by a rule (drops a question with three options, clamps a slide number), and rejects the whole
// output when it can't be trusted (an empty summary). Every finding is returned so the run log (runlog.js) can say
// what was found:
//   { rule, level: 'fixed' | 'warn' | 'reject', detail }
// 'fixed' – the output was corrected by the rule; 'warn' – kept, but worth a look; 'reject' – not used.
import { escapeCurrency } from '../../shared/currency.js';
import { namedWeekday } from '../../shared/schedule-changes.js';

const LEVELS = ['easy', 'medium', 'hard'];
const text = (s) => (typeof s === 'string' ? s.trim() : '');
const finding = (rule, level, detail) => ({ rule, level, detail });

export class CheckError extends Error {
  constructor(checks) {
    super(`הפלט של ה AI לא עבר את הבדיקות: ${checks.filter((c) => c.level === 'reject').map((c) => c.detail).join('; ')}`);
    this.checks = checks;
  }
}
/** Throws when any finding is a rejection (after recording it). */
export function assertUsable(checks) {
  if (checks.some((c) => c.level === 'reject')) throw new CheckError(checks);
  return checks;
}

// A question that points at something on a slide ("לפי הטבלה בשקף 7", "בתרשים שהוצג") can't be answered without
// seeing it: such questions get showSlide, and the slide appears inside the question. A slide number written in the
// question wins over the model's slide field.
const SLIDE_REF = /שקף|בשקפים|טבלה|תרשים|איור|גרף|דיאגרמה|פירמידה|כפי שמוצג|שמוצג|המוצג|שהוצג|שהוצגה|שהוצגו|בתמונה|במצגת/;
// A question that leans on data it doesn't carry ("בנתוני שני השדות", "בדוגמת שני העובדים"): the data is on its slide.
const DATA_REF = /בנתוני\s|בנתונים\b|הנתונים של|לפי הנתונים|מהנתונים|בדוגמ[הא]\b|בדוגמת|בתרחיש/;
// A question that leans on another question ("בהמשך לשאלה הקודמת"): sets are shuffled, so it can't stand alone.
export const ANOTHER_Q = /בשאלה הקודמת|בהמשך לשאלה|מהשאלה הקודמת|שאלה קודמת|בשאלה הבאה|כמו בשאלה|בסעיף הקודם/;
export function slideRef(question, slide, slideCount) {
  const named = [...String(question).matchAll(/שקף\s*(?:מס(?:פר|')?\s*)?(\d{1,3})/g)].map((m) => Number(m[1])).find((n) => n >= 1 && n <= slideCount);
  const at = named || (Number.isInteger(slide) && slide >= 1 && slide <= slideCount ? slide : 0);
  return { slide: at, showSlide: at > 0 && (SLIDE_REF.test(question) || DATA_REF.test(question)) };
}

// ---------- which slide a question is really about ----------
// The model's slide number is a guess, and a text comparison can only catch a clear mistake: slides that are a
// diagram or a dashboard have almost no text, and formulas aren't words. So this is a safety net, not a judge:
// the words of the question and its right answer (formulas left out) are compared with each slide's text, and
// the claim moves to another slide only when that slide matches clearly well and the claimed neighbourhood (±1)
// clearly doesn't. A question with too few words, or without a clear winner, keeps its slide; a link is never
// dropped. A slide named in the text itself ("בשקף 13") always wins.
const stem = (w) => (w.length > 3 && 'והבלמכש'.includes(w[0]) ? w.slice(1) : w);
const noMath = (t) => String(t).replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, ' ').replace(/\\[a-zA-Z]+/g, ' ');
const wordSet = (t) => new Set((noMath(t).toLowerCase().match(/[\u0590-\u05FFa-z0-9]{3,}/g) || []).map(stem));
const NEAR_OK = 0.25; // a claim this well supported (±1 slide) stays
const MOVE_MIN = 0.4; // the slide a question moves to must match at least this much…
const MOVE_GAIN = 0.2; // …and this much better than the claim
const MIN_WORDS = 6; // fewer distinct words than this say too little about the slide

function namedSlide(question, slideCount) {
  return [...String(question).matchAll(/שקף\s*(?:מס(?:פר|')?\s*)?(\d{1,3})/g)].map((m) => Number(m[1])).find((n) => n >= 1 && n <= slideCount) || 0;
}

export function matchSlide(q, slides, claimed) {
  if (!claimed || !slides.length) return claimed;
  const qw = wordSet(`${q.question} ${q.options?.[q.correctIndex] ?? ''}`);
  if (qw.size < MIN_WORDS) return claimed;
  const sets = slides.map(wordSet);
  const score = (n) => {
    let c = 0;
    for (const w of qw) if (sets[n - 1]?.has(w)) c++;
    return c / qw.size;
  };
  const near = Math.max(...[claimed - 1, claimed, claimed + 1].filter((n) => n >= 1 && n <= slides.length).map(score), 0);
  if (near >= NEAR_OK) return claimed;
  let best = 0;
  let at = 0;
  for (let n = 1; n <= slides.length; n++) {
    const sc = score(n);
    if (sc > best) { best = sc; at = n; }
  }
  return best >= MOVE_MIN && best >= near + MOVE_GAIN ? at : claimed;
}

/** The slide a question should link to, and whether to show it inside the question (slides: the slides' texts). */
export function fixSlide(q, slides = [], slideCount = slides.length) {
  const claimed = Number.isInteger(q.slide) && q.slide >= 0 && q.slide <= slideCount ? q.slide : 0;
  const slide = namedSlide(q.question, slideCount) || matchSlide(q, slides, claimed);
  return { slide, claimed, showSlide: slide > 0 && (SLIDE_REF.test(q.question) || DATA_REF.test(q.question)) };
}

/** Multiple-choice questions: exactly 4 distinct, non-empty options, a valid correctIndex, a question and an explanation. */
export function checkQuiz(quiz = [], { slideCount = 0, label = 'quiz', slides = [] } = {}) {
  const checks = [];
  const seen = new Set();
  const value = [];
  for (const q of Array.isArray(quiz) ? quiz : []) {
    const options = (q.options || []).map(text);
    const problem = !text(q.question) ? 'שאלה ריקה'
      : options.length !== 4 ? `${options.length} אפשרויות במקום 4`
      : options.some((o) => !o) ? 'אפשרות ריקה'
      : new Set(options).size !== 4 ? 'אפשרויות כפולות'
      : !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3 ? `correctIndex לא חוקי (${q.correctIndex})`
      : !text(q.explanation) ? 'אין הסבר'
      : seen.has(text(q.question)) ? 'שאלה כפולה'
      : ANOTHER_Q.test(text(q.question)) ? 'נשענת על שאלה אחרת (הסדר אקראי)'
      : null;
    if (problem) {
      checks.push(finding(`${label}.item`, 'fixed', `הוסרה שאלה: ${problem} – "${text(q.question).slice(0, 60)}"`));
      continue;
    }
    seen.add(text(q.question));
    let slide = Number.isInteger(q.slide) && q.slide >= 0 && q.slide <= slideCount ? q.slide : 0;
    if (slide !== q.slide && q.slide !== undefined) checks.push(finding(`${label}.slide`, 'fixed', `מספר שקף ${q.slide} מחוץ לטווח – הוחלף ב 0`));
    // Currency dollars ("67$") written as such, so two prices never pair up as a formula (shared/currency.js).
    const fixedText = { question: escapeCurrency(text(q.question)), options: options.map(escapeCurrency), explanation: escapeCurrency(text(q.explanation)) };
    if (fixedText.question !== text(q.question) || fixedText.explanation !== text(q.explanation) || fixedText.options.some((o, k) => o !== options[k])) {
      checks.push(finding(`${label}.currency`, 'fixed', `סימני $ של מחיר סומנו כטקסט – "${text(q.question).slice(0, 50)}"`));
    }
    const ref = fixSlide({ ...q, ...fixedText, slide }, slides, slideCount);
    if (ref.slide !== slide) {
      checks.push(finding(`${label}.slide`, 'fixed', `השקף הותאם לתוכן השאלה: ${slide || 'ללא'} ← ${ref.slide} – "${fixedText.question.slice(0, 50)}"`));
    }
    slide = ref.slide;
    value.push({ ...q, ...fixedText, slide, ...(ref.showSlide ? { showSlide: true } : {}), difficulty: LEVELS.includes(q.difficulty) ? q.difficulty : 'medium' });
  }
  // A third of the questions should be hard (the prompts ask for it): a bank of mostly easy ones is no exam practice.
  const hard = value.filter((q) => q.difficulty === 'hard').length;
  if (value.length >= 10 && hard / value.length < 0.2) checks.push(finding(`${label}.difficulty`, 'warn', `רק ${hard} מתוך ${value.length} שאלות ברמה קשה`));
  return { value, checks };
}

/** A lecture's study content (LECTURE_SCHEMA). */
export function checkLecture(content, { slideCount = 0, slides = [] } = {}) {
  const checks = [];
  if (!content || typeof content !== 'object') return { value: content, checks: [finding('lecture', 'reject', 'אין פלט')] };
  if (!text(content.title)) checks.push(finding('lecture.title', 'reject', 'אין כותרת'));
  if (text(content.summary).length < 300) checks.push(finding('lecture.summary', 'reject', `סיכום קצר מדי (${text(content.summary).length} תווים)`));

  const quiz = checkQuiz(content.quiz, { slideCount, slides });
  checks.push(...quiz.checks);
  if (quiz.value.length < 5) checks.push(finding('lecture.quiz', 'warn', `רק ${quiz.value.length} שאלות תקינות`));

  const pairs = (list, a, b, rule) => {
    const seen = new Set();
    const kept = (Array.isArray(list) ? list : []).filter((x) => {
      const key = text(x?.[a]).toLowerCase();
      if (!key || !text(x?.[b]) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const dropped = (list?.length || 0) - kept.length;
    if (dropped) checks.push(finding(rule, 'fixed', `הוסרו ${dropped} פריטים ריקים או כפולים`));
    return kept;
  };
  const flashcards = pairs(content.flashcards, 'front', 'back', 'lecture.flashcards');
  const glossary = pairs(content.glossary, 'term', 'definition', 'lecture.glossary');
  const openQuestions = pairs(content.openQuestions, 'question', 'answer', 'lecture.openQuestions');
  if (flashcards.length < 5) checks.push(finding('lecture.flashcards', 'warn', `רק ${flashcards.length} כרטיסיות`));

  // Topics point at slide ranges; out-of-range numbers would jump to a slide that doesn't exist.
  let clamped = 0;
  const topics = (content.topics || []).filter((t) => text(t.title)).map((t) => {
    const max = Math.max(1, slideCount);
    const start = Math.min(Math.max(1, Number(t.slideStart) || 1), max);
    const end = Math.min(Math.max(start, Number(t.slideEnd) || start), max);
    if (start !== t.slideStart || end !== t.slideEnd) clamped++;
    return { ...t, slideStart: start, slideEnd: end };
  });
  if (clamped) checks.push(finding('lecture.topics', 'fixed', `${clamped} נושאים עם טווח שקפים לא חוקי – תוקן`));

  const formulas = (content.formulas || []).filter((f) => text(f.latex) && !/[֐-׿]/.test(f.latex));
  if (formulas.length !== (content.formulas || []).length) checks.push(finding('lecture.formulas', 'fixed', 'הוסרו נוסחאות ריקות או עם עברית בתוך LaTeX'));

  const lessonNumber = Number.isInteger(content.lessonNumber) && content.lessonNumber >= 0 && content.lessonNumber < 100 ? content.lessonNumber : 0;
  return { value: { ...content, quiz: quiz.value, flashcards, glossary, openQuestions, topics, formulas, lessonNumber }, checks };
}

/** Structured notes (NOTES_SCHEMA): sections with typed, non-empty blocks. */
export function checkNotes(notes, { slideCount = 0 } = {}) {
  const checks = [];
  const types = ['text', 'definition', 'example', 'rule', 'important', 'mistake'];
  let dropped = 0;
  const sections = (notes?.sections || [])
    .map((s) => {
      const blocks = (s.blocks || []).filter((b) => text(b.body) && types.includes(b.type));
      dropped += (s.blocks || []).length - blocks.length;
      const max = Math.max(1, slideCount);
      return { ...s, blocks, slideStart: Math.min(Math.max(1, s.slideStart || 1), max), slideEnd: Math.min(Math.max(1, s.slideEnd || 1), max) };
    })
    .filter((s) => text(s.title) && s.blocks.length);
  if (dropped) checks.push(finding('notes.blocks', 'fixed', `הוסרו ${dropped} בלוקים ריקים או מסוג לא מוכר`));
  if (!sections.length) checks.push(finding('notes.sections', 'reject', 'אין אף סעיף עם תוכן'));
  return { value: { ...notes, sections }, checks };
}

/** Grade components from a syllabus: positive weights that add up to 100, a minimum exam grade within 0–100. */
export function checkGrading(r) {
  const checks = [];
  const raw = r?.found ? r.components || [] : [];
  const components = raw.filter((c) => text(c.name) && c.weight > 0 && c.weight <= 100);
  if (components.length !== raw.length) checks.push(finding('grading.components', 'fixed', `הוסרו ${raw.length - components.length} רכיבים בלי שם או עם משקל לא חוקי`));
  const total = components.reduce((s, c) => s + c.weight, 0);
  if (components.length && Math.abs(total - 100) >= 0.5) checks.push(finding('grading.total', 'warn', `המשקלים מסתכמים ל ${Math.round(total * 10) / 10} ולא ל 100 – מסומן במחשבון`));
  const minExam = r?.minExamGrade > 0 && r.minExamGrade <= 100 ? r.minExamGrade : null;
  if (r?.minExamGrade > 100) checks.push(finding('grading.minExam', 'fixed', `ציון מינימום ${r.minExamGrade} לא חוקי – הושמט`));
  return { components, minExam, complete: components.length > 0 && Math.abs(total - 100) < 0.5, checks };
}

/** Open problems with full solutions. */
export function checkProblems(problems = []) {
  const value = (problems || []).filter((p) => text(p.question) && text(p.solution).length >= 40);
  const checks = value.length === problems.length ? [] : [finding('problems.item', 'fixed', `הוסרו ${problems.length - value.length} תרגילים בלי שאלה או בלי פתרון מלא`)];
  return { value: value.map((p) => ({ ...p, difficulty: LEVELS.includes(p.difficulty) ? p.difficulty : 'medium' })), checks };
}

// ---------- a notice as Claude read it (notices.js) ----------
const NOTICE_KIND_IDS = ['room-change', 'cancellation', 'time-change', 'date-change', 'exam', 'deadline', 'material', 'general'];
const digitsIn = (t) => (String(t).match(/\d+/g) || []).map((d) => String(Number(d)));
// Wording that makes a change permanent; the model sometimes misses it ("שינוי קבוע ולא חד פעמי").
const PERMANENT = /שינוי קבוע|קבוע ולא חד[ -]?פעמי|מעתה ואילך|מהיום ואילך|עד סוף הסמסטר/;
/**
 * Nothing in the reading may go beyond the notice: a room, time or date whose numbers aren't in the text is
 * cleared, a group must be one of the course's (or named in the text), and a headline with invented numbers or of
 * the wrong length falls back to the notice's own title.
 */
export function checkNotice(a, { body, title, classes = [], posted = null }) {
  const checks = [];
  if (!a || typeof a !== 'object') return { value: null, checks: [finding('notice', 'reject', 'אין פלט')] };
  const source = new Set(digitsIn(`${title}\n${body}`));
  const kind = NOTICE_KIND_IDS.includes(a.kind) ? a.kind : 'general';
  if (kind !== a.kind) checks.push(finding('notice.kind', 'fixed', `סוג לא מוכר (${a.kind}) – general`));
  const known = new Set(classes.map((g) => String(Number(g.group))));
  const groups = [...new Set((a.groups || []).map((g) => String(Number(String(g).match(/\d+/)?.[0] ?? NaN))).filter((g) => g !== 'NaN'))]
    .filter((g) => known.size ? known.has(g) : source.has(g));
  if (groups.length !== (a.groups || []).length) checks.push(finding('notice.groups', 'fixed', `הוסרו קבוצות שלא קיימות בקורס (${(a.groups || []).join(', ')})`));
  const fields = {};
  for (const f of ['room', 'day', 'time', 'date']) {
    const v = text(a[f]);
    if (v && digitsIn(v).some((d) => !source.has(d))) {
      checks.push(finding(`notice.${f}`, 'fixed', `${f} "${v}" לא מופיע בהודעה – הוסר`));
      fields[f] = '';
    } else fields[f] = v;
  }
  // The date the notice is about (onDate) must be believable: near the day it was posted, on the weekday it names,
  // and on the date it writes out.
  let onDate = /^\d{4}-\d{2}-\d{2}$/.test(text(a.onDate)) && !Number.isNaN(Date.parse(text(a.onDate))) ? text(a.onDate) : '';
  if (text(a.onDate) && !onDate) checks.push(finding('notice.onDate', 'fixed', `תאריך לא תקין (${a.onDate}) – הוסר`));
  if (onDate && posted) {
    const gap = Math.round((Date.parse(`${onDate}T12:00:00Z`) - Date.parse(`${posted}T12:00:00Z`)) / 864e5);
    const weekday = new Date(`${onDate}T12:00:00Z`).getUTCDay();
    const named = namedWeekday(a.day);
    const written = [...`${title}\n${body}`.matchAll(/(?<!\d)(\d{1,2})[./](\d{1,2})(?!\d)/g)].map((m) => `${String(Number(m[2]))}-${String(Number(m[1]))}`);
    const mine = `${Number(onDate.slice(5, 7))}-${Number(onDate.slice(8, 10))}`;
    if (gap < -10 || gap > 60) { checks.push(finding('notice.onDate', 'fixed', `התאריך ${onDate} רחוק מדי מיום הפרסום – הוסר`)); onDate = ''; }
    else if (named >= 0 && weekday !== named) { checks.push(finding('notice.onDate', 'fixed', `התאריך ${onDate} לא ביום שכתוב בהודעה – הוסר`)); onDate = ''; }
    else if (written.length && !written.includes(mine)) { checks.push(finding('notice.onDate', 'fixed', `התאריך ${onDate} לא תואם לתאריך שכתוב בהודעה – הוסר`)); onDate = ''; }
  } else if (onDate) {
    checks.push(finding('notice.onDate', 'fixed', 'אין תאריך פרסום להשוואה – התאריך הוסר'));
    onDate = '';
  }
  const hhmm = (v) => (/^\d{2}:\d{2}$/.test(text(v)) && source.has(String(Number(text(v).slice(0, 2)))) ? text(v) : '');
  const start = hhmm(a.start);
  const end = hhmm(a.end);
  if ((text(a.start) && !start) || (text(a.end) && !end)) checks.push(finding('notice.time', 'fixed', 'שעה שלא מופיעה בהודעה – הוסרה'));
  const classType = ['שעור', 'תרגיל', 'מעבדה'].includes(a.classType) ? a.classType : '';
  let headline = text(a.headline);
  if (!headline || headline.length > 140) {
    checks.push(finding('notice.headline', 'fixed', 'כותרת ריקה או ארוכה מדי – הכותרת המקורית'));
    headline = text(title).slice(0, 140);
  } else if (digitsIn(headline).some((d) => !source.has(d))) {
    checks.push(finding('notice.headline', 'fixed', `מספר בכותרת שלא מופיע בהודעה – הכותרת המקורית ("${headline.slice(0, 50)}")`));
    headline = text(title).slice(0, 140);
  }
  // "Urgent" (a high-priority push) is kept for a lesson that changes, never a reminder or a weekly summary.
  const urgent = !!a.urgent && ['room-change', 'cancellation', 'time-change', 'date-change'].includes(kind);
  // A permanent change keeps its weekday: with no date, "repeats" still holds when the notice names the day.
  let repeats = !!a.repeats;
  if (!repeats && ['room-change', 'time-change'].includes(kind) && PERMANENT.test(`${title}\n${body}`)) {
    repeats = true;
    checks.push(finding('notice.repeats', 'fixed', 'ההודעה אומרת שהשינוי קבוע – סומן כקבוע'));
  }
  if (repeats && !onDate && namedWeekday(fields.day) < 0) {
    repeats = false;
    checks.push(finding('notice.repeats', 'fixed', 'שינוי קבוע בלי תאריך ובלי יום בשבוע – לא סומן כקבוע'));
  }
  return { value: { kind, groups, classType, ...fields, onDate, repeats, start, end, headline, urgent }, checks };
}
