# Data model (`data/`, committed — it is the source of the cloud build)

- `data/courses.json` — courses. `DEFAULT_COURSES` in `server/lib/courses.js` is merged in on read (missing ones are appended); courses can also be created from Moodle enrollments, and `server/lib/catalog.js` adds `classes`/`exams` from the BGU catalog. Course `keywords`/`code` drive automatic course detection of uploads.
- `data/lectures/<courseId>-<rand>/` — one dir per item (`kind`: lecture | tutorial | homework | exam): `meta.json` (status, stage, numbering, `originalFile`), `slides.json` (per-slide text), `content.json` (AI or seed study content, shape defined by `LECTURE_SCHEMA`/`NOTES_SCHEMA` in `server/lib/prompts.js`), the original file, `deck.pdf` for PPTX, and `slides/*.jpg`. Only `slides/t001.jpg` is committed; the cloud renders slides from the PDF in the browser (pdf.js) and falls back to images only for decks over the 25 MiB asset limit.
- `data/updates.json` (feed, deadlines), `data/links/`, `data/practice/`.
- `shared/` holds code used by both the client and the cloud/Mac (group detection, the portal API client).
- Course `grading` (components, weights, "מגן" shields, min exam grade, notes) is extracted by AI in `server/lib/syllabus.js` during the catalog sync: from the public syllabus page the catalog links to, else a syllabus PDF on Moodle, else the opening lectures' slides. Re-read only when the source text's hash changes; the grades page's exam calculator starts from it.
- Private, never committed: `data/moodle.json` (Moodle token), `data/progress.json`, `data/reports.json`, `backups/`, `.env`, `.dev.vars`.

All reads/writes go through `server/lib/store.js` (atomic tmp+rename writes). Scripts in `scripts/` import it directly.
