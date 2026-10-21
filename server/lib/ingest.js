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
import { LECTURE_SCHEMA, CLASSIFY_SCHEMA, NOTES_SCHEMA, lectureSystem, lecturePrompt, prepPrompt, classifyPrompt, notesPrompt } from './prompts.js';

import { ACCEPTED, EXAM_RE, detectKind } from '../../shared/moodle-kind.js';

export { ACCEPTED, EXAM_RE, detectKind };

// Processing stages shown in the UI, in order.
export const STAGES = ['queued', 'converting', 'rendering', 'extracting', 'classifying', 'analyzing', 'ready'];

const queue = [];
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
  } else if (aiStatus().ready && course?.ai !== false && meta.kind !== 'exam' && slides.some((s) => s.trim())) {
    // Courses built for other students (course.ai === false) get slides and files only – no AI material.
    await stage(id, 'analyzing');
    try {
      const transcriptFile = path.join(dir, 'transcript.txt');
      content = await generateJSON({
        system: lectureSystem(course),
        prompt: meta.kind === 'prep'
          ? prepPrompt({ course, lesson: meta.lessonNumber, semester: meta.source?.semester || 'סמסטר קודם', slides, transcript: fs.existsSync(transcriptFile) ? fs.readFileSync(transcriptFile, 'utf8').slice(0, 90000) : '' })
          : lecturePrompt({ course, kind: meta.kind || 'lecture', fileName: meta.originalName, slides, hint: [meta.lessonNumber ? `מספר ${meta.lessonNumber}` : '', meta.source?.note ? `הנחיה מהמודל: ${meta.source.note}` : ''].filter(Boolean).join('. ') }),
        schema: LECTURE_SCHEMA,
        effort: 'high',
      });
      await saveContent(id, { ...content, generatedAt: new Date().toISOString(), generator: aiStatus().provider });
      await patchLecture(id, { aiError: null });
      await generateNotes(id);
    } catch (e) {
      // Keep the lecture usable (slides, text, chat); study material can be generated later from the lecture menu.
      console.error(`[ingest] ${id} AI analysis failed:`, e.message.slice(0, 200));
      content = null;
      await patchLecture(id, { aiError: /429|usage_limit/.test(e.message) ? 'הגעת למגבלת השימוש ב-Claude – נסו "יצירת סיכום מחדש" מאוחר יותר' : 'יצירת הסיכום נכשלה' });
      adminAlert(/429|usage_limit/.test(e.message) ? 'הגעת למגבלת השימוש ב-Claude – חומר חדש נכנס בלי סיכום' : 'יצירת סיכום נכשלה');
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
}

/**
 * Structured study notes (sections of definition / example / rule blocks) for lectures and tutorials.
 * Runs as a separate AI call so a failure never costs the rest of the study material.
 * Homework keeps its exercise-by-exercise markdown summary.
 */
export async function generateNotes(id) {
  const meta = getLecture(id);
  const content = getContent(id);
  if (!meta || !content || (meta.kind || 'lecture') === 'homework' || !aiStatus().ready) return null;
  if (getCourse(meta.courseId)?.ai === false) return null;
  const slides = getSlides(id).map((s) => s.text);
  if (!slides.some((s) => s.trim())) return null;
  const course = getCourse(meta.courseId);
  await patchLecture(id, { notesStatus: 'writing' });
  console.log(`[ingest] ${id} → notes`);
  try {
    const notes = await generateJSON({
      system: lectureSystem(course),
      prompt: notesPrompt({ course, kind: meta.kind || 'lecture', fileName: meta.originalName, slides, summary: content.summary }),
      schema: NOTES_SCHEMA,
      effort: 'high',
    });
    await saveContent(id, { ...getContent(id), notes: { ...notes, generatedAt: new Date().toISOString() } });
    await patchLecture(id, { notesStatus: null, notesError: null });
    return notes;
  } catch (e) {
    console.error(`[ingest] ${id} notes failed:`, e.message.slice(0, 200));
    await patchLecture(id, { notesStatus: null, notesError: /429|usage_limit/.test(e.message) ? 'הגעת למגבלת השימוש ב-Claude – נסו שוב מאוחר יותר' : 'כתיבת הסיכום נכשלה' });
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
