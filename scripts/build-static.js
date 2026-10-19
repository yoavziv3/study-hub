// Builds the cloud (Cloudflare Pages) version of the site into dist-cloud/:
// the client in static mode + every lecture exported as JSON, slide images and the original decks.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, listCourses, listLectures, getContent, getSlides, lectureDir } from '../server/lib/store.js';

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

await write('status.json', { ai: { provider: 'static', ready: false }, static: true });
await write('lectures.json', lectures.map(card));
await write(
  'courses.json',
  courses.map((c) => {
    const ls = lectures.filter((l) => l.courseId === c.id);
    return { ...c, lectureCount: ls.length, slideCount: ls.reduce((s, l) => s + (l.slideCount || 0), 0), processing: 0 };
  })
);

for (const c of courses) {
  const ls = lectures.filter((l) => l.courseId === c.id);
  await write(`courses/${c.id}.json`, { ...c, lectures: ls.map(card) });
  await write(`bundles/${c.id}.json`, { ...c, lectures: ls.map((m) => ({ ...m, content: getContent(m.id) })) });
}

const search = [];
for (const m of lectures) {
  const course = courses.find((c) => c.id === m.courseId);
  const content = getContent(m.id);
  const slides = getSlides(m.id);
  await write(`lectures/${m.id}.json`, { ...m, content, slides, course });

  const base = { lectureId: m.id, lectureTitle: m.title, courseId: m.courseId, courseShort: course?.short, color: course?.color };
  search.push({ ...base, type: 'lecture', title: m.title, text: '' });
  for (const t of content?.topics || []) search.push({ ...base, type: 'topic', title: t.title, slide: t.slideStart, text: t.summary });
  for (const g of content?.glossary || []) search.push({ ...base, type: 'term', title: g.term, text: g.definition });
  for (const s of slides) search.push({ ...base, type: 'slide', title: `שקף ${s.n}`, slide: s.n, text: s.text });

  // Slide images + the original deck for download.
  const src = lectureDir(m.id);
  const dest = path.join(OUT, 'files', m.id);
  await fsp.mkdir(dest, { recursive: true });
  if (fs.existsSync(path.join(src, 'slides'))) await fsp.cp(path.join(src, 'slides'), path.join(dest, 'slides'), { recursive: true });
  if (fs.existsSync(path.join(src, m.originalFile))) await fsp.copyFile(path.join(src, m.originalFile), path.join(dest, m.originalFile));
}
await write('search.json', search);

// SPA routing + caching rules for Cloudflare Pages.
await fsp.writeFile(path.join(OUT, '_redirects'), '/* /index.html 200\n');
await fsp.writeFile(
  path.join(OUT, '_headers'),
  ['/files/*', '  Cache-Control: public, max-age=86400', '/assets/*', '  Cache-Control: public, max-age=31536000, immutable', '/data/*', '  Cache-Control: no-cache', ''].join('\n')
);

const count = (dir) => fs.readdirSync(dir, { recursive: true }).length;
console.log(`\n☁️  dist-cloud ready: ${lectures.length} lectures, ${courses.length} courses, ${count(OUT)} files`);
