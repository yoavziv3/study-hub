import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import {
  ROOT, listCourses, getCourse, listLectures, getLecture, patchLecture, getContent, saveContent, getSlides,
  deleteLecture, lectureDir, getProgress, saveProgress, LECTURES_DIR,
} from './lib/store.js';
import { addLectureFile, enqueue, queueState, resumePending, watchInbox, ACCEPTED } from './lib/ingest.js';
import { aiStatus, chatStream, generateJSON } from './lib/ai.js';
import { chatSystem, practicePrompt, PRACTICE_SCHEMA } from './lib/prompts.js';
import { toolsStatus } from './lib/extract.js';
import * as moodle from './lib/moodle.js';
import { initPublish } from './lib/publish.js';

const PORT = Number(process.env.PORT) || 5180;
const app = express();
app.use(express.json({ limit: '4mb' }));

const upload = multer({ dest: path.join(os.tmpdir(), 'study-uploads'), limits: { fileSize: 300 * 1024 * 1024 } });

// Light list view of a lecture (no slide text / AI content).
function lectureCard(m) {
  const c = getContent(m.id);
  return {
    ...m,
    overview: c?.overview || '',
    topicCount: c?.topics?.length || 0,
    quizCount: c?.quiz?.length || 0,
    flashcardCount: c?.flashcards?.length || 0,
    hasContent: !!c,
  };
}

// ---------- status ----------
app.get('/api/status', async (_req, res) => {
  res.json({ ai: aiStatus(), tools: await toolsStatus(), queue: queueState(), accepted: ACCEPTED });
});

// ---------- courses ----------
app.get('/api/courses', (_req, res) => {
  const lectures = listLectures();
  res.json(
    listCourses().map((c) => {
      const ls = lectures.filter((l) => l.courseId === c.id);
      return { ...c, lectureCount: ls.length, slideCount: ls.reduce((s, l) => s + (l.slideCount || 0), 0), processing: ls.filter((l) => l.status === 'processing').length };
    })
  );
});

app.get('/api/courses/:id', (req, res) => {
  const course = getCourse(req.params.id);
  if (!course) return res.status(404).json({ error: 'קורס לא נמצא' });
  res.json({ ...course, lectures: listLectures(course.id).map(lectureCard) });
});

// Everything a course needs for its glossary / exam / flashcards views.
app.get('/api/courses/:id/bundle', (req, res) => {
  const course = getCourse(req.params.id);
  if (!course) return res.status(404).json({ error: 'קורס לא נמצא' });
  const lectures = listLectures(course.id).map((m) => ({ ...m, content: getContent(m.id) }));
  res.json({ ...course, lectures });
});

// ---------- lectures ----------
app.get('/api/lectures', (_req, res) => res.json(listLectures().map(lectureCard)));

app.get('/api/lectures/:id', (req, res) => {
  const meta = getLecture(req.params.id);
  if (!meta) return res.status(404).json({ error: 'הרצאה לא נמצאה' });
  res.json({ ...meta, content: getContent(meta.id), slides: getSlides(meta.id), course: getCourse(meta.courseId) });
});

app.patch('/api/lectures/:id', async (req, res) => {
  const allowed = ['title', 'lessonNumber', 'courseId', 'unitNumber'];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (patch.courseId && !getCourse(patch.courseId)) return res.status(400).json({ error: 'קורס לא קיים' });
  const meta = await patchLecture(req.params.id, patch);
  if (!meta) return res.status(404).json({ error: 'הרצאה לא נמצאה' });
  res.json(meta);
});

app.delete('/api/lectures/:id', async (req, res) => {
  if (!getLecture(req.params.id)) return res.status(404).json({ error: 'הרצאה לא נמצאה' });
  await deleteLecture(req.params.id);
  res.json({ ok: true });
});

app.post('/api/lectures/:id/regenerate', async (req, res) => {
  const meta = getLecture(req.params.id);
  if (!meta) return res.status(404).json({ error: 'הרצאה לא נמצאה' });
  if (!aiStatus().ready) return res.status(400).json({ error: 'אין חיבור ל-AI' });
  await patchLecture(meta.id, { status: 'processing', stage: 'queued' });
  enqueue(meta.id, { aiOnly: true });
  res.json({ ok: true });
});

// ---------- upload ----------
app.post('/api/upload', upload.array('files', 30), async (req, res) => {
  const { courseId = 'auto', lessonNumber } = req.body;
  const created = [];
  const errors = [];
  for (const f of req.files || []) {
    // multer decodes multipart filenames as latin1; restore UTF-8 (Hebrew names).
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    try {
      created.push(await addLectureFile({ filePath: f.path, originalName: name, courseId, lessonNumber, move: true }));
    } catch (e) {
      errors.push({ name, error: e.message });
      fs.rm(f.path, { force: true }, () => {});
    }
  }
  res.json({ created, errors });
});

// ---------- practice generation ----------
app.post('/api/practice', async (req, res) => {
  const { lectureId, courseId, count = 6, difficulty = 'mixed' } = req.body;
  try {
    let course, title, material, avoid;
    if (lectureId) {
      const meta = getLecture(lectureId);
      course = getCourse(meta.courseId);
      const content = getContent(lectureId);
      title = meta.title;
      material = getSlides(lectureId).map((s) => `[שקף ${s.n}] ${s.text}`).join('\n');
      avoid = [...(content?.quiz || []), ...(content?.extraQuiz || [])].map((q) => q.question);
    } else {
      course = getCourse(courseId);
      const ls = listLectures(courseId).filter((l) => l.status === 'ready');
      title = `כל הקורס ${course.short}`;
      material = ls.map((l) => `## ${l.title}\n${getContent(l.id)?.summary || ''}`).join('\n\n');
      avoid = [];
    }
    const out = await generateJSON({
      system: `אתה כותב שאלות מבחן מקצועי בקורס ${course.name}. הקפד על נכונות מלאה של התשובה המסומנת.`,
      prompt: practicePrompt({ course, title, material: material.slice(0, 180000), count, difficulty, avoid: avoid.slice(0, 60) }),
      schema: PRACTICE_SCHEMA,
      effort: 'medium',
      maxTokens: 16000,
    });
    const quiz = out.quiz.map((q) => ({ ...q, generated: true }));
    if (lectureId) {
      const content = getContent(lectureId) || {};
      await saveContent(lectureId, { ...content, extraQuiz: [...(content.extraQuiz || []), ...quiz] });
    }
    res.json({ quiz });
  } catch (e) {
    console.error('[practice]', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- search ----------
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  const results = [];
  const snippet = (text) => {
    const i = text.toLowerCase().indexOf(q);
    const start = Math.max(0, i - 50);
    return (start ? '…' : '') + text.slice(start, i + q.length + 70).replace(/\s+/g, ' ') + '…';
  };
  for (const m of listLectures()) {
    const course = getCourse(m.courseId);
    const content = getContent(m.id);
    const base = { lectureId: m.id, lectureTitle: m.title, courseId: m.courseId, courseShort: course?.short, color: course?.color };
    if (m.title.toLowerCase().includes(q)) results.push({ ...base, type: 'lecture', title: m.title, score: 10 });
    for (const t of content?.topics || []) {
      if ((t.title + t.summary).toLowerCase().includes(q)) results.push({ ...base, type: 'topic', title: t.title, slide: t.slideStart, snippet: snippet(t.summary), score: 8 });
    }
    for (const g of content?.glossary || []) {
      if ((g.term + ' ' + g.definition).toLowerCase().includes(q)) results.push({ ...base, type: 'term', title: g.term, snippet: g.definition, score: g.term.toLowerCase().includes(q) ? 9 : 5 });
    }
    for (const s of getSlides(m.id)) {
      if (s.text.toLowerCase().includes(q)) results.push({ ...base, type: 'slide', title: `שקף ${s.n}`, slide: s.n, snippet: snippet(s.text), score: 3 });
    }
  }
  results.sort((a, b) => b.score - a.score);
  res.json(results.slice(0, 40));
});

// ---------- chat ----------
const CONTEXT_LIMIT = 400000; // characters

function slidesBlock(m) {
  return getSlides(m.id).map((s) => `[שקף ${s.n}] ${s.text}`).join('\n');
}

function buildContext({ courseId, lectureId, slide }) {
  if (lectureId) {
    const m = getLecture(lectureId);
    const course = getCourse(m.courseId);
    const content = getContent(m.id);
    const others = listLectures(m.courseId).filter((l) => l.id !== m.id);
    let ctx = `# קורס: ${course.name}\n# ההרצאה הנוכחית: ${m.title} (${course.unitLabel} ${m.unitNumber || m.lessonNumber || ''})\n\n## שקפי ההרצאה\n${slidesBlock(m)}`;
    if (content?.summary) ctx += `\n\n## סיכום ההרצאה\n${content.summary}`;
    for (const o of others) {
      const oc = getContent(o.id);
      if (ctx.length > CONTEXT_LIMIT) break;
      ctx += `\n\n## הרצאה אחרת בקורס: ${o.title}\n${oc?.summary || slidesBlock(o)}`;
    }
    const scope = `הסטודנט לומד עכשיו את ההרצאה "${m.title}" בקורס ${course.short}${slide ? ` ומסתכל על שקף ${slide}` : ''}. "השקף הזה" = שקף ${slide || '?'}.`;
    return { scope, context: ctx.slice(0, CONTEXT_LIMIT) };
  }
  if (courseId) {
    const course = getCourse(courseId);
    let ctx = `# קורס: ${course.name} (${course.code})\nסגל: ${course.staff.join(', ') || '—'}\n`;
    for (const l of listLectures(courseId)) {
      ctx += `\n\n## ${course.unitLabel} ${l.unitNumber || l.lessonNumber || ''}: ${l.title} (מזהה ${l.id})\n${slidesBlock(l)}`;
    }
    return { scope: `הסטודנט נמצא בעמוד הקורס ${course.name}.`, context: ctx.slice(0, CONTEXT_LIMIT) };
  }
  let ctx = '';
  for (const c of listCourses()) {
    ctx += `\n\n# קורס: ${c.name} (${c.code})`;
    for (const l of listLectures(c.id)) ctx += `\n\n## ${l.title}\n${getContent(l.id)?.summary || slidesBlock(l).slice(0, 8000)}`;
  }
  return { scope: 'הסטודנט נמצא בדף הבית של האתר ויכול לשאול על כל אחד מהקורסים בסמסטר.', context: ctx.slice(0, CONTEXT_LIMIT) };
}

app.post('/api/chat', async (req, res) => {
  const { messages = [], courseId, lectureId, slide } = req.body;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  try {
    const { scope, context } = buildContext({ courseId, lectureId, slide });
    await chatStream({
      system: chatSystem({ scope, context }),
      messages: messages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
      onText: (t) => send({ t }),
      signal: ac.signal,
    });
    send({ done: true });
  } catch (e) {
    if (!ac.signal.aborted) {
      console.error('[chat]', e.message);
      send({ error: e.message });
    }
  }
  res.end();
});

// ---------- Moodle ----------
const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    console.error('[moodle]', e.message);
    res.status(400).json({ error: e.message });
  }
};
app.get('/api/moodle', (_req, res) => res.json(moodle.moodleStatus()));
app.post('/api/moodle/connect', wrap((req) => moodle.connect(req.body)));
app.post('/api/moodle/disconnect', wrap(() => moodle.disconnect()));
app.post('/api/moodle/refresh', wrap(async () => { await moodle.refreshCourses(); return moodle.moodleStatus(); }));
app.put('/api/moodle/map', wrap((req) => moodle.mapCourse(req.body.moodleId, req.body.siteCourseId)));
app.put('/api/moodle/options', wrap((req) => moodle.setOptions(req.body)));
app.post('/api/moodle/sync', wrap(async () => ({ result: await moodle.sync(), status: moodle.moodleStatus() })));
app.get('/api/moodle/courses/:id/files', wrap((req) => moodle.courseFiles(req.params.id)));
app.post('/api/moodle/import', wrap(async (req) => ({ result: await moodle.importOne(req.body.moodleId, req.body.key) })));
app.post('/api/moodle/ignore', wrap(async (req) => { await moodle.ignoreOne(req.body.key); return { ok: true }; }));

// ---------- progress ----------
app.get('/api/progress', (_req, res) => res.json(getProgress()));
app.put('/api/progress', async (req, res) => {
  await saveProgress(req.body || {});
  res.json({ ok: true });
});

// ---------- files & client ----------
app.use('/files', express.static(LECTURES_DIR, { maxAge: '1h' }));

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/files).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  const ai = aiStatus();
  console.log(`\n  📚 Study Hub פועל: http://localhost:${PORT}`);
  console.log(`  AI: ${ai.provider} (${ai.model})`);
  console.log(`  תיקיית קליטה: ${path.join(ROOT, 'inbox')}\n`);
  initPublish({ rootDir: ROOT, processing: () => queueState().running || listLectures().some((l) => l.status === 'processing') });
  resumePending();
  if (process.env.NO_INBOX !== '1') watchInbox();
  moodle.startMoodle();
});
