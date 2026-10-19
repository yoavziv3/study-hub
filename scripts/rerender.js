// Re-run slide conversion for lectures that have no rendered slides (keeps their study content).
import { listLectures } from '../server/lib/store.js';
import { processLecture } from '../server/lib/ingest.js';

for (const l of listLectures().filter((x) => !x.hasPdf)) {
  console.log('re-rendering', l.title);
  await processLecture(l.id);
}
for (const l of listLectures()) console.log(l.hasPdf ? '✓' : '✗', l.slideCount, l.title);
