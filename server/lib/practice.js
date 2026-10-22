// More practice questions for a lesson, beyond the 10–14 its summary comes with: written from the lesson's own
// slides (so never ahead of the course), checked like every AI output (checks.js), deduplicated against what the
// lesson already has, and kept in content.extraQuiz. growBank brings a lesson up to BANK_TARGET questions in rounds;
// the ingest pipeline runs it after each new lecture, and /api/maintenance/grow-banks fills up the existing ones.
import { getCourse, getLecture, getContent, saveContent, getSlides, listLectures } from './store.js';
import { generateJSON, aiStatus } from './ai.js';
import { PRACTICE_SCHEMA, practicePrompt } from './prompts.js';
import { startRun } from './runlog.js';
import { checkQuiz } from './checks.js';

export const BANK_TARGET = 30;
const ROUND = 10;
const BANK_KINDS = ['lecture', 'tutorial', 'prep'];

const bankOf = (content) => [...(content?.quiz || []), ...(content?.extraQuiz || [])];

/** One round of new questions for a lesson; returns the questions added. */
export async function addLectureQuestions(lectureId, { count = 6, difficulty = 'mixed', trigger = 'manual' } = {}) {
  const meta = getLecture(lectureId);
  const course = getCourse(meta.courseId);
  const content = getContent(lectureId) || {};
  const slides = getSlides(lectureId);
  const material = slides.map((s) => `[שקף ${s.n}] ${s.text}`).join('\n');
  const avoid = bankOf(content).map((q) => q.question);
  const run = startRun('practice', { trigger, input: { lectureId, course: course.short, title: meta.title, count, difficulty, has: avoid.length } });
  let out;
  try {
    out = await generateJSON({
      system: `אתה כותב שאלות מבחן מקצועי בקורס ${course.name}. הקפד על נכונות מלאה של התשובה המסומנת.`,
      prompt: practicePrompt({ course, title: meta.title, material: material.slice(0, 180000), count, difficulty, avoid: avoid.slice(0, 120) }),
      schema: PRACTICE_SCHEMA,
      effort: 'medium',
      maxTokens: 24000,
    });
  } catch (e) {
    run.fail(e);
    throw e;
  }
  const checked = checkQuiz(out.quiz, { slideCount: slides.length });
  // Questions the lesson already has are not added again.
  const known = new Set(avoid);
  const fresh = checked.value.filter((q) => !known.has(q.question));
  const checks = [...checked.checks, ...(fresh.length < checked.value.length ? [{ rule: 'practice.duplicate', level: 'fixed', detail: `הוסרו ${checked.value.length - fresh.length} שאלות שכבר קיימות` }] : [])];
  run.ok({ asked: count, kept: fresh.length, total: avoid.length + fresh.length }, checks);
  const quiz = fresh.map((q) => ({ ...q, generated: true }));
  const latest = getContent(lectureId) || {};
  await saveContent(lectureId, { ...latest, extraQuiz: [...(latest.extraQuiz || []), ...quiz] });
  return quiz;
}

/** Brings a lesson's bank up to `target` questions, ROUND at a time (stops early if a round adds nothing). */
export async function growBank(lectureId, { target = BANK_TARGET, trigger = 'manual' } = {}) {
  const meta = getLecture(lectureId);
  if (!meta || meta.noAi || !BANK_KINDS.includes(meta.kind || 'lecture') || !aiStatus().ready) return 0;
  if (getCourse(meta.courseId)?.ai === false || !getContent(lectureId)) return 0;
  let added = 0;
  for (let round = 0; round < 4; round++) {
    const have = bankOf(getContent(lectureId)).length;
    if (have >= target) break;
    const got = await addLectureQuestions(lectureId, { count: Math.min(ROUND, target - have + 2), trigger });
    added += got.length;
    if (!got.length) break;
  }
  return added;
}

let growing = false;
/** Every lesson on the site below the target, one after another (in the background). */
export async function growAllBanks({ target = BANK_TARGET } = {}) {
  if (growing) return { running: true };
  growing = true;
  const result = { lectures: 0, added: 0, errors: [] };
  try {
    for (const l of listLectures()) {
      if (l.status !== 'ready' || bankOf(getContent(l.id)).length >= target) continue;
      try {
        const n = await growBank(l.id, { target, trigger: 'manual' });
        if (n) { result.lectures++; result.added += n; }
      } catch (e) {
        result.errors.push(`${l.title}: ${e.message.slice(0, 120)}`);
      }
    }
  } finally {
    growing = false;
  }
  console.log(`[practice] question banks: +${result.added} in ${result.lectures} lessons${result.errors.length ? `, ${result.errors.length} errors` : ''}`);
  return result;
}
