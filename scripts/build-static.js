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
const courses = listCourses();

const card = (m) => {
  const c = getContent(m.id);
  return {
    ...m,
    overview: c?.overview || '',
    topicCount: c?.topics?.length || 0,
    quizCount: c?.quiz?.length || 0,
    flashcardCount: c?.flashcards?.length || 0,
    hasContent: !!c,
  };
};

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
    return { ...c, lectureCount: of('lecture'), tutorialCount: of('tutorial'), homeworkCount: of('homework'), slideCount: ls.reduce((s, l) => s + (l.slideCount || 0), 0), processing: 0 };
  })
);

for (const c of courses) {
  const ls = lectures.filter((l) => l.courseId === c.id);
  await write(`courses/${c.id}.json`, { ...c, lectures: ls.map(card) });
  await write(`bundles/${c.id}.json`, { ...c, lectures: ls.map((m) => ({ ...m, content: getContent(m.id) })), practice: getPractice(c.id) });
}

// Search index per course, so each student downloads (and is allowed) only their own courses.
const search = Object.fromEntries(courses.map((c) => [c.id, []]));
for (const m of lectures) {
  const course = courses.find((c) => c.id === m.courseId);
  const content = getContent(m.id);
  const slides = getSlides(m.id);
  await write(`lectures/${m.id}.json`, { ...m, content, slides, course });

  const base = { lectureId: m.id, lectureTitle: m.title, courseId: m.courseId, courseShort: course?.short, color: course?.color };
  const index = (search[m.courseId] ||= []);
  index.push({ ...base, type: 'lecture', title: m.title, text: '' });
  for (const t of content?.topics || []) index.push({ ...base, type: 'topic', title: t.title, slide: t.slideStart, text: t.summary });
  for (const g of content?.glossary || []) index.push({ ...base, type: 'term', title: g.term, text: g.definition });
  for (const s of slides) index.push({ ...base, type: 'slide', title: `שקף ${s.n}`, slide: s.n, text: s.text });
  for (const sec of content?.notes?.sections || []) {
    for (const b of sec.blocks || []) index.push({ ...base, type: 'note', title: b.title || sec.title, text: b.body || '' });
  }

  // Slide images are static (their URLs are only listed inside the access-checked lecture JSON);
  // the original deck sits under /data/orig/, which only enrolled students can download.
  const src = lectureDir(m.id);
  const dest = path.join(OUT, 'files', m.id);
  await fsp.mkdir(dest, { recursive: true });
  if (fs.existsSync(path.join(src, 'slides'))) await fsp.cp(path.join(src, 'slides'), path.join(dest, 'slides'), { recursive: true });
  if (fs.existsSync(path.join(src, m.originalFile))) {
    await fsp.mkdir(path.join(OUT, 'data', 'orig', m.id), { recursive: true });
    await fsp.copyFile(path.join(src, m.originalFile), path.join(OUT, 'data', 'orig', m.id, m.originalFile));
  }
}
for (const [courseId, entries] of Object.entries(search)) await write(`search/${courseId}.json`, entries);
// Links from each course's Moodle page (served only to the course's students, like the rest of /data).
for (const c of courses) await write(`links/${c.id}.json`, getLinks(c.id));

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
