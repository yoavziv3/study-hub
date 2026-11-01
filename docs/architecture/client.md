# Client notes

- Flashcards use Anki-style SM-2 scheduling in `client/src/lib/srs.js`; old Leitner cards (`{box, due}`) are converted on read, and `box` is still written because `lib/exam.js` and `Home.jsx` count it.
- The deck a student sees is built by `deckOf` in `client/src/lib/cards.js`: AI cards keep the key of their original question even when edited (`progress.cardEdits`), hidden ones are dropped (`cardHidden`), and the student's own cards (`customCards`) are keyed `${lectureId}:c-${id}`. Anything that looks up a card's progress must go through these keys.
- `progress` is one blob saved whole on every change: anything that writes automatically (timers, effects) must wait for `progressLoaded`, or it overwrites the saved progress with the empty default.

- **`/guide` ("איך משתמשים", `client/src/pages/Guide.jsx`)** explains each part of the site – install on a phone/iPad, the home page, updates and notifications, connecting the timetable to the portal (`/guide#portal`, linked from the portal card), the timetable, exam schedule, course and lesson tabs, review, grades, weekly report, search/timer, archive, privacy; entries marked `owner` (the committee page, system status) show only to the owner. Keep it in step when a feature changes. The first-sign-in tour (`Onboarding.jsx`) ends with a step that opens it.
- The unread badge (`unread` in `store.jsx`) counts only what the updates page shows: `isOtherGroups` (`lib/otherGroups.js`, also used by `Updates.jsx`) removes news about other groups (for the owner: other than the cohort's), so the bell never shows a number for items hidden behind "הצגת הודעות לקבוצות אחרות".
- `client/src/store.jsx` holds app-wide state (signed-in student in the cloud, progress with Leitner flashcard scheduling, courses, updates, toasts). Progress is one JSON blob: `PUT /api/progress` locally, per-user D1 row in the cloud.
- Interactive per-course "labs" are registered in `client/src/labs/index.js`.
- `client/public/sw.js` is a service worker; `_headers` (written by `build-static.js`) sets it to `no-cache`.
