// Spaced repetition for flashcards, the way Anki schedules them (SM-2): four answers – again, hard, good, easy –
// a per-card ease factor, short learning steps in minutes for new or forgotten cards, and growing intervals in days.
// Cards graded with the old two-button Leitner boxes ({ box, due }) are read as review cards with the box's interval,
// so nobody's progress is lost. `box` is still written (derived from the interval) for the places that count it.

const MIN = 60000;
const DAY = 86400000;
const LEITNER_DAYS = [0, 1, 2, 4, 8, 16];
const START_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_DAYS = 365;

export const GRADES = [
  { id: 'again', label: 'שוב', key: '1', cls: 'bad' },
  { id: 'hard', label: 'קשה', key: '2', cls: 'warn' },
  { id: 'good', label: 'טוב', key: '3', cls: 'good' },
  { id: 'easy', label: 'קל', key: '4', cls: 'c' },
];

/** Interval in days → the old box number (0 = new / learning … 5 = three weeks and more). */
const boxOf = (ivl) => (ivl < 1 ? 0 : ivl < 2 ? 1 : ivl < 4 ? 2 : ivl < 8 ? 3 : ivl < 21 ? 4 : 5);

/** A stored card in the current shape (old Leitner cards are converted on the fly). */
export function normalize(c) {
  if (!c) return { ivl: 0, ease: START_EASE, reps: 0, lapses: 0, due: 0, isNew: true };
  if (c.ease) return c;
  return { ...c, ivl: LEITNER_DAYS[c.box || 0] || 0, ease: START_EASE, reps: c.box || 0, lapses: 0 };
}

// A little randomness on longer intervals, so cards learned together don't all come back on the same day.
const fuzz = (days) => (days < 3 ? days : Math.round(days * (0.95 + Math.random() * 0.1)));

/** Next state after answering `grade`. Returns the card plus `requeue` when it should come back in this session. */
export function schedule(stored, grade, now = Date.now(), { exact = false } = {}) {
  const c = { ...normalize(stored) };
  delete c.isNew;
  let wait; // ms until due
  if (c.ivl < 1) {
    // Learning (new, or forgotten and relearning): minutes until it graduates to days.
    const relearn = c.lapses > 0;
    if (grade === 'again') wait = MIN;
    else if (grade === 'hard') wait = 6 * MIN;
    else if (grade === 'good') { c.ivl = 1; wait = DAY; }
    else { c.ivl = relearn ? 2 : 4; c.ease += 0.15; wait = c.ivl * DAY; }
  } else {
    const late = Math.max(0, (now - (c.due || now)) / DAY);
    const ivl = c.ivl;
    if (grade === 'again') {
      c.lapses += 1;
      c.ease = Math.max(MIN_EASE, c.ease - 0.2);
      c.ivl = 0;
      wait = 10 * MIN;
    } else if (grade === 'hard') {
      c.ease = Math.max(MIN_EASE, c.ease - 0.15);
      c.ivl = Math.max(ivl + 1, Math.round(ivl * 1.2));
    } else if (grade === 'good') {
      c.ivl = Math.max(ivl + 1, Math.round((ivl + late / 2) * c.ease));
    } else {
      c.ease += 0.15;
      c.ivl = Math.max(Math.round((ivl + late / 2) * c.ease) + 1, Math.round((ivl + late) * c.ease * 1.3));
    }
    if (c.ivl >= 1) {
      c.ivl = Math.min(MAX_DAYS, exact ? c.ivl : fuzz(c.ivl));
      wait = c.ivl * DAY;
    }
  }
  c.ease = Math.round(c.ease * 100) / 100;
  c.reps += 1;
  c.due = now + wait;
  c.seen = now;
  c.box = boxOf(c.ivl);
  return { card: c, requeue: c.ivl < 1 };
}

/** "1 דק׳", "10 דק׳", "יום", "4 ימים", "3 חודשים" – shown on each answer button, like Anki. */
export function waitLabel(ms) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} דק׳`;
  const d = Math.round(ms / DAY);
  if (d <= 1) return 'יום';
  if (d === 2) return 'יומיים';
  if (d < 30) return `${d} ימים`;
  const mo = Math.round(d / 30);
  if (mo < 12) return mo === 1 ? 'חודש' : mo === 2 ? 'חודשיים' : `${mo} חודשים`;
  return 'שנה';
}

/** What each answer would do to this card right now (no fuzz, for the button labels). */
export function previews(stored, now = Date.now()) {
  const out = {};
  for (const g of GRADES) out[g.id] = waitLabel(schedule(stored, g.id, now, { exact: true }).card.due - now);
  return out;
}

/** new | learning | young (under three weeks) | mature – the four counters under the deck. */
export function stageOf(stored) {
  if (!stored) return 'new';
  const c = normalize(stored);
  if (c.ivl < 1) return 'learning';
  return c.ivl < 21 ? 'young' : 'mature';
}

export const STAGE_LABEL = { new: 'חדשות', learning: 'בלמידה', young: 'צעירות', mature: 'מושרשות' };
export const STAGE_ONE = { new: 'חדשה', learning: 'בלמידה', young: 'צעירה', mature: 'מושרשת' };

/** Cards the student keeps forgetting: lapsed twice or more, or answered "again" / "hard" enough to drop the ease. */
export const isHard = (stored) => !!stored?.ease && (stored.lapses >= 2 || stored.ease <= 2.05);
