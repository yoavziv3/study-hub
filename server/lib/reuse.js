// One summary per lecture, whichever group it came from: the same lecture of another group of the same course
// (another Moodle course, another lecturer's deck) gets the summary, questions and cards that already exist instead
// of a second model call – and groups the site builds without AI get them too. "Same lecture" = same subject
// (courses.js subjectOf), same kind and the same lecture number.
import { listLectures, getLecture, getContent, saveContent, getCourse, patchLecture } from './store.js';
import { subjectOf } from './courses.js';

const REUSABLE = (m) => m && (m.kind || 'lecture') === 'lecture' && m.lessonNumber > 0 && !m.held && !m.noAi;

/** The same lecture, with study content, in another course of the same subject (null when there is none or it isn't unique). */
export function twinOf(id) {
  const meta = getLecture(id);
  const subject = subjectOf(getCourse(meta?.courseId));
  if (!subject || !REUSABLE(meta)) return null;
  const twins = listLectures().filter((l) => l.id !== id && l.courseId !== meta.courseId && l.status === 'ready' && REUSABLE(l)
    && l.lessonNumber === meta.lessonNumber && subjectOf(getCourse(l.courseId)) === subject && getContent(l.id)?.summary);
  return twins.length === 1 ? twins[0] : twins.find((l) => l.originalName === meta.originalName) || null;
}

// A deck of another group may be ordered differently, so what points at a slide number is dropped unless both have the
// same number of slides.
const unslide = (c) => ({
  ...c,
  quiz: (c.quiz || []).map(({ showSlide, ...q }) => ({ ...q, slide: 0 })),
  extraQuiz: (c.extraQuiz || []).map(({ showSlide, ...q }) => ({ ...q, slide: 0 })),
  topics: (c.topics || []).map((t) => ({ ...t, slideStart: 0, slideEnd: 0 })),
  notes: c.notes ? { ...c.notes, sections: (c.notes.sections || []).map((x) => ({ ...x, slideStart: 0, slideEnd: 0 })) } : c.notes,
});

async function copy(fromMeta, toId) {
  const toMeta = getLecture(toId);
  const content = getContent(fromMeta.id);
  const same = fromMeta.slideCount && fromMeta.slideCount === toMeta.slideCount;
  await saveContent(toId, { ...(same ? content : unslide(content)), generator: 'reused', reusedFrom: fromMeta.id, generatedAt: new Date().toISOString() });
  await patchLecture(toId, { aiError: null, notesError: null });
}

/** Fill this lecture from its twin; true when it was (so no model call is needed). */
export async function reuseFor(id) {
  const twin = twinOf(id);
  if (!twin) return false;
  await copy(twin, id);
  console.log(`[reuse] ${id} ← ${twin.id}`);
  return true;
}

/** This lecture just got its content: give it to the same lecture of the other groups that have none. Returns how many. */
export async function shareFrom(id) {
  const meta = getLecture(id);
  const subject = subjectOf(getCourse(meta?.courseId));
  if (!subject || !REUSABLE(meta) || !getContent(id)?.summary) return 0;
  const others = listLectures().filter((l) => l.id !== id && l.courseId !== meta.courseId && l.status === 'ready' && REUSABLE(l)
    && l.lessonNumber === meta.lessonNumber && subjectOf(getCourse(l.courseId)) === subject && !getContent(l.id));
  // Several candidates for one number (a lecture split in two parts) can't be told apart – leave them.
  if (others.length !== 1 && !others.every((l) => l.originalName === others[0].originalName)) return 0;
  for (const l of others) await copy(meta, l.id);
  return others.length;
}
