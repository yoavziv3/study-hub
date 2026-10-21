// The flashcard deck as the student sees it: the AI's cards (with the student's edits, minus the ones they hid)
// plus cards they wrote themselves. Keys stay stable: an AI card keeps the key of its original question, and a
// card of their own is keyed by its id – so editing a card never loses its review history.
import { cardKey } from '../store.jsx';

export const ownKey = (c) => `${c.lectureId}:c-${c.id}`;

/** cards: the AI's [{front, back, lectureId, lectureTitle?}]; lectures: [{id, title}] whose own cards are added. */
export function deckOf(cards, progress, lectures = []) {
  const edits = progress.cardEdits || {};
  const hidden = progress.cardHidden || {};
  const ai = cards
    .map((c) => {
      const key = c.key || cardKey(c.lectureId, c.front);
      const e = edits[key];
      return { ...c, key, ...(e && { front: e.front, back: e.back, edited: true }) };
    })
    .filter((c) => !hidden[c.key]);
  const titles = Object.fromEntries(lectures.map((l) => [l.id, l.title]));
  const own = (progress.customCards || [])
    .filter((c) => c.lectureId in titles)
    .map((c) => ({ front: c.front, back: c.back, lectureId: c.lectureId, lectureTitle: cards.some((x) => x.lectureTitle) ? titles[c.lectureId] : undefined, key: ownKey(c), customId: c.id }));
  return [...ai, ...own];
}
