// Builds the cloud (Cloudflare Pages) version of the site into dist-cloud/:
// the client in static mode + every lecture exported as JSON, slide images and the original decks.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, DATA_DIR, listCourses, listLectures, getContent, getSlides, lectureDir, getPractice, getLinks } from '../server/lib/store.js';

const OUT = path.join(ROOT, 'dist-cloud');

execFileSync(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', OUT, '--emptyOutDir'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, VITE_STATIC: '1' },
});

const write = async (rel, value) => {
  const file = path.join(OUT, 'data', rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(value));
};

// Only lectures that finished processing are published.
const lectures = listLectures().filter((l) => l.status === 'ready');

// Slides are shown from one PDF per lecture (drawn in the browser) plus one thumbnail – instead of two images
// per slide – which keeps the site far below Cloudflare's 20,000-file limit. Decks whose PDF is too big for a
// Pages asset (25 MiB) fall back to slide images.
const MAX_ASSET = 24 * 1024 * 1024;
const slideAssets = new Map();
for (const m of lectures) {
  // Exam-prep units (kind 'prep') are text only: no deck, no original file.
  if (!m.originalFile) {
    slideAssets.set(m.id, {});
    continue;
  }
  const dir = lectureDir(m.id);
  const original = path.join(dir, m.originalFile);
  const isPdf = path.extname(m.originalFile).toLowerCase() === '.pdf';
  const src = isPdf ? original : [path.join(dir, 'deck.pdf'), path.join(dir, 'slides.pdf')].find((f) => fs.existsSync(f));
  const fits = src && fs.existsSync(src) && fs.statSync(src).size <= MAX_ASSET;
  slideAssets.set(m.id, {
    pdf: fits ? (isPdf ? `/data/orig/${m.id}/${m.originalFile}` : `/data/pdf/${m.id}.pdf`) : null,
    pdfSource: fits && !isPdf ? src : null,
    thumb: fs.existsSync(path.join(dir, 'slides', 't001.jpg')) ? `/data/thumb/${m.id}.jpg` : null,
    noOriginal: fs.existsSync(original) && fs.statSync(original).size > MAX_ASSET,
  });
}
const withSlides = (m) => ({ ...m, pdf: slideAssets.get(m.id)?.pdf || null, thumb: slideAssets.get(m.id)?.thumb || null, ...(slideAssets.get(m.id)?.noOriginal ? { noOriginal: true } : {}) });
const courses = listCourses();

const card = (m) => {
  const c = getContent(m.id);
  return {
    ...withSlides(m),
    overview: c?.overview || '',
    topicCount: c?.topics?.length || 0,
    quizCount: c?.quiz?.length || 0,
    flashcardCount: c?.flashcards?.length || 0,
    hasContent: !!c,
  };
};

// Weekly load reports (server/lib/weekly.js), newest first; cloud/gate.js limits each to the student's courses.
{
  const dir = path.join(DATA_DIR, 'weekly');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(0, 26) : [];
  await write('weekly.json', files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
}
await write('status.json', { ai: { provider: 'static', ready: false }, static: true, accounts: true });
// Updates feed & deadlines (read state lives in each visitor's browser).
{
  let upd = { since: new Date().toISOString(), items: [], deadlines: [], settings: {} };
  try { upd = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'updates.json'), 'utf8')); } catch { /* none yet */ }
  const cutoff = Date.now() - 7 * 86400000;
  await write('updates.json', {
    since: upd.since,
    items: [...(upd.items || [])].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 300),
    deadlines: (upd.deadlines || []).filter((d) => new Date(d.dueAt).getTime() > cutoff).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    settings: { notify: false, reminderDays: upd.settings?.reminderDays || [3, 1] },
  });
}
await write('build.json', { commit: process.env.CF_PAGES_COMMIT_SHA || 'local', builtAt: new Date().toISOString() });
await write('lectures.json', lectures.map(card));
await write(
  'courses.json',
  courses.map((c) => {
    const ls = lectures.filter((l) => l.courseId === c.id);
    const of = (k) => ls.filter((l) => (l.kind || 'lecture') === k).length;
    return { ...c, lectureCount: of('lecture'), tutorialCount: of('tutorial'), homeworkCount: of('homework'), prepCount: of('prep'), slideCount: ls.reduce((s, l) => s + (l.slideCount || 0), 0), processing: 0 };
  })
);

for (const c of courses) {
  const ls = lectures.filter((l) => l.courseId === c.id);
  await write(`courses/${c.id}.json`, { ...c, lectures: ls.map(card) });
  await write(`bundles/${c.id}.json`, { ...c, lectures: ls.map((m) => ({ ...withSlides(m), content: getContent(m.id) })), practice: getPractice(c.id) });
}

// Search index per course, so each student downloads (and is allowed) only their own courses.
const search = Object.fromEntries(courses.map((c) => [c.id, []]));
for (const m of lectures) {
  const course = courses.find((c) => c.id === m.courseId);
  const content = getContent(m.id);
  const slides = getSlides(m.id);
  await write(`lectures/${m.id}.json`, { ...withSlides(m), content, slides, course });

  const base = { lectureId: m.id, lectureTitle: m.title, courseId: m.courseId, courseShort: course?.short, color: course?.color };
  const index = (search[m.courseId] ||= []);
  index.push({ ...base, type: 'lecture', title: m.title, text: '' });
  for (const t of content?.topics || []) index.push({ ...base, type: 'topic', title: t.title, slide: t.slideStart, text: t.summary });
  for (const g of content?.glossary || []) index.push({ ...base, type: 'term', title: g.term, text: g.definition });
  for (const s of m.kind === 'prep' ? [] : slides) index.push({ ...base, type: 'slide', title: `שקף ${s.n}`, slide: s.n, text: s.text });
  for (const sec of content?.notes?.sections || []) {
    for (const b of sec.blocks || []) index.push({ ...base, type: 'note', title: b.title || sec.title, text: b.body || '' });
  }

  // Slide images are static (their URLs are only listed inside the access-checked lecture JSON);
  // the original deck sits under /data/orig/, which only enrolled students can download.
  const src = lectureDir(m.id);
  const assets = slideAssets.get(m.id);
  if (assets.pdfSource) {
    await fsp.mkdir(path.join(OUT, 'data', 'pdf'), { recursive: true });
    await fsp.copyFile(assets.pdfSource, path.join(OUT, 'data', 'pdf', `${m.id}.pdf`));
  }
  if (assets.thumb) {
    await fsp.mkdir(path.join(OUT, 'data', 'thumb'), { recursive: true });
    await fsp.copyFile(path.join(src, 'slides', 't001.jpg'), path.join(OUT, 'data', 'thumb', `${m.id}.jpg`));
  }
  if (!assets.pdf) {
    // Fallback: slide images (kept in git under fallback/ for decks too big for a single PDF asset).
    const images = ['fallback', 'slides'].map((d) => path.join(src, d)).find((d) => fs.existsSync(d) && fs.readdirSync(d).length > 1);
    if (images) await fsp.cp(images, path.join(OUT, 'files', m.id, 'slides'), { recursive: true });
  }
  // The original deck for download – unless it's over Cloudflare's per-file limit, which fails the whole deploy
  // (its slides are still shown, from the fallback images).
  if (m.originalFile && fs.existsSync(path.join(src, m.originalFile)) && fs.statSync(path.join(src, m.originalFile)).size <= MAX_ASSET) {
    await fsp.mkdir(path.join(OUT, 'data', 'orig', m.id), { recursive: true });
    await fsp.copyFile(path.join(src, m.originalFile), path.join(OUT, 'data', 'orig', m.id, m.originalFile));
  }
}
for (const [courseId, entries] of Object.entries(search)) await write(`search/${courseId}.json`, entries);
// Links from each course's Moodle page (served only to the course's students, like the rest of /data).
for (const c of courses) await write(`links/${c.id}.json`, getLinks(c.id));

// pdf.js standard fonts (for PDFs that don't embed them), served next to the app.
const fontsDir = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts');
if (fs.existsSync(fontsDir)) await fsp.cp(fontsDir, path.join(OUT, 'pdfjs', 'standard_fonts'), { recursive: true });

// Only /api/* and /data/* run the Functions (sign-in and access checks); everything else is plain static hosting.
await fsp.writeFile(
  path.join(OUT, '_routes.json'),
  JSON.stringify({ version: 1, include: ['/api/*', '/data/*'], exclude: ['/data/build.json', '/data/status.json'] })
);

// SPA routing + caching rules for Cloudflare Pages.
await fsp.writeFile(path.join(OUT, '_redirects'), '/* /index.html 200\n');
await fsp.writeFile(
  path.join(OUT, '_headers'),
  [
    // The site can't be framed (clickjacking of the sign-in form), types aren't sniffed, and full URLs
    // (e.g. the personal calendar link) are never sent to other sites as a referrer.
    '/*',
    '  X-Frame-Options: DENY',
    "  Content-Security-Policy: frame-ancestors 'none'",
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: same-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '/sw.js', '  Cache-Control: no-cache', '/files/*', '  Cache-Control: public, max-age=86400', '/assets/*', '  Cache-Control: public, max-age=31536000, immutable', '/data/*', '  Cache-Control: no-cache', ''].join('\n')
);

const count = (dir) => fs.readdirSync(dir, { recursive: true }).length;
console.log(`\n☁️  dist-cloud ready: ${lectures.length} lectures, ${courses.length} courses, ${count(OUT)} files`);
