// Re-applies seed/content/*.js to already-imported lectures (matched by title), keeping AI-generated extra questions.
import fs from 'node:fs';
import { listLectures, getContent, saveContent } from '../server/lib/store.js';

const dir = new URL('../seed/content/', import.meta.url);
const seeds = {};
for (const f of fs.readdirSync(dir)) seeds[(await import(new URL(f, dir))).default.title] = f;

for (const l of listLectures()) {
  const current = getContent(l.id);
  const file = current && seeds[current.title];
  if (!file || current.generator !== 'seed') continue;
  const { default: fresh } = await import(new URL(file, dir));
  await saveContent(l.id, { ...fresh, extraQuiz: current.extraQuiz, generatedAt: current.generatedAt, generator: 'seed' });
  console.log('synced', l.title);
}
