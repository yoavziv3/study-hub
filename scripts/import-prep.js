// Imports a course's lessons from an earlier semester as exam-prep units (text only), through the running server:
//   node scripts/import-prep.js <courseId> <dir> "<semester>" [lessons…]
// <dir> holds slides-NN.txt (the slide text of lesson NN) and, optionally, transcript-NN.txt (the lesson's
// transcript) – e.g. the sources of the course's NotebookLM (files may also be prefixed, like nlm-slides-03.txt).
// The server writes the study material (summary, questions, flashcards, glossary, notes) one lesson at a time.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const [courseId, dir, semester, ...only] = process.argv.slice(2);
if (!courseId || !dir || !semester) {
  console.error('usage: node scripts/import-prep.js <courseId> <dir> "<semester>" [lessons…]');
  process.exit(1);
}
const SERVER = `http://localhost:${process.env.PORT || 5180}`;
const files = fs.readdirSync(dir);
const find = (kind, n) => files.find((f) => new RegExp(`(^|-)${kind}-0*${n}\\.txt$`).test(f));
// The first line of each file may be the source's name (as saved from NotebookLM) – drop it.
const read = (f) => (f ? fs.readFileSync(path.join(dir, f), 'utf8').replace(/^[^\n]*\.(pdf|pptx|txt)\n+/, '') : '');

const lessons = [...new Set(files.map((f) => f.match(/slides-0*(\d+)\.txt$/)?.[1]).filter(Boolean).map(Number))]
  .filter((n) => !only.length || only.map(Number).includes(n))
  .sort((a, b) => a - b);
for (const n of lessons) {
  const slidesText = read(find('slides', n));
  const transcript = read(find('transcript', n));
  const res = await fetch(`${SERVER}/api/courses/${courseId}/prep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lesson: n, semester, slidesText, transcript }),
  });
  const r = await res.json();
  console.log(res.ok ? `lesson ${n}: queued as ${r.id}${transcript ? ' (with transcript)' : ''}` : `lesson ${n}: ${r.error}`);
}
