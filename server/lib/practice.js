// A big question bank per lesson, beyond the 10–14 questions its summary comes with: written from the lesson's own
// slides (so never ahead of the course), checked like every AI output (checks.js), deduplicated against what the
// lesson already has (also near-duplicates), and kept in content.extraQuiz. Students practise it in sets of 15
// (client: Lecture → PracticeTab), unanswered and wrong questions first.
// growBank brings a lesson up to BANK_TARGET in rounds, each focused on another stretch of the slides so the bank
// covers the whole lesson. It runs on its own worker (queueBank), not in the ingest queue: a new lesson goes up
// right away and its bank fills in afterwards. /api/maintenance/grow-banks fills up the existing lessons.
import { bankOk } from './courses.js';
import { ROOT, getCourse, getLecture, patchLecture, getContent, saveContent, getSlides, listLectures } from './store.js';
import fs from 'node:fs';
import path from 'node:path';
import { generateJSON, aiStatus, claudeStatus, geminiStatus } from './ai.js';
import { geminiRoom } from './gemini.js';
import { PRACTICE_SCHEMA, practicePrompt } from './prompts.js';
import { startRun } from './runlog.js';
import { checkQuiz, fixSlide, ANOTHER_Q } from './checks.js';
import { escapeCurrency } from '../../shared/currency.js';

export const BANK_TARGET = 200;
const ROUND = 20;
const BANK_KINDS = ['lecture', 'tutorial', 'prep'];

const bankOf = (content) => [...(content?.quiz || []), ...(content?.extraQuiz || [])];

// Near-duplicates: the same words in another order or with small changes (Jaccard over word sets).
const words = (t) => new Set(String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1));
function similar(a, b) {
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common || 1) >= 0.8;
}
// Who writes a round, and when:
//  - Claude (Sonnet, AI_BANK_MODEL) at night – BANK_CLAUDE_HOURS (Israel time, default "1-7") – at most
//    BANK_CLAUDE_CAP rounds a night (default 40), because it is the owner's own plan and the quota they use
//    themselves. A usage limit ends Claude's night early.
//  - Gemini any other time (BANK_HOURS, default "0-24"), within the share of its free daily quota that isn't kept
//    for lessons (gemini.js geminiRoom). It also takes over at night when Claude has used its cap or fails.
// Summaries of new lessons aren't affected: only these extra questions are limited.
const hoursOf = (spec, fallback) => String(spec || fallback).split('-').map(Number);
const [BANK_FROM, BANK_TO] = hoursOf(process.env.BANK_HOURS, '0-24');
const [CLAUDE_FROM, CLAUDE_TO] = hoursOf(process.env.BANK_CLAUDE_HOURS, '1-7');
const CLAUDE_CAP = Number(process.env.BANK_CLAUDE_CAP) || 40;
const BANK_MODEL = process.env.AI_BANK_MODEL || 'claude-sonnet-5-5';
const BANK_TIMEOUT = 8 * 60000;
const hourIL = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const within = (from, to, h = hourIL()) => (from <= to ? h >= from && h < to : h >= from || h < to);
export const bankHours = () => within(BANK_FROM, BANK_TO);
const isLimit = (e) => /429|usage|limit|quota|authenticate|login/i.test(String(e?.message || e));

// Claude's rounds tonight, kept on disk so a restart doesn't hand it a fresh cap. A "night" is named by the Israel
// date its hours started on; `lastAdded` is when any bank last grew (the status check looks at it).
const STATE_FILE = path.join(path.dirname(process.env.STUDY_RUNLOG || path.join(ROOT, 'logs', 'runs.jsonl')), 'bank-state.json');
let bankMeta = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } })();
const saveMeta = () => { try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(bankMeta)); } catch { /* kept in memory */ } };
if (!bankMeta.since) { bankMeta.since = Date.now(); saveMeta(); }
const nightKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(Date.now() - CLAUDE_FROM * 3600000));
const claudeTonight = () => (bankMeta.night === nightKey() ? bankMeta : { night: nightKey(), claudeRounds: 0, claudeStopped: false });
const claudeCanWrite = () => claudeStatus().ready && within(CLAUDE_FROM, CLAUDE_TO) && !claudeTonight().claudeStopped && claudeTonight().claudeRounds < CLAUDE_CAP;
const geminiCanWrite = () => geminiStatus().ready && bankHours() && geminiRoom('low') > 0;
/** Who may write the next round, in order. Empty: the banks wait (for tonight, or for Gemini's quota to reset). */
export const bankWriters = () => [...(claudeCanWrite() ? ['claude'] : []), ...(geminiCanWrite() ? ['gemini'] : [])];
const noteRound = (by, added) => {
  const t = claudeTonight();
  bankMeta = { ...bankMeta, ...t, ...(by === 'claude' ? { claudeRounds: t.claudeRounds + 1 } : {}), ...(added > 0 ? { lastAdded: Date.now() } : {}) };
  saveMeta();
};
const stopClaudeTonight = () => { bankMeta = { ...bankMeta, ...claudeTonight(), claudeStopped: true }; saveMeta(); };
export const bankProgress = () => ({ since: (bankMeta.since ||= Date.now()), ...(claudeTonight().night === bankMeta.night ? { claudeRounds: bankMeta.claudeRounds || 0, claudeStopped: !!bankMeta.claudeStopped } : { claudeRounds: 0, claudeStopped: false }), claudeCap: CLAUDE_CAP, lastAdded: bankMeta.lastAdded || null });

/** One round of new questions for a lesson; returns the questions added. */
export async function addLectureQuestions(lectureId, { count = 6, difficulty = 'mixed', trigger = 'manual', focus = null, by = null } = {}) {
  const meta = getLecture(lectureId);
  const course = getCourse(meta.courseId);
  const content = getContent(lectureId) || {};
  const slides = getSlides(lectureId);
  const material = slides.map((s) => `[שקף ${s.n}] ${s.text}`).join('\n');
  const avoid = bankOf(content).map((q) => q.question);
  const run = startRun('practice', { trigger, input: { lectureId, course: course.short, title: meta.title, count, difficulty, has: avoid.length, ...(focus ? { slides: `${focus.from}-${focus.to}` } : {}), ...(by ? { by } : {}) } });
  let out;
  try {
    out = await generateJSON({
      system: `אתה כותב שאלות מבחן מקצועי בקורס ${course.name}. הקפד על נכונות מלאה של התשובה המסומנת.`,
      prompt: practicePrompt({ course, title: meta.title, material: material.slice(0, 180000), count, difficulty, focus, avoid: avoid.map((q) => q.slice(0, 110)).slice(-220) }),
      schema: PRACTICE_SCHEMA,
      effort: 'medium',
      maxTokens: 24000,
      priority: 'low', // with Gemini: never the quota kept for new lessons
      // The bank worker names who writes the round (by); a request from the site goes where AI_PROVIDER says.
      ...(by ? { use: by, model: by === 'claude' ? BANK_MODEL : null, timeoutMs: by === 'claude' ? BANK_TIMEOUT : undefined } : {}),
    });
  } catch (e) {
    run.fail(e);
    throw e;
  }
  const checked = checkQuiz(out.quiz, { slideCount: slides.length, slides: slides.map((x) => x.text) });
  // Questions the lesson already has (or almost the same ones) are not added again.
  const seen = avoid.map(words);
  const fresh = [];
  for (const q of checked.value) {
    const w = words(q.question);
    if (seen.some((x) => similar(w, x))) continue;
    seen.push(w);
    fresh.push(q);
  }
  const checks = [...checked.checks, ...(fresh.length < checked.value.length ? [{ rule: 'practice.duplicate', level: 'fixed', detail: `הוסרו ${checked.value.length - fresh.length} שאלות שכבר קיימות או כמעט זהות` }] : [])];
  run.ok({ asked: count, kept: fresh.length, total: avoid.length + fresh.length }, checks);
  const quiz = fresh.map((q) => ({ ...q, generated: true }));
  const latest = getContent(lectureId) || {};
  await saveContent(lectureId, { ...latest, extraQuiz: [...(latest.extraQuiz || []), ...quiz] });
  return quiz;
}

/** Brings a lesson's bank up to `target` questions, a round at a time over stretches of the slides. */
export async function growBank(lectureId, { target = BANK_TARGET, trigger = 'manual' } = {}) {
  const meta = getLecture(lectureId);
  if (!meta || meta.noAi || meta.held || !BANK_KINDS.includes(meta.kind || 'lecture') || !bankWriters().length) return 0;
  if (!bankOk(getCourse(meta.courseId)) || !getContent(lectureId)) return 0;
  const total = Math.max(1, getSlides(lectureId).length);
  const rounds = Math.ceil(target / ROUND) + 3;
  const span = Math.max(4, Math.ceil(total / Math.max(1, Math.ceil(target / ROUND))));
  let added = 0;
  let thin = 0;
  for (let round = 0; round < rounds; round++) {
    const writers = bankWriters();
    if (!writers.length) break; // the rest waits for tonight or for Gemini's quota (growAllBanks picks it up again)
    const have = bankOf(getContent(lectureId)).length;
    if (have >= target) break;
    const from = ((round * span) % total) + 1;
    const focus = total > span ? { from, to: Math.min(total, from + span - 1) } : null;
    // Claude at night while it has rounds left, else Gemini; if one fails the other gets the round.
    let got = null;
    let failure = null;
    for (const by of writers) {
      try {
        got = await addLectureQuestions(lectureId, { count: Math.min(ROUND, target - have + 2), trigger, focus, by });
        noteRound(by, got.length);
        break;
      } catch (e) {
        failure = e;
        if (by === 'claude' && isLimit(e)) stopClaudeTonight();
        console.error(`[practice] bank round on ${by} failed: ${String(e.message).slice(0, 120)}`);
      }
    }
    if (!got) throw failure;
    added += got.length;
    // Two rounds in a row that add almost nothing: the slides are exhausted – stop rather than pad the bank.
    thin = got.length < 3 ? thin + 1 : 0;
    if (thin >= 2) {
      await patchLecture(lectureId, { bankDone: true }); // not offered again by growAllBanks
      break;
    }
  }
  return added;
}

// ---------- the bank worker: one lesson at a time, apart from the ingest queue ----------
const pending = [];
let working = false;
let stopped = null; // a usage limit / sign-out: the rest waits for the next run

async function work() {
  if (working) return;
  working = true;
  const result = { lectures: 0, added: 0, errors: [] };
  try {
    while (pending.length && !stopped) {
      const { id, trigger } = pending.shift();
      try {
        const n = await growBank(id, { trigger });
        if (n) { result.lectures++; result.added += n; }
      } catch (e) {
        result.errors.push(`${getLecture(id)?.title || id}: ${String(e.message).slice(0, 120)}`);
        if (isLimit(e)) stopped = e.message;
      }
    }
  } finally {
    working = false;
    pending.length = 0;
  }
  console.log(`[practice] question banks: +${result.added} in ${result.lectures} lessons${result.errors.length ? `, ${result.errors.length} errors` : ''}${stopped ? ' (stopped: AI unavailable)' : ''}`);
  stopped = null;
  return result;
}

/** Queue a lesson for its bank (after ingest); it runs once the worker is free. */
export function queueBank(lectureId, trigger = 'after-lecture') {
  if (!pending.some((p) => p.id === lectureId)) pending.push({ id: lectureId, trigger });
  work().catch((e) => console.error('[practice]', e.message));
}

/** Every lesson on the site below the target, one after another (in the background). Also called by the AI watch
 *  (health.js) whenever Claude answers, so a run stopped by a usage limit carries on by itself. */
export function growAllBanks({ target = BANK_TARGET } = {}) {
  if (!bankWriters().length) return { queued: 0, waiting: 'no writer available now (Claude at night, Gemini within its quota)' };
  for (const l of listLectures()) {
    if (l.status === 'ready' && !l.bankDone && !l.noAi && BANK_KINDS.includes(l.kind || 'lecture') && bankOk(getCourse(l.courseId)) && bankOf(getContent(l.id)).length < target) queueBank(l.id, 'manual');
  }
  return { queued: pending.length };
}

export const bankState = () => ({ working, pending: pending.length });

/**
 * Goes over every lesson's questions: marks the ones that point at a slide (checks.js fixSlide) and fixes their
 * slide numbers, and writes currency dollars as text (shared/currency.js).
 */
export async function markSlideRefs() {
  const result = { lessons: 0, marked: 0, renumbered: 0, currency: 0, dropped: 0 };
  for (const l of listLectures()) {
    const content = getContent(l.id);
    if (!content) continue;
    const slides = getSlides(l.id).map((x) => x.text);
    let changed = false;
    const dropDep = (list = []) => {
      const kept = list.filter((q) => !ANOTHER_Q.test(q.question || ''));
      if (kept.length !== list.length) { result.dropped += list.length - kept.length; changed = true; }
      return kept;
    };
    const fix = (list = []) => list.map((q0) => {
      const q = { ...q0, question: escapeCurrency(q0.question), explanation: escapeCurrency(q0.explanation), options: (q0.options || []).map(escapeCurrency) };
      const money = q.question !== q0.question || q.explanation !== q0.explanation || q.options.some((o, k) => o !== q0.options[k]);
      if (money) result.currency++;
      const ref = fixSlide(q, slides);
      // needsContext: a reading of the whole bank found that the question leans on data or a case it doesn't carry.
      const show = ref.showSlide || (!!q.needsContext && ref.slide > 0);
      if (ref.slide !== (q.slide || 0)) result.renumbered++;
      if (show && !q.showSlide) result.marked++;
      if (!money && ref.slide === (q.slide || 0) && show === !!q.showSlide) return q0;
      changed = true;
      const { showSlide, ...rest } = q;
      return { ...rest, slide: ref.slide, ...(show ? { showSlide: true } : {}) };
    });
    const extraLen = (content.extraQuiz || []).length;
    const quiz = fix(dropDep(content.quiz));
    const extraQuiz = fix(dropDep(content.extraQuiz));
    if (changed) {
      // Re-read right before saving: the bank worker may have added questions meanwhile.
      const latest = getContent(l.id);
      const extra = latest.extraQuiz || [];
      await saveContent(l.id, { ...latest, quiz, extraQuiz: [...extraQuiz, ...fix(dropDep(extra.slice(extraLen)))] });
      result.lessons++;
    }
  }
  return result;
}
