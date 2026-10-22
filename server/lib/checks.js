// Fixed (deterministic) checks after every AI step. A model's output is never used as is: each check cleans what
// can be cleaned by a rule (drops a question with three options, clamps a slide number), and rejects the whole
// output when it can't be trusted (an empty summary). Every finding is returned so the run log (runlog.js) can say
// what was found:
//   { rule, level: 'fixed' | 'warn' | 'reject', detail }
// 'fixed' – the output was corrected by the rule; 'warn' – kept, but worth a look; 'reject' – not used.
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
export function slideRef(question, slide, slideCount) {
  const named = [...String(question).matchAll(/שקף\s*(?:מס(?:פר|')?\s*)?(\d{1,3})/g)].map((m) => Number(m[1])).find((n) => n >= 1 && n <= slideCount);
  const at = named || (Number.isInteger(slide) && slide >= 1 && slide <= slideCount ? slide : 0);
  return { slide: at, showSlide: at > 0 && SLIDE_REF.test(question) };
}

/** Multiple-choice questions: exactly 4 distinct, non-empty options, a valid correctIndex, a question and an explanation. */
export function checkQuiz(quiz = [], { slideCount = 0, label = 'quiz' } = {}) {
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
      : null;
    if (problem) {
      checks.push(finding(`${label}.item`, 'fixed', `הוסרה שאלה: ${problem} – "${text(q.question).slice(0, 60)}"`));
      continue;
    }
    seen.add(text(q.question));
    let slide = Number.isInteger(q.slide) && q.slide >= 0 && q.slide <= slideCount ? q.slide : 0;
    if (slide !== q.slide && q.slide !== undefined) checks.push(finding(`${label}.slide`, 'fixed', `מספר שקף ${q.slide} מחוץ לטווח – הוחלף ב 0`));
    const ref = slideRef(q.question, slide, slideCount);
    if (ref.slide !== slide) checks.push(finding(`${label}.slide`, 'fixed', `השאלה מזכירה את שקף ${ref.slide} – השקף עודכן`));
    slide = ref.slide;
    value.push({ ...q, question: text(q.question), options, slide, ...(ref.showSlide ? { showSlide: true } : {}), difficulty: LEVELS.includes(q.difficulty) ? q.difficulty : 'medium' });
  }
  return { value, checks };
}

/** A lecture's study content (LECTURE_SCHEMA). */
export function checkLecture(content, { slideCount = 0 } = {}) {
  const checks = [];
  if (!content || typeof content !== 'object') return { value: content, checks: [finding('lecture', 'reject', 'אין פלט')] };
  if (!text(content.title)) checks.push(finding('lecture.title', 'reject', 'אין כותרת'));
  if (text(content.summary).length < 300) checks.push(finding('lecture.summary', 'reject', `סיכום קצר מדי (${text(content.summary).length} תווים)`));

  const quiz = checkQuiz(content.quiz, { slideCount });
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
