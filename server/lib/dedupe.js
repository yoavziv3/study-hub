// One copy of each lecture on the site (the owner's rule): a file that reads like one already up – the same deck
// posted again, a corrected re-upload, the same lecture filed twice – is held back (meta.held, so it stays on the Mac
// but out of every list) with dupOf pointing at the copy that stays, and gets no AI of its own. A course's holdNames
// (a regex on the file's name, e.g. calculus 'קבוצה 8') holds the files of a group whose material isn't carried.
// Other groups' own Moodle courses (remote) keep their copies: their students see only those.
import { listLectures, getLecture, getContent, getSlides, getCourse, patchLecture } from './store.js';

const SAME = 0.85; // word-set overlap that makes two files of the same course "the same lecture"
const SAME_EXACT = 0.97; // exams and tutorials: only true copies (a solution reads ~0.9 like its exam)

const words = (id) => new Set(String(getSlides(id).map((s) => s.text || '').join(' ')).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []);
function overlap(a, b) {
  if (a.size < 30 || b.size < 30) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}
const kindOf = (m) => m.kind || 'lecture';
const threshold = (kind) => (kind === 'lecture' ? SAME : SAME_EXACT);
const questions = (id) => { const c = getContent(id); return c?.summary ? 1 + (c.quiz?.length || 0) + (c.extraQuiz?.length || 0) : 0; };
// Which copy stays: the one with study material (the most questions), else the first one up.
const better = (a, b) => questions(b.id) - questions(a.id) || String(a.createdAt).localeCompare(String(b.createdAt));

// The held files of a group the course doesn't carry (holdNames) – listLectures leaves held items out.
const groupHeld = (courseId) => listLectures(courseId, { withHeld: true }).filter((l) => l.heldReason === 'group');
const peers = (meta) => listLectures().filter((l) => l.id !== meta.id && l.courseId === meta.courseId && l.status === 'ready'
  && kindOf(l) === kindOf(meta) && kindOf(l) !== 'prep');

export function heldByName(meta) {
  const re = getCourse(meta?.courseId)?.holdNames;
  return !!re && new RegExp(re).test(`${meta.originalName || ''} ${meta.title || ''}`);
}

/** The visible copy this new file duplicates, or null. */
export function duplicateOf(id) {
  const meta = getLecture(id);
  if (!meta || getCourse(meta.courseId)?.remote || kindOf(meta) === 'prep') return null;
  const mine = words(id);
  let best = null;
  for (const l of peers(meta)) {
    const score = overlap(mine, words(l.id));
    if (score >= threshold(kindOf(meta)) && (!best || score > best.score)) best = { l, score };
  }
  return best;
}

/** At ingest: hold a new file that is a copy of one already up (or of a group the course doesn't carry). */
export async function holdIfDuplicate(id) {
  const meta = getLecture(id);
  if (heldByName(meta)) {
    await patchLecture(id, { held: true, heldReason: 'group' });
    console.log(`[dedupe] ${id} held: a group the course doesn't carry`);
    return true;
  }
  const dup = duplicateOf(id);
  if (!dup) {
    // The held group's lecture filed under another name (its "הרצאה 2.pdf"): held with it.
    const mine = words(id);
    const twin = groupHeld(meta.courseId).find((l) => kindOf(l) === kindOf(meta) && overlap(mine, words(l.id)) >= SAME);
    if (!twin) return false;
    await patchLecture(id, { held: true, heldReason: 'group', dupOf: twin.id });
    console.log(`[dedupe] ${id} held: the same as ${twin.id}, a group the course doesn't carry`);
    return true;
  }
  await patchLecture(id, { held: true, heldReason: 'duplicate', dupOf: dup.l.id });
  console.log(`[dedupe] ${id} held: same as ${dup.l.id} (${Math.round(dup.score * 100)}%)`);
  return true;
}

/** One pass over the whole site: in every cluster of copies keep one. dry: only report. Returns [{ id, dupOf, score }]. */
export async function dedupeAll({ dry = false } = {}) {
  const items = listLectures().filter((l) => l.status === 'ready' && kindOf(l) !== 'prep' && !getCourse(l.courseId)?.remote);
  const held = [];
  for (const l of items.filter(heldByName)) {
    held.push({ id: l.id, title: l.title, reason: 'group' });
    if (!dry) await patchLecture(l.id, { held: true, heldReason: 'group' });
  }
  // A file that reads like a held group's file, and like no file of the carried groups, is that group's too.
  const groupWords = items.filter(heldByName).map((l) => ({ l, w: words(l.id) }));
  let rest = items.filter((l) => !heldByName(l)).map((l) => ({ l, w: words(l.id) }));
  const sameAs = (x, list) => list.find((y) => y.l.id !== x.l.id && y.l.courseId === x.l.courseId && kindOf(y.l) === kindOf(x.l) && overlap(x.w, y.w) >= SAME);
  const ofGroup = rest.filter((x) => sameAs(x, groupWords) && !sameAs(x, rest));
  for (const x of ofGroup) {
    held.push({ id: x.l.id, title: x.l.title, reason: 'group', dupOf: sameAs(x, groupWords).l.id });
    if (!dry) await patchLecture(x.l.id, { held: true, heldReason: 'group', dupOf: sameAs(x, groupWords).l.id });
  }
  rest = rest.filter((x) => !ofGroup.includes(x));
  const parent = new Map(rest.map(({ l }) => [l.id, l.id]));
  const find = (x) => (parent.get(x) === x ? x : find(parent.get(x)));
  const score = new Map();
  for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
    const a = rest[i], b = rest[j];
    if (a.l.courseId !== b.l.courseId || kindOf(a.l) !== kindOf(b.l)) continue;
    const s = overlap(a.w, b.w);
    if (s < threshold(kindOf(a.l))) continue;
    parent.set(find(a.l.id), find(b.l.id));
    score.set(`${a.l.id}|${b.l.id}`, s).set(`${b.l.id}|${a.l.id}`, s);
  }
  const clusters = new Map();
  for (const { l } of rest) clusters.set(find(l.id), [...(clusters.get(find(l.id)) || []), l]);
  for (const group of clusters.values()) {
    if (group.length < 2) continue;
    const [keep, ...drop] = group.sort(better);
    for (const l of drop) {
      held.push({ id: l.id, title: l.title, dupOf: keep.id, keepTitle: keep.title, score: score.get(`${l.id}|${keep.id}`) || null });
      if (!dry) await patchLecture(l.id, { held: true, heldReason: 'duplicate', dupOf: keep.id });
    }
  }
  return held;
}
