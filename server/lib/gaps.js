// "What's missing on the site": everything that should be up and isn't yet, from this Mac's data – lessons that
// came in without a summary, notes or questions, how far the question banks are from their target, and whether the
// banks are still moving. Sent with the heartbeat (health.js) to the /system page, where shared/system-checks.js
// turns it into a check and, when something has been stuck for long enough, a phone alert.
// What is deliberately not on the site (exams and scanned files shown as they are, held items, other students'
// courses) is not a gap.
import { listLectures, getContent, getCourse } from './store.js';
import { aiKindOk, bankOk } from './courses.js';
import { BANK_TARGET, bankProgress, bankState } from './practice.js';

const BANK_KINDS = ['lecture', 'tutorial', 'prep'];
let memo = { at: 0, value: null };

/** Computed at most once a minute (the heartbeat asks every few minutes; it reads each lesson's content). */
export function siteGaps() {
  if (Date.now() - memo.at < 60000 && memo.value) return memo.value;
  const lessons = [];
  const banks = { items: 0, behind: 0, have: 0, want: 0 };
  for (const l of listLectures()) {
    const kind = l.kind || 'lecture';
    const course = getCourse(l.courseId);
    if (l.status !== 'ready' || l.noAi || l.held || kind === 'prep' || kind === 'exam' || course?.ai === false) continue;
    const c = getContent(l.id);
    // What a lesson should have: nothing is expected of a tutorial (or a kind the course leaves out), but one that
    // already has its material still counts toward the question banks below.
    const missing = !aiKindOk(course, kind) ? [] : [
      !c?.summary && 'סיכום',
      kind !== 'homework' && !c?.notes && 'סיכום מובנה',
      !c?.quiz?.length && 'שאלות',
      kind !== 'homework' && !c?.flashcards?.length && 'כרטיסיות',
    ].filter(Boolean);
    if (missing.length) {
      lessons.push({ id: l.id, title: l.title || l.originalFile, course: getCourse(l.courseId)?.short || l.courseId, missing, error: l.aiError || l.notesError || null, since: l.updatedAt || l.createdAt || null });
    }
    if (BANK_KINDS.includes(kind) && c && bankOk(course)) {
      const have = (c.quiz?.length || 0) + (c.extraQuiz?.length || 0);
      banks.items++;
      banks.have += Math.min(have, BANK_TARGET);
      banks.want += BANK_TARGET;
      if (have < BANK_TARGET && !l.bankDone) banks.behind++;
    }
  }
  const value = { at: Date.now(), lessons, banks: { ...banks, target: BANK_TARGET, working: bankState().working, ...bankProgress() } };
  memo = { at: Date.now(), value };
  return value;
}
