import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import {
  ROOT, listCourses, getCourse, listLectures, getLecture, patchLecture, getContent, saveContent, getSlides,
  deleteLecture, lectureDir, getProgress, saveProgress, LECTURES_DIR, getPractice, savePractice, getLinks,
} from './lib/store.js';
import { addLectureFile, enqueue, queueState, resumePending, watchInbox, ACCEPTED, KINDS } from './lib/ingest.js';
import { aiStatus, chatStream, generateJSON } from './lib/ai.js';
import { lectureSystem, chatSystem, practicePrompt, PRACTICE_SCHEMA, homeworkPracticePrompt, HOMEWORK_PRACTICE_SCHEMA } from './lib/prompts.js';
import { toolsStatus } from './lib/extract.js';
import * as moodle from './lib/moodle.js';
import { backupNow, backupStatus, startBackups } from './lib/backup.js';
import { initPublish } from './lib/publish.js';
import * as updates from './lib/updates.js';

const PORT = Number(process.env.PORT) || 5180;
// This server holds your Moodle connection, your grades and your Claude login: it only listens on this Mac
// (set HOST=0.0.0.0 to open it to the network on purpose).
const HOST = process.env.HOST || '127.0.0.1';
const app = express();

// Only this Mac's own browser may use the server: requests must be addressed to localhost (stops DNS
// rebinding), and other websites open in the browser can't make it change anything (stops cross-site requests).
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
app.use((req, res, next) => {
  if (HOST === '127.0.0.1' && !LOCAL_HOST.test(req.headers.host || '')) return res.status(403).send('Forbidden');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin))) {
      return res.status(403).json({ error: 'בקשה ממקור לא מורשה' });
    }
  }
  next();
});
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
      const of = (k) => ls.filter((l) => (l.kind || 'lecture') === k).length;
      return {
        ...c,
        lectureCount: of('lecture'),
        tutorialCount: of('tutorial'),
        homeworkCount: of('homework'),
        slideCount: ls.reduce((s, l) => s + (l.slideCount || 0), 0),
        processing: ls.filter((l) => l.status === 'processing').length,
      };
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
  res.json({ ...course, lectures, practice: getPractice(course.id) });
});

// ---------- lectures ----------
app.get('/api/lectures', (_req, res) => res.json(listLectures().map(lectureCard)));

app.get('/api/lectures/:id', (req, res) => {
  const meta = getLecture(req.params.id);
  if (!meta) return res.status(404).json({ error: 'הרצאה לא נמצאה' });
  res.json({ ...meta, content: getContent(meta.id), slides: getSlides(meta.id), course: getCourse(meta.courseId) });
});

app.patch('/api/lectures/:id', async (req, res) => {
  const allowed = ['title', 'lessonNumber', 'courseId', 'unitNumber', 'kind'];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (patch.courseId && !getCourse(patch.courseId)) return res.status(400).json({ error: 'קורס לא קיים' });
  if (patch.kind && !KINDS.includes(patch.kind)) return res.status(400).json({ error: 'סוג לא תקין' });
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

app.get('/api/courses/:id/links', (req, res) => res.json(getLinks(req.params.id)));

// ---------- "report a mistake" ----------
// Reports made on this Mac are kept locally; reports from students arrive through the cloud's admin channel.
const REPORTS_FILE = path.join(ROOT, 'data', 'reports.json');
const readReports = () => { try { return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8')); } catch { return []; } };
app.post('/api/reports', (req, res) => {
  const { lectureId = '', section = '', text = '' } = req.body || {};
  if (!getLecture(lectureId) || String(text).trim().length < 3) return res.status(400).json({ error: 'כתבו בקצרה מה לא נכון' });
  const list = readReports();
  list.push({ id: Date.now(), lecture_id: lectureId, section: String(section).slice(0, 200), text: String(text).trim().slice(0, 1000), created_at: Date.now(), status: 'open' });
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(list, null, 2));
  res.json({ ok: true });
});
app.post('/api/feedback', (req, res) => {
  const { text = '', page = '' } = req.body || {};
  if (String(text).trim().length < 3) return res.status(400).json({ error: 'כתבו כמה מילים' });
  const list = readReports();
  list.push({ id: Date.now(), lecture_id: 'feedback', section: String(page).slice(0, 200), text: String(text).trim().slice(0, 2000), created_at: Date.now(), status: 'open' });
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(list, null, 2));
  res.json({ ok: true });
});
app.get('/api/reports', async (req, res) => {
  const local = readReports().filter((r) => r.status === 'open').map((r) => ({ ...r, source: 'local' }));
  let cloud = [];
  let cloudError = null;
  try {
    cloud = (await moodle.cloudReports()).map((r) => ({ ...r, source: 'cloud' }));
  } catch (e) {
    cloudError = e.message;
  }
  const withTitle = (r) => {
    if (r.lecture_id === 'feedback') return { ...r, feedback: true, lectureTitle: 'משוב כללי' };
    const l = getLecture(r.lecture_id);
    return { ...r, lectureTitle: l?.title || r.lecture_id, courseId: l?.courseId, courseShort: getCourse(l?.courseId)?.short };
  };
  res.json({ reports: [...cloud, ...local].map(withTitle).sort((a, b) => b.created_at - a.created_at), cloudError });
});
app.post('/api/reports/:source/:id/resolve', async (req, res) => {
  try {
    if (req.params.source === 'cloud') await moodle.resolveCloudReport(req.params.id);
    else fs.writeFileSync(REPORTS_FILE, JSON.stringify(readReports().map((r) => (String(r.id) === req.params.id ? { ...r, status: 'resolved' } : r)), null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/backup', (req, res) => res.json(backupStatus()));
app.post('/api/backup', async (req, res) => {
  try {
    res.json(await backupNow());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** "Try again" for everything that came in without AI material (e.g. after the usage limit reset). */
app.post('/api/maintenance/retry-ai', async (req, res) => {
  if (!aiStatus().ready) return res.status(400).json({ error: 'אין חיבור ל-AI' });
  let n = 0;
  for (const l of listLectures()) {
    if (l.status !== 'ready') continue;
    if (l.aiError) {
      await patchLecture(l.id, { status: 'processing', stage: 'queued' });
      enqueue(l.id, { aiOnly: true });
      n++;
    } else if (l.notesError) {
      await patchLecture(l.id, { notesStatus: 'queued', notesError: null });
      enqueue(l.id, { notesOnly: true });
      n++;
    }
  }
  res.json({ queued: n });
});

app.get('/api/me/grades/:courseId', async (req, res) => {
  try {
    res.json(await moodle.courseGrades(req.params.courseId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/lectures/:id/notes', async (req, res) => {
  const meta = getLecture(req.params.id);
  if (!meta) return res.status(404).json({ error: 'הרצאה לא נמצאה' });
  if (!aiStatus().ready) return res.status(400).json({ error: 'אין חיבור ל-AI' });
  await patchLecture(meta.id, { notesStatus: 'queued', notesError: null });
  enqueue(meta.id, { notesOnly: true });
  res.json({ ok: true });
});

// ---------- upload ----------
app.post('/api/upload', upload.array('files', 30), async (req, res) => {
  const { courseId = 'auto', lessonNumber, kind } = req.body;
  const created = [];
  const errors = [];
  for (const f of req.files || []) {
    // multer decodes multipart filenames as latin1; restore UTF-8 (Hebrew names).
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    try {
      created.push(await addLectureFile({ filePath: f.path, originalName: name, courseId, lessonNumber, kind: KINDS.includes(kind) ? kind : null, move: true }));
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

// ---------- homework-level practice ----------
app.get('/api/courses/:id/practice', (req, res) => res.json(getPractice(req.params.id)));

app.post('/api/courses/:id/practice', async (req, res) => {
  const course = getCourse(req.params.id);
  if (!course) return res.status(404).json({ error: 'קורס לא נמצא' });
  const { count = 5, topic = '' } = req.body;
  const items = listLectures(course.id).filter((l) => l.status === 'ready');
  const homework = items.filter((l) => l.kind === 'homework' || l.kind === 'tutorial');
  if (!homework.length) return res.status(400).json({ error: 'אין עדיין שיעורי בית או תרגולים בקורס הזה' });
  try {
    const hwText = homework
      .map((l) => `## ${l.kind === 'homework' ? 'שיעורי בית' : 'תרגול'}: ${l.title}\n${getSlides(l.id).map((s) => s.text).join('\n')}`)
      .join('\n\n')
      .slice(0, 250000);
    const lecText = items.filter((l) => (l.kind || 'lecture') === 'lecture').map((l) => `## ${l.title}\n${getContent(l.id)?.overview || ''}`).join('\n');
    const saved = getPractice(course.id);
    const out = await generateJSON({
      system: `${lectureSystem(course)}\nבמשימה הזו אתה המתרגל של הקורס: כותב תרגילים ופתרונות רשמיים ברמה של שיעורי הבית.`,
      prompt: homeworkPracticePrompt({ course, homework: hwText, lectures: lecText, count: Math.min(10, Number(count) || 5), topic, avoid: saved.problems.map((p) => p.question.slice(0, 120)).slice(-40) }),
      schema: HOMEWORK_PRACTICE_SCHEMA,
      effort: 'high',
      maxTokens: 32000,
    });
    const stamp = new Date().toISOString();
    const next = {
      quiz: [...saved.quiz, ...out.quiz.map((q) => ({ ...q, generated: true, at: stamp }))],
      problems: [...saved.problems, ...out.problems.map((p) => ({ ...p, at: stamp }))],
    };
    await savePractice(course.id, next);
    res.json({ added: { quiz: out.quiz.length, problems: out.problems.length }, practice: next });
  } catch (e) {
    console.error('[homework-practice]', e.message);
    res.status(500).json({ error: /429|usage_limit/.test(e.message) ? 'הגעת למגבלת השימוש ב-Claude – נסו שוב מאוחר יותר' : e.message });
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
    // The structured summary: definitions, rules, examples… (title = the block's or the section's)
    for (const sec of content?.notes?.sections || []) {
      for (const b of sec.blocks || []) {
        const text = `${b.title || ''} ${b.body || ''}`;
        if (text.toLowerCase().includes(q)) results.push({ ...base, type: 'note', title: b.title || sec.title, snippet: snippet(b.body || ''), score: (b.title || '').toLowerCase().includes(q) ? 8.5 : 6 });
      }
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

// ---------- updates & deadlines ----------
app.get('/api/updates', (_req, res) => res.json(updates.updatesView()));
app.post('/api/updates/deadlines', wrap((req) => updates.addManualDeadline(req.body)));
app.patch('/api/updates/deadlines/:id', wrap((req) => updates.patchDeadline(req.params.id, req.body)));
app.delete('/api/updates/deadlines/:id', wrap(async (req) => { await updates.deleteDeadline(req.params.id); return { ok: true }; }));
app.put('/api/updates/settings', wrap((req) => updates.setSettings(req.body)));
app.post('/api/updates/test-notification', wrap(async () => { updates.testNotification(); return { ok: true }; }));

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

app.listen(PORT, HOST, () => {
  const ai = aiStatus();
  console.log(`\n  📚 Study Hub פועל: http://localhost:${PORT}`);
  console.log(`  AI: ${ai.provider} (${ai.model})`);
  console.log(`  תיקיית קליטה: ${path.join(ROOT, 'inbox')}\n`);
  initPublish({ rootDir: ROOT, processing: () => queueState().running || listLectures().some((l) => l.status === 'processing') });
  updates.initUpdates().catch((e) => console.error('[updates]', e.message));
  resumePending();
  if (process.env.NO_INBOX !== '1') watchInbox();
  moodle.startMoodle();
  startBackups();
});
