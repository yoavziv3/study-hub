// Exam preparation: how well each lesson is mastered, overall readiness, what to study first and a day-by-day
// plan until the exam. Everything is computed from the student's own progress – no AI involved.
import { hash } from '../api.js';

const DAY = 86400000;
export const STRONG = 0.75;

/** Lessons that count towards readiness (past exams are practice material, not a topic of their own). */
export const prepUnits = (course) =>
  (course?.lectures || []).filter((l) => l.kind !== 'exam' && l.status !== 'processing' && l.status !== 'error' && (l.kind !== 'prep' || l.hasContent));

/**
 * How well one lesson is mastered, 0..1: marked as studied, share of its practice questions answered correctly
 * (the latest answer to each) and share of its flashcards answered "knew it". Lessons without AI material
 * (or the lecturer's exercises) count only the "studied" mark.
 */
export function lectureMastery(l, progress) {
  const studied = !!progress.studied?.[l.id];
  const items = progress.quiz?.[l.id]?.items || {};
  const answered = Object.keys(items).length;
  const right = Object.values(items).filter(Boolean).length;
  const quizTotal = l.quizCount || 0;
  const prefix = `${l.id}:`;
  const cards = Object.entries(progress.cards || {}).filter(([k]) => k.startsWith(prefix));
  const cardsTotal = l.flashcardCount || 0;
  const known = cards.filter(([, c]) => c.box >= 1).length;

  const parts = [[0.35, studied ? 1 : 0]];
  if (quizTotal) parts.push([0.45, Math.min(1, right / quizTotal)]);
  if (cardsTotal) parts.push([0.2, Math.min(1, known / cardsTotal)]);
  const w = parts.reduce((s, [x]) => s + x, 0);
  const value = parts.reduce((s, [x, v]) => s + x * v, 0) / w;
  return {
    value,
    studied,
    quiz: { answered: Math.min(answered, quizTotal || answered), right: Math.min(right, quizTotal || right), total: quizTotal },
    cards: { known: Math.min(known, cardsTotal), total: cardsTotal },
  };
}

export const LEVELS = {
  strong: { label: 'שליטה טובה', cls: 'good' },
  mid: { label: 'כמעט שם', cls: 'warn' },
  weak: { label: 'לחיזוק', cls: 'bad' },
  new: { label: 'טרם התחלת', cls: '' },
};
export const levelOf = (v) => (v >= STRONG ? 'strong' : v >= 0.45 ? 'mid' : v > 0 ? 'weak' : 'new');

/** Why a lesson needs attention, in one short phrase. */
export function reasonOf(m) {
  if (!m.studied && !m.quiz.answered) return 'עוד לא למדת';
  if (m.quiz.total && m.quiz.answered < m.quiz.total * 0.5) return m.quiz.answered ? `ענית על ${m.quiz.answered} מתוך ${m.quiz.total} השאלות` : 'עוד לא תרגלת שאלות';
  if (m.quiz.answered && m.quiz.right / m.quiz.answered < 0.7) return `${Math.round((m.quiz.right / m.quiz.answered) * 100)}% תשובות נכונות בתרגול`;
  if (!m.studied) return 'לא סומן כנלמד';
  if (m.cards.total && m.cards.known < m.cards.total * 0.6) return `${m.cards.known} מתוך ${m.cards.total} כרטיסיות`;
  return 'עוד קצת חיזוק';
}

const order = (l) => [l.kind === 'tutorial' ? 1 : l.kind === 'homework' ? 2 : 0, l.lessonNumber || 99, l.createdAt || ''];
const byOrder = (a, b) => {
  const x = order(a);
  const y = order(b);
  return (x[1] - y[1]) || (x[0] - y[0]) || String(x[2]).localeCompare(String(y[2]));
};

/** Every lesson with its mastery, in course order. */
export function masteryMap(course, progress) {
  return prepUnits(course)
    .map((l) => ({ l, m: lectureMastery(l, progress) }))
    .sort((a, b) => byOrder(a.l, b.l));
}

export function readiness(map) {
  if (!map.length) return 0;
  return map.reduce((s, x) => s + x.m.value, 0) / map.length;
}

/** What to study first: the weakest lessons, untouched ones in course order (the material builds up). */
export function priorities(map) {
  return map
    .filter((x) => x.m.value < STRONG)
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => (a.m.value - b.m.value) || (a.i - b.i));
}

// ---------- exam dates ----------

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const todayKey = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const parseDay = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : null);
export const daysUntil = (s, now = new Date()) => {
  const d = parseDay(s);
  return d ? Math.round((d - startOfDay(now)) / DAY) : null;
};
export const fmtDay = (s) => parseDay(s)?.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }) || '';
export const fmtShortDay = (s) => parseDay(s)?.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' }) || '';

/**
 * A course's exam sittings for this student, by date: the official ones from the university's course catalog
 * (מועדים and midterm quizzes, for the student's group), where dates the student entered replace מועד א׳/ב׳.
 * Returns { events: [{ key, label, quiz, date, time, place[], official }], group, groups, differ, own }.
 */
export function examEvents(course, progress) {
  const all = course?.exams?.groups || {};
  const groups = Object.keys(all).sort((a, b) => Number(a) - Number(b));
  // Exam groups follow the lecture group, unless the student picked an exam group explicitly.
  const picked = progress.examGroup?.[course?.id] || progress.classGroups?.[course?.id]?.['שעור'];
  const group = picked && all[picked] ? picked : groups[0] || null;
  const strip = (list) => JSON.stringify(list.map(({ date, time, place, key }) => [key, date, time, place]));
  const differ = groups.some((g) => strip(all[g]) !== strip(all[groups[0]]));
  let events = (all[group] || []).map((e) => ({ ...e, official: true }));
  const own = progress.exams?.[course?.id];
  if (own && (own.a || own.b)) {
    events = events.filter((e) => e.quiz);
    for (const [key, date] of [['a', own.a], ['b', own.b]]) {
      if (date) events.push({ key, label: `מועד ${key === 'a' ? 'א' : 'ב'}׳`, quiz: false, date, time: '', place: [], official: false });
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
  }
  return { events, group, groups, differ, own: !!(own && (own.a || own.b)) };
}

/** The next sitting (exam or quiz) that hasn't passed yet, with days left – or null. */
export function nextEvent(course, progress) {
  for (const e of examEvents(course, progress).events) {
    const days = daysUntil(e.date);
    if (days != null && days >= 0) return { ...e, days };
  }
  return null;
}

export const daysText = (n) => (n === 0 ? 'היום!' : n === 1 ? 'מחר' : n === 2 ? 'בעוד יומיים' : `בעוד ${n} ימים`);

// ---------- the plan ----------

/**
 * A day-by-day plan from today until the day before the exam. Lessons that still need work are spread over the
 * first days (new material in course order first, then the weak ones); the last days are kept for an exam
 * simulation, your mistakes and past exams. Recomputed from the current progress, so it adapts as you go.
 */
export function buildPlan({ map, examDate, hasQuiz, hasPastExams, now = new Date() }) {
  const days = daysUntil(examDate, now);
  if (days == null || days <= 0) return [];
  const todo = [
    ...map.filter((x) => x.m.value === 0),
    ...map.filter((x) => x.m.value > 0 && x.m.value < STRONG).sort((a, b) => a.m.value - b.m.value),
  ];
  const reserve = days >= 5 ? Math.max(1, Math.round(days * 0.2)) : days >= 2 ? 1 : 0;
  const studyDays = Math.max(1, days - reserve);
  const per = Math.ceil(todo.length / studyDays);
  const plan = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(startOfDay(now).getTime() + i * DAY + 12 * 3600000);
    const tasks = [];
    if (i < studyDays) {
      for (const x of todo.slice(i * per, (i + 1) * per)) tasks.push({ type: 'unit', id: x.l.id, l: x.l, fresh: x.m.value === 0 });
      if (!tasks.length) tasks.push({ type: hasQuiz ? 'weak' : 'review' });
    } else {
      const last = i === days - 1;
      if (hasQuiz) tasks.push({ type: 'sim' });
      if (hasQuiz) tasks.push({ type: 'mistakes' });
      if (!hasQuiz && !last) tasks.push({ type: 'review' });
      if (hasPastExams && !last) tasks.push({ type: 'past' });
      if (last) tasks.push({ type: 'checklist' });
    }
    if (hasQuiz && !tasks.some((t) => t.type === 'sim')) tasks.push({ type: 'cards' });
    plan.push({ date: todayKey(date), tasks });
  }
  return plan;
}

// ---------- questions: mistakes, flagged and practice by weakness ----------

/** All practice questions of a course bundle, tagged with their lesson. */
export function courseQuestions(bundle, courseId) {
  const out = [];
  for (const l of bundle?.lectures || []) {
    for (const q of [...(l.content?.quiz || []), ...(l.content?.extraQuiz || [])]) out.push({ ...q, lectureId: l.id, lectureTitle: l.title });
  }
  for (const q of bundle?.practice?.quiz || []) out.push({ ...q, lectureId: `${courseId}-homework`, lectureTitle: 'תרגול ברמת שיעורי הבית' });
  return out;
}

export const questionKey = (q) => `${q.lectureId}:${hash(q.question)}`;
export const lastAnswer = (progress, q) => progress.quiz?.[q.lectureId]?.items?.[hash(q.question)];

/** Questions whose latest answer was wrong, plus questions the student flagged for review. */
export function mistakesOf(questions, progress) {
  const flagged = progress.flagged || {};
  return questions
    .map((q) => ({ q, wrong: lastAnswer(progress, q) === false, flagged: !!flagged[questionKey(q)] }))
    .filter((x) => x.wrong || x.flagged);
}

/** A practice set aimed at weak spots: past mistakes first, then unanswered and then answered questions from the weakest lessons. */
export function weakSet(questions, map, progress, count = 10) {
  const rank = new Map(priorities(map).map((x, i) => [x.l.id, i]));
  const weight = (q) => (rank.has(q.lectureId) ? rank.get(q.lectureId) : 1000);
  const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
  const wrong = shuffle(questions.filter((q) => lastAnswer(progress, q) === false));
  const fresh = shuffle(questions.filter((q) => lastAnswer(progress, q) === undefined)).sort((a, b) => weight(a) - weight(b));
  const right = shuffle(questions.filter((q) => lastAnswer(progress, q) === true)).sort((a, b) => weight(a) - weight(b));
  return [...wrong, ...fresh, ...right].slice(0, count);
}
