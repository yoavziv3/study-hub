import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import {
  listCourses, getCourse, getLecture, saveLecture, patchLecture, saveSlides, getSlides, saveContent,
  lectureDir, newLectureId, INBOX_DIR, getContent, listLectures,
} from './store.js';
import { convertToPdf, renderSlides, extractSlidesText } from './extract.js';
import { aiStatus, generateJSON } from './ai.js';
import { announceMaterial, adminAlert } from './updates.js';
import { LECTURE_SCHEMA, CLASSIFY_SCHEMA, NOTES_SCHEMA, lectureSystem, lecturePrompt, prepPrompt, classifyPrompt, notesPrompt, DECK_PDF_RULES, DECK_PDF_QUIZ } from './prompts.js';

import { startRun } from './runlog.js';
import { queueBank } from './practice.js';
import { checkLecture, checkNotes, assertUsable, CheckError } from './checks.js';
import { ACCEPTED, EXAM_RE, detectKind } from '../../shared/moodle-kind.js';

export { ACCEPTED, EXAM_RE, detectKind };

// Processing stages shown in the UI, in order.
export const STAGES = ['queued', 'converting', 'rendering', 'extracting', 'classifying', 'analyzing', 'ready'];

const queue = [];
const MIN_TEXT = 300; // less extracted text than this: a scanned file, shown as is
let running = false;

// Item types: lectures, tutorial sessions (תרגולים) and homework / exercise sheets.
export const KINDS = ['lecture', 'tutorial', 'homework', 'exam'];
export const numberFromName = (name) => {
  const m = name.match(/(?:הרצאה|שיעור|יחידה|תרגול|תרגיל|גיליון|מטלה|lecture|lesson|unit|week|שבוע|tutorial|exercise|assignment|hw)\s*[-_ ]?\s*0*(\d{1,2})/i) || name.match(/(?:^|\D)0*(\d{1,2})(?:\D|$)/);
  return m ? parseInt(m[1], 10) : 0;
};

const prettyName = (name) => path.basename(name, path.extname(name)).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

// Keyword vote over file name + extracted text. Returns {courseId, score, margin}.
function guessCourse(fileName, text) {
  const hay = `${fileName}\n${text}`.toLowerCase();
  const scores = listCourses().map((c) => {
    let score = 0;
    for (const k of c.keywords || []) {
      const hits = hay.split(k.toLowerCase()).length - 1;
      score += Math.min(hits, 8) * (fileName.toLowerCase().includes(k.toLowerCase()) ? 4 : 1);
    }
    if (hay.includes(c.code)) score += 50;
    if (hay.includes(c.short.toLowerCase())) score += 10;
    return { courseId: c.id, score };
  });
  scores.sort((a, b) => b.score - a.score);
  return { ...scores[0], margin: scores[0].score - (scores[1]?.score || 0) };
}

/**
 * Register an uploaded file and queue it for processing.
 * courseId may be 'auto' (or empty) to detect the course from the content.
 */
export async function addLectureFile({ filePath, originalName, courseId, lessonNumber, unitNumber, title, content = null, move = false, source = null, kind = null }) {
  const ext = path.extname(originalName).toLowerCase();
  if (!ACCEPTED.includes(ext)) throw new Error(`סוג קובץ לא נתמך: ${ext}`);
  const known = courseId && courseId !== 'auto' && getCourse(courseId);
  const id = newLectureId(known ? courseId : 'new');
  const dir = lectureDir(id);
  await fsp.mkdir(dir, { recursive: true });
  const stored = path.join(dir, `original${ext}`);
  if (move) await fsp.rename(filePath, stored).catch(async () => { await fsp.copyFile(filePath, stored); await fsp.unlink(filePath); });
  else await fsp.copyFile(filePath, stored);

  const unit = Number(unitNumber) || numberFromName(originalName);
  const meta = {
    id,
    courseId: known ? courseId : null,
    autoCourse: !known,
    title: title || prettyName(originalName),
    originalName,
    kind: KINDS.includes(kind) ? kind : detectKind(originalName, source?.module),
    originalFile: `original${ext}`,
    lessonNumber: Number(lessonNumber) || null,
    unitNumber: unit || null,
    slideCount: 0,
    hasPdf: false,
    status: 'processing',
    stage: 'queued',
    error: null,
    createdAt: new Date().toISOString(),
    ...(source ? { source } : {}),
  };
  await saveLecture(meta);
  enqueue(id, content ? { content } : {});
  return meta;
}

/**
 * An exam-prep unit: a lesson from an earlier semester, as text only (slide text and the lesson's transcript, e.g.
 * from the course's NotebookLM). It gets the same study material as a lecture but no deck, and doesn't count as
 * this semester's lesson. The transcript stays on this Mac (transcript.txt, not in git).
 */
export async function addPrepItem({ courseId, lesson, semester, slidesText, transcript = '' }) {
  const course = getCourse(courseId);
  if (!course) throw new Error('קורס לא קיים');
  const n = Number(lesson);
  if (!Number.isInteger(n) || n < 1 || n > 40) throw new Error('מספר שיעור לא תקין');
  if (!String(slidesText || '').trim()) throw new Error('אין טקסט של שקפים');
  const old = listLectures(courseId).find((l) => l.kind === 'prep' && l.lessonNumber === n);
  const id = old?.id || newLectureId(courseId);
  await fsp.mkdir(lectureDir(id), { recursive: true });
  // Slide text in pieces of about one slide's worth, so topics and notes can point at parts of it.
  const parts = String(slidesText).split(/\n{2,}/).reduce((acc, p) => {
    if (acc.length && acc[acc.length - 1].length + p.length < 1200) acc[acc.length - 1] += `\n\n${p}`;
    else acc.push(p);
    return acc;
  }, []).map((t) => t.trim()).filter(Boolean);
  await saveSlides(id, parts.map((text, i) => ({ n: i + 1, text })));
  if (transcript) await fsp.writeFile(path.join(lectureDir(id), 'transcript.txt'), String(transcript));
  const meta = {
    ...(old || {}),
    id,
    courseId,
    autoCourse: false,
    title: old?.title || `שיעור ${n}`,
    originalName: `שיעור ${n} – ${semester}`,
    kind: 'prep',
    originalFile: null,
    lessonNumber: n,
    unitNumber: n,
    slideCount: 0,
    hasPdf: false,
    status: 'processing',
    stage: 'queued',
    error: null,
    createdAt: old?.createdAt || new Date().toISOString(),
    source: { type: 'prep', semester, lesson: n },
  };
  await saveLecture(meta);
  enqueue(id, { regenerate: true });
  return meta;
}

/** The deck as one PDF, for a model that reads PDFs itself (Gemini); null otherwise or when there is none. */
function deckPdf(meta) {
  if (aiStatus().provider !== 'gemini' || !meta.originalFile) return null;
  const dir = lectureDir(meta.id);
  return [path.join(dir, 'slides.pdf'), path.join(dir, 'deck.pdf'), /\.pdf$/i.test(meta.originalFile) ? path.join(dir, meta.originalFile) : null]
    .find((f) => f && fs.existsSync(f)) || null;
}

const AUTO_RETRIES = 3; // automatic retries per item before it waits for a manual one

/**
 * "Try again" for everything that came in without AI material (usage limit, expired sign-in, a rejected output).
 * auto: the AI watch (health.js) calling once Claude answers again – each item at most AUTO_RETRIES times, and only
 * while nothing else is being processed. Returns how many were queued.
 */
export async function retryFailedAI({ auto = false } = {}) {
  if (auto && (running || queue.length)) return 0;
  let n = 0;
  for (const l of listLectures()) {
    if (l.status !== 'ready' || l.noAi || (!l.aiError && !l.notesError)) continue;
    if (auto && (l.aiRetries || 0) >= AUTO_RETRIES) continue;
    const tries = auto ? (l.aiRetries || 0) + 1 : 0;
    if (l.aiError) {
      await patchLecture(l.id, { status: 'processing', stage: 'queued', aiRetries: tries });
      enqueue(l.id, { aiOnly: true });
    } else {
      await patchLecture(l.id, { notesStatus: 'queued', notesError: null, aiRetries: tries });
      enqueue(l.id, { notesOnly: true });
    }
    n++;
  }
  return n;
}

export function enqueue(id, opts = {}) {
  queue.push({ id, opts });
  return pump();
}

export function queueState() {
  return { running, pending: queue.map((j) => j.id) };
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const { id, opts } = queue.shift();
    try {
      await processLecture(id, opts);
    } catch (e) {
      console.error(`[ingest] ${id} failed:`, e);
      await patchLecture(id, { status: 'error', error: e.message });
    }
  }
  running = false;
}

async function stage(id, s) {
  console.log(`[ingest] ${id} → ${s}`);
  return patchLecture(id, { stage: s, status: s === 'ready' ? 'ready' : 'processing', error: null });
}

export async function processLecture(id, { aiOnly = false, content = null, regenerate = false, notesOnly = false } = {}) {
  let meta = getLecture(id);
  if (!meta) return;
  if (notesOnly) return generateNotes(id);
  const dir = lectureDir(id);
  const original = path.join(dir, meta.originalFile || '');
  const pdf = path.join(dir, 'slides.pdf');

  // Exam-prep units have no deck: their slide text was saved by addPrepItem.
  if (!aiOnly && meta.kind !== 'prep') {
    await stage(id, 'converting');
    const hasPdf = await convertToPdf(original, pdf);
    // The cloud shows slides from this PDF. For a PDF original the original itself is used.
    if (hasPdf && path.extname(original).toLowerCase() !== '.pdf') await fsp.copyFile(pdf, path.join(dir, 'deck.pdf'));

    await stage(id, 'rendering');
    const count = hasPdf ? await renderSlides(pdf, path.join(dir, 'slides')) : 0;
    // A deck whose PDF is too big for one cloud asset keeps its slide images in git instead (fallback/).
    if (count && fs.statSync(pdf).size > 24 * 1024 * 1024) {
      await fsp.rm(path.join(dir, 'fallback'), { recursive: true, force: true });
      await fsp.cp(path.join(dir, 'slides'), path.join(dir, 'fallback'), { recursive: true });
    }

    await stage(id, 'extracting');
    const texts = await extractSlidesText(original, hasPdf ? pdf : null);
    await saveSlides(id, texts.map((text, i) => ({ n: i + 1, text })));
    meta = await patchLecture(id, { hasPdf, slideCount: count || texts.length });
  }

  const slides = getSlides(id).map((s) => s.text);

  // Course detection: keywords first, AI only when the keywords are not decisive.
  if (!meta.courseId) {
    await stage(id, 'classifying');
    const guess = guessCourse(meta.originalName, slides.join('\n'));
    let courseId = guess.score >= 6 && guess.margin >= 4 ? guess.courseId : null;
    if (!courseId && aiStatus().ready) {
      const res = await generateJSON({
        system: 'You classify university lecture files into courses. Answer only with the requested JSON.',
        prompt: classifyPrompt({ courses: listCourses(), fileName: meta.originalName, sample: slides.slice(0, 6).join('\n').slice(0, 4000) }),
        schema: CLASSIFY_SCHEMA,
        effort: 'low',
        maxTokens: 2000,
      }).catch(() => null);
      if (res && getCourse(res.courseId)) courseId = res.courseId;
    }
    courseId = courseId || guess.courseId;
    meta = await patchLecture(id, { courseId });
  }

  const course = getCourse(meta.courseId);

  // Re-processing slides keeps existing study content; only "regenerate" (aiOnly) rewrites it.
  const existing = getContent(id);
  if (content) {
    await saveContent(id, content);
  } else if (existing && !aiOnly && !regenerate) {
    content = existing;
  } else if (!meta.noAi && meta.kind !== 'exam' && slides.join('').trim().length < MIN_TEXT) {
    // A scanned file (no text layer): there's nothing for the model to read, so it goes up as is – no AI, no error.
    await patchLecture(id, { noAi: true, noAiReason: 'scanned', aiError: null });
  } else if (aiStatus().ready && course?.ai !== false && meta.kind !== 'exam' && !meta.noAi && slides.some((s) => s.trim())) {
    // Courses built for other students (course.ai === false) get slides and files only – no AI material.
    await stage(id, 'analyzing');
    const trigger = meta.kind === 'prep' ? 'import' : aiOnly || regenerate ? 'retry' : meta.source?.fileKey || meta.source?.moodleId ? 'moodle' : 'upload';
    const run = startRun('lecture', { trigger, input: { lectureId: id, course: course.short, kind: meta.kind || 'lecture', file: meta.originalName, slides: slides.length } });
    let checks = [];
    try {
      const transcriptFile = path.join(dir, 'transcript.txt');
      // Gemini reads the deck's PDF itself (images of the pages too) and writes the full question bank at once.
      const deck = deckPdf(meta);
      const raw = await generateJSON({
        system: lectureSystem(course),
        prompt: (meta.kind === 'prep'
          ? prepPrompt({ course, lesson: meta.lessonNumber, semester: meta.source?.semester || 'סמסטר קודם', slides, transcript: fs.existsSync(transcriptFile) ? fs.readFileSync(transcriptFile, 'utf8').slice(0, 90000) : '' })
          : lecturePrompt({ course, kind: meta.kind || 'lecture', fileName: meta.originalName, slides, hint: [meta.lessonNumber ? `מספר ${meta.lessonNumber}` : '', meta.source?.note ? `הנחיה מהמודל: ${meta.source.note}` : ''].filter(Boolean).join('. ') }))
          + (deck ? DECK_PDF_RULES + DECK_PDF_QUIZ : ''),
        schema: LECTURE_SCHEMA,
        effort: 'high',
        maxTokens: deck ? 65536 : 48000,
        files: deck ? [deck] : [],
        cache: !aiOnly && !regenerate,
      });
      // Fixed checks on the model's output before anything is saved (checks.js).
      const checked = checkLecture(raw, { slideCount: slides.length, slides });
      checks = assertUsable(checked.checks);
      content = checked.value;
      await saveContent(id, { ...content, generatedAt: new Date().toISOString(), generator: aiStatus().provider });
      await patchLecture(id, { aiError: null, aiRetries: 0, checks: { at: new Date().toISOString(), found: checks.length } });
      run.ok({ title: content.title, summaryChars: content.summary.length, quiz: content.quiz.length, flashcards: content.flashcards.length, glossary: content.glossary.length, topics: content.topics.length }, checks);
      await generateNotes(id);
    } catch (e) {
      // Keep the lecture usable (slides, text, chat); study material can be generated later from the lecture menu.
      console.error(`[ingest] ${id} AI analysis failed:`, e.message.slice(0, 200));
      run.fail(e, e instanceof CheckError ? e.checks : checks);
      content = null;
      const limit = /429|usage_limit/.test(e.message);
      const signedOut = /authenticate|login|OAuth/i.test(e.message);
      await patchLecture(id, { aiError: limit ? limitText() : signedOut ? signedOutText() : e instanceof CheckError ? 'הפלט של ה AI לא עבר את הבדיקות – נסו "יצירת סיכום מחדש"' : 'יצירת הסיכום נכשלה' });
      adminAlert(limit ? `${limitText()} – חומר חדש נכנס בינתיים בלי סיכום` : signedOut ? `${signedOutText()} – חומר חדש נכנס בלי סיכום` : 'יצירת סיכום נכשלה');
    }
  }

  // Fill in lesson numbering from the content when the user did not set it.
  const patch = {};
  if (content?.title && meta.kind === 'prep') patch.title = content.title;
  else if (content?.title && meta.title === prettyName(meta.originalName)) patch.title = (meta.kind || 'lecture') === 'homework' ? homeworkTitle(meta, content.title) : content.title;
  if (!meta.lessonNumber) {
    const unit = meta.unitNumber || content?.lessonNumber || 0;
    const kind = meta.kind || 'lecture';
    const mapped = kind === 'lecture' && course.unitToLesson && unit ? course.unitToLesson[unit] : 0;
    patch.lessonNumber = mapped || unit || nextLessonNumber(course.id, kind);
  }
  await patchLecture(id, patch);
  await stage(id, 'ready');
  await announceMaterial(getLecture(id)).catch((e) => console.error('[updates]', e.message));
  // A big question bank from the lesson's own slides (practice.js), on its own worker once the lesson is up.
  if (content) queueBank(id);
}

// What to tell the owner when the AI stops, by provider (the material may be on Gemini or on Claude).
const onGemini = () => aiStatus().provider === 'gemini';
export const limitText = () => (onGemini()
  ? 'נוצלה המכסה היומית של Gemini – הסיכום ייכתב לבד כשהיא מתאפסת (10:00 בבוקר)'
  : 'הגעת למגבלת השימוש ב-Claude – הסיכום ייכתב לבד כשהיא מתאפסת');
const signedOutText = () => (onGemini() ? 'המפתח של Gemini חסר או נדחה (GEMINI_API_KEY ב-.env)' : 'החיבור ל-Claude במחשב פג – צריך להתחבר מחדש (claude, ואז /login)');

/**
 * Structured study notes (sections of definition / example / rule blocks) for lectures and tutorials.
 * Runs as a separate AI call so a failure never costs the rest of the study material.
 * Homework keeps its exercise-by-exercise markdown summary.
 */
export async function generateNotes(id) {
  const meta = getLecture(id);
  const content = getContent(id);
  if (!meta || !content || meta.noAi || (meta.kind || 'lecture') === 'homework' || !aiStatus().ready) return null;
  if (getCourse(meta.courseId)?.ai === false) return null;
  const slides = getSlides(id).map((s) => s.text);
  if (!slides.some((s) => s.trim())) return null;
  const course = getCourse(meta.courseId);
  await patchLecture(id, { notesStatus: 'writing' });
  console.log(`[ingest] ${id} → notes`);
  const run = startRun('notes', { trigger: 'after-lecture', input: { lectureId: id, course: course.short, slides: slides.length, summaryChars: content.summary?.length || 0 } });
  try {
    const deck = deckPdf(meta);
    const raw = await generateJSON({
      system: lectureSystem(course),
      prompt: notesPrompt({ course, kind: meta.kind || 'lecture', fileName: meta.originalName, slides, summary: content.summary }) + (deck ? DECK_PDF_RULES : ''),
      schema: NOTES_SCHEMA,
      effort: 'high',
      files: deck ? [deck] : [],
    });
    const checked = checkNotes(raw, { slideCount: slides.length });
    const checks = assertUsable(checked.checks);
    const notes = checked.value;
    await saveContent(id, { ...getContent(id), notes: { ...notes, generatedAt: new Date().toISOString() } });
    await patchLecture(id, { notesStatus: null, notesError: null });
    run.ok({ sections: notes.sections.length, blocks: notes.sections.reduce((s, x) => s + x.blocks.length, 0) }, checks);
    return notes;
  } catch (e) {
    console.error(`[ingest] ${id} notes failed:`, e.message.slice(0, 200));
    run.fail(e, e instanceof CheckError ? e.checks : []);
    await patchLecture(id, { notesStatus: null, notesError: /429|usage_limit/.test(e.message) ? limitText() : 'כתיבת הסיכום נכשלה' });
    return null;
  }
}

/** Titles describe the material, not that it comes with solutions: "(פתרון מלא)", "– פתרונות מלאים" etc. are dropped. */
export function cleanTitle(title = '') {
  return title
    .replace(/\s*\((?:עם\s+)?פתרו(?:ן|נות|נים)(?:\s+מלא(?:ים|ה)?)?\)/g, '')
    .replace(/\s*[–-]\s*(?:עם\s+)?פתרו(?:ן|נות|נים)(?:\s+מלא(?:ים|ה)?)?\s*$/g, '')
    .replace(/\s+עם\s+פתרו(?:ן|נות|נים)(?:\s+מלא(?:ים|ה)?)?(?=\s*[–-]|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** A file that is itself the solutions gets a distinct title, so it doesn't look like a duplicate of the sheet. */
function homeworkTitle(meta, title) {
  const clean = cleanTitle(title);
  if (!/solution|פתרונ/i.test(meta.originalName || '')) return clean;
  const twin = listLectures(meta.courseId).some((l) => l.id !== meta.id && l.title === clean);
  return twin ? `פתרונות – ${clean.replace(/^חוברת תרגילים\s*[–-]\s*/, '')}` : clean;
}

function nextLessonNumber(courseId, kind = 'lecture') {
  const dirs = fs.readdirSync(path.dirname(lectureDir('x')));
  let max = 0;
  for (const d of dirs) {
    const m = getLecture(d);
    if (m && m.courseId === courseId && (m.kind || 'lecture') === kind && m.lessonNumber) max = Math.max(max, m.lessonNumber);
  }
  return max + 1;
}

// Resume anything that was mid-processing when the server stopped.
export function resumePending() {
  const dirs = fs.existsSync(path.dirname(lectureDir('x'))) ? fs.readdirSync(path.dirname(lectureDir('x'))) : [];
  for (const d of dirs) {
    const m = getLecture(d);
    if (m && m.status === 'processing') enqueue(m.id);
  }
}

// ---------- inbox folder ----------
// Drop files into inbox/ (auto-detect course) or inbox/<courseId>/ (e.g. inbox/acc/).
export function watchInbox() {
  const doneDir = path.join(INBOX_DIR, 'נקלטו');
  fs.mkdirSync(doneDir, { recursive: true });
  for (const c of listCourses()) fs.mkdirSync(path.join(INBOX_DIR, c.id), { recursive: true });

  const watcher = chokidar.watch(INBOX_DIR, {
    ignoreInitial: false,
    depth: 1,
    ignored: (p) => p.startsWith(doneDir) || path.basename(p).startsWith('.'),
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 },
  });
  watcher.on('add', async (file) => {
    const ext = path.extname(file).toLowerCase();
    if (!ACCEPTED.includes(ext)) return;
    const rel = path.relative(INBOX_DIR, file).split(path.sep);
    const courseId = rel.length > 1 && getCourse(rel[0]) ? rel[0] : 'auto';
    const name = path.basename(file);
    try {
      await addLectureFile({ filePath: file, originalName: name, courseId });
      await fsp.rename(file, path.join(doneDir, `${Date.now()}-${name}`));
      console.log(`[inbox] imported ${name} → ${courseId}`);
    } catch (e) {
      console.error(`[inbox] ${name}:`, e.message);
    }
  });
  return watcher;
}
