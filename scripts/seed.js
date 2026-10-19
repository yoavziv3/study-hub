// Imports the first batch of lecture files with hand-written study content.
// Usage: node scripts/seed.js [sourceDir]   (default: ~/Downloads)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addLectureFile, queueState } from '../server/lib/ingest.js';
import { listLectures } from '../server/lib/store.js';

const SRC = process.argv[2] || path.join(os.homedir(), 'Downloads');

const ITEMS = [
  { file: 'הרצאה 1  2026_2027.pdf', course: 'econ', lesson: 1, unit: 1, content: 'econ1' },
  { file: 'יסודות מערכות מידע - שיעור 01.pdf', course: 'is', lesson: 1, unit: 1, content: 'is1' },
  { file: 'יסודות מערכות מידע - שיעור 02.pdf', course: 'is', lesson: 2, unit: 2, content: 'is2' },
  { file: 'יחידה 1 - פתיחת הקורס.pptx', course: 'acc', lesson: 1, unit: 1, content: 'acc1' },
  { file: 'יחידה 2 - מבוא לחשבונאות פיננסית.pptx', course: 'acc', lesson: 1, unit: 2, content: 'acc2' },
  { file: 'יחידה 3- הנחות יסוד ועקרונות.pptx', course: 'acc', lesson: 2, unit: 3, content: 'acc3' },
  { file: 'יחידה 4- הזהות החשבונאית.pptx', course: 'acc', lesson: 1, unit: 4, content: 'acc4' },
  { file: 'יחידה 6- התהליך החשבונאי.pptx', course: 'acc', lesson: 4, unit: 6, content: 'acc6' },
  { file: 'יחידה 7- רישומי התאמה.pptx', course: 'acc', lesson: 5, unit: 7, content: 'acc7' },
  { file: 'יחידה 8- רכוש קבוע.pptx', course: 'acc', lesson: 6, unit: 8, content: 'acc8' },
  { file: 'יחידה 9- ניתוח דוחות כספיים וחוות דעת רואה חשבון.pptx', course: 'acc', lesson: 7, unit: 9, content: 'acc9' },
];

const existing = new Set(listLectures().map((l) => l.originalName));

for (const it of ITEMS) {
  // macOS may store Hebrew names in decomposed form – match by NFC.
  const match = fs.readdirSync(SRC).find((f) => f.normalize('NFC') === it.file.normalize('NFC'));
  if (!match) { console.warn(`! missing: ${it.file}`); continue; }
  if (existing.has(match)) { console.log(`= already imported: ${match}`); continue; }
  const { default: content } = await import(`../seed/content/${it.content}.js`);
  await addLectureFile({
    filePath: path.join(SRC, match),
    originalName: match,
    courseId: it.course,
    lessonNumber: it.lesson,
    unitNumber: it.unit,
    title: content.title,
    content: { ...content, generatedAt: new Date().toISOString(), generator: 'seed' },
  });
  console.log(`+ queued: ${match}`);
}

// Wait for conversions to finish.
await new Promise((resolve) => {
  const t = setInterval(() => {
    const q = queueState();
    if (!q.running && !q.pending.length) { clearInterval(t); resolve(); }
  }, 1000);
});
for (const l of listLectures()) console.log(`${l.status.padEnd(6)} ${l.courseId}  שיעור ${l.lessonNumber}  ${l.slideCount} שקפים  ${l.title}`);
