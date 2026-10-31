// One summary per lecture, whichever group it came from: when another group of the same course (another Moodle
// course) has the same lecture – the same deck, or one that reads the same – it gets the summary, questions and cards
// that already exist instead of a second model call, and a group the site builds without AI gets them too.
// "The same lecture" is decided by the slides' text, never by the lecture's number: the lecturers of two groups don't
// always teach the same thing in lesson 1 (physics group 2 starts with vectors, the owner's group with kinematics).
import { listLectures, getLecture, getContent, getSlides, saveContent, getCourse, patchLecture } from './store.js';
import { subjectOf } from './courses.js';

const SAME = 0.8; // word-set overlap that makes two decks "the same lecture"
const KEEP_SLIDES = 0.95; // …and this one, with as many slides, that makes their slide numbers interchangeable

const words = (id) => new Set(String(getSlides(id).map((s) => s.text || '').join(' ')).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []);
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

const lessonOf = (m) => m && (m.kind || 'lecture') === 'lecture' && !m.held && !m.noAi;
const candidates = (meta, subject) => listLectures().filter((l) => l.id !== meta.id && l.courseId !== meta.courseId && l.status === 'ready' && lessonOf(l)
  && subjectOf(getCourse(l.courseId)) === subject);

/** The same lecture, with study content, in another course of the same subject – the closest reading, or null. */
export function twinOf(id) {
  const meta = getLecture(id);
  const subject = subjectOf(getCourse(meta?.courseId));
  if (!subject || !lessonOf(meta)) return null;
  const mine = words(id);
  let best = null;
  for (const l of candidates(meta, subject)) {
    const c = getContent(l.id);
    if (!c?.summary || c.generator === 'reused') continue;
    const score = overlap(mine, words(l.id));
    if (score >= SAME && (!best || score > best.score)) best = { l, score };
  }
  return best;
}

// What points at a slide number is dropped unless the two decks are the same size and read almost alike.
const unslide = (c) => ({
  ...c,
  quiz: (c.quiz || []).map(({ showSlide, ...q }) => ({ ...q, slide: 0 })),
  extraQuiz: (c.extraQuiz || []).map(({ showSlide, ...q }) => ({ ...q, slide: 0 })),
  topics: (c.topics || []).map((t) => ({ ...t, slideStart: 0, slideEnd: 0 })),
  notes: c.notes ? { ...c.notes, sections: (c.notes.sections || []).map((x) => ({ ...x, slideStart: 0, slideEnd: 0 })) } : c.notes,
});

async function copy(from, toId, score) {
  const to = getLecture(toId);
  const content = getContent(from.id);
  const keep = score >= KEEP_SLIDES && from.slideCount && from.slideCount === to.slideCount;
  await saveContent(toId, { ...(keep ? content : unslide(content)), generator: 'reused', reusedFrom: from.id, generatedAt: new Date().toISOString() });
  await patchLecture(toId, { aiError: null, notesError: null });
}

/** Fill this lecture from its twin; true when it was (so no model call is needed). */
export async function reuseFor(id) {
  const twin = twinOf(id);
  if (!twin) return false;
  await copy(twin.l, id, twin.score);
  console.log(`[reuse] ${id} ← ${twin.l.id} (${Math.round(twin.score * 100)}% alike)`);
  return true;
}

/** This lecture just got its content: give it to the same lecture of the other groups that have none. Returns how many. */
export async function shareFrom(id) {
  const meta = getLecture(id);
  const subject = subjectOf(getCourse(meta?.courseId));
  if (!subject || !lessonOf(meta) || !getContent(id)?.summary) return 0;
  const mine = words(id);
  let n = 0;
  for (const l of candidates(meta, subject).filter((x) => !getContent(x.id))) {
    const score = overlap(mine, words(l.id));
    if (score < SAME) continue;
    await copy(meta, l.id, score);
    n++;
  }
  return n;
}
