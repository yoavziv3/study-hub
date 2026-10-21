# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"מחברת" (Study Hub): a personal study site for a BGU semester (Hebrew, RTL UI). Lecture decks (PDF/PPTX) are converted to slides, then analysed by Claude into summaries, topics, quizzes, flashcards, glossary and notes. It also syncs with BGU Moodle (new material, announcements, deadlines, grades) and the public BGU course catalog (class groups, exam dates).

All user-facing strings are Hebrew; code and comments are English. Code commits use English messages; `עדכון תוכן: …` commits are made automatically by the server (see Auto-publish).

## Commands

```bash
npm run dev            # Express server on :5180 (node --watch) + Vite on :5173 (proxies /api and /files to :5180)
npm start              # vite build → dist/, then serve everything from the Express server on :5180
npm run build          # client only → dist/
npm run build:static   # cloud build → dist-cloud/ (client with VITE_STATIC=1 + exported data JSON)
node scripts/serve-cloud.js   # static preview of dist-cloud on :5190 (no Functions, so no sign-in / /api)
npm run seed [dir]     # import the first lectures with hand-written content from seed/content/ (default ~/Downloads)
```

Node 22 (`.node-version`). There is no test suite, linter or formatter.

On the owner's Mac the server runs permanently from a LaunchAgent (`com.studyhub.server`, log in `logs/server.log`), so port 5180 is usually already taken. After code changes, rebuild and restart it:

```bash
npx vite build && launchctl kickstart -k gui/$(id -u)/com.studyhub.server
```

Useful env vars (`.env`, see `.env.example`): `AI_PROVIDER=api|cli`, `AI_MODEL`, `ANTHROPIC_API_KEY`, `PORT`, `HOST`, `STUDY_DATA_DIR` (alternate data dir for testing), `NO_INBOX=1` (don't watch `inbox/`), `AUTO_PUBLISH=0` (don't git-push data), `MOODLE_URL`, `CLOUD_URL`, `STUDY_ADMIN_SECRET`. For local end-to-end tests of Moodle flows, `scripts/dev/mock-moodle.mjs` is a mock Moodle web service (fictional test users) to point `MOODLE_URL` at.

## Architecture

### Two deployments, one client

1. **Local server (the Mac)** — `server/index.js` (Express 5). Full feature set: upload, ingest pipeline, AI chat/practice generation, Moodle sync, catalog sync, updates/notifications, backups. Binds to `127.0.0.1` and rejects non-localhost `Host` headers and cross-site state-changing requests.
2. **Cloud site (Cloudflare Pages, `study-hub-git`)** — built from GitHub `main` with `npm run build:static`. Course material is pre-exported static JSON under `/data/*`; students sign in with their Moodle credentials. Only `/api/*` and `/data/*` run Functions (`_routes.json`):
   - `functions/api/[[route]].js` → `cloud/api.js`: auth, per-student progress/settings/deadlines/grades, ICS calendar feed, reports, and the `/api/admin/*` channel used by the Mac (Bearer `ADMIN_SECRET`).
   - `functions/data/[[path]].js` → `cloud/gate.js`: serves `/data/*` only to students enrolled in the course (filters lists, 403s other courses' files).
   - D1 database `DB`; schema is created lazily in `cloud/lib/db.js` (no migrations). Secrets `TOKEN_KEY` (encrypts Moodle tokens) and `ADMIN_SECRET` are Pages secrets; local values in `.dev.vars` for `wrangler pages dev`.

The client (`client/src`, React 19 + react-router + Vite, root is `client/`) is the same for both. `STATIC = import.meta.env.VITE_STATIC === '1'` in `client/src/api.js` switches it: in static mode `api.get('/api/…')` is rewritten via `STATIC_ROUTES` to `/data/….json`, search runs in the browser over per-course indexes, `CLOUD_API` paths go to the Functions, and anything else throws `LOCAL_ONLY`. **A new read endpoint that should also work in the cloud needs three changes:** export the data in `scripts/build-static.js`, map it in `STATIC_ROUTES`, and allow it in `cloud/gate.js`.

### Data model (`data/`, committed — it is the source of the cloud build)

- `data/courses.json` — courses. `DEFAULT_COURSES` in `server/lib/courses.js` is merged in on read (missing ones are appended); courses can also be created from Moodle enrollments, and `server/lib/catalog.js` adds `classes`/`exams` from the BGU catalog. Course `keywords`/`code` drive automatic course detection of uploads.
- `data/lectures/<courseId>-<rand>/` — one dir per item (`kind`: lecture | tutorial | homework | exam): `meta.json` (status, stage, numbering, `originalFile`), `slides.json` (per-slide text), `content.json` (AI or seed study content, shape defined by `LECTURE_SCHEMA`/`NOTES_SCHEMA` in `server/lib/prompts.js`), the original file, `deck.pdf` for PPTX, and `slides/*.jpg`. Only `slides/t001.jpg` is committed; the cloud renders slides from the PDF in the browser (pdf.js) and falls back to images only for decks over the 25 MiB asset limit.
- `data/updates.json` (feed, deadlines), `data/links/`, `data/practice/`.
- `shared/` holds code used by both the client and the cloud/Mac (group detection, the portal API client).
- Course `grading` (components, weights, "מגן" shields, min exam grade, notes) is extracted by AI in `server/lib/syllabus.js` during the catalog sync: from the public syllabus page the catalog links to, else a syllabus PDF on Moodle, else the opening lectures' slides. Re-read only when the source text's hash changes; the grades page's exam calculator starts from it.
- Private, never committed: `data/moodle.json` (Moodle token), `data/progress.json`, `data/reports.json`, `backups/`, `.env`, `.dev.vars`.

All reads/writes go through `server/lib/store.js` (atomic tmp+rename writes). Scripts in `scripts/` import it directly.

### Ingest pipeline (`server/lib/ingest.js`)

Files arrive via upload (`/api/upload`), the watched `inbox/` folder (`inbox/<courseId>/` forces the course; processed files move to `inbox/נקלטו/`), or Moodle sync. A single in-process queue runs stages `converting → rendering → extracting → classifying → analyzing → ready` (`STAGES`; labels mirrored in client `STAGE_LABELS`). Conversion uses Microsoft PowerPoint (AppleScript) or LibreOffice `soffice` for PPTX, poppler `pdftoppm`/`pdftotext` for rendering/text (`server/lib/extract.js`). Kind and lesson number are inferred from file names with the regexes at the top of `ingest.js`. Unfinished items resume on startup (`resumePending`).

### AI (`server/lib/ai.js`)

`generateJSON` (structured output against a JSON schema) and `chatStream` (SSE to the client via `/api/chat`). Provider is `api` (Anthropic SDK, needs `ANTHROPIC_API_KEY`) or `cli` (spawns the local `claude` binary headless with no tools/settings, using the owner's login) — `cli` is the default when no key is set. All prompts and schemas live in `server/lib/prompts.js`. AI is unavailable in the cloud build.

### Auto-publish (`server/lib/publish.js`)

Every store write of published data calls `schedulePublish(label)`. After 2 quiet minutes (and once nothing is processing) the server commits **only** the data paths (`data/lectures`, `data/courses.json`, `data/practice`, `data/updates.json`, `data/links`), runs `git pull --rebase --autostash`, and pushes to `origin` — which redeploys Cloudflare. Code changes in the working tree are left alone, but expect these commits to appear on `main` while the server runs; set `AUTO_PUBLISH=0` when experimenting with data.

### Moodle and the admin channel (`server/lib/moodle.js`)

Uses the Moodle mobile web-service API. The Mac syncs its own courses with its token, and syncs other students' courses through the cloud's `/api/admin/moodle` proxy (`remoteRest`), so students' tokens never leave Cloudflare. That requires `CLOUD_URL` and a `STUDY_ADMIN_SECRET` of at least 32 chars matching the cloud's `ADMIN_SECRET`. Weekly backups of the D1 data come through `/api/admin/backup` (`server/lib/backup.js`); restore with `scripts/restore-backup.js` → `wrangler d1 execute study-hub --remote --file …`.

### Phone notifications (cloud only)

Web Push is implemented with plain WebCrypto in `cloud/lib/webpush.js` (VAPID + aes128gcm); `cloud/lib/notify.js` decides what is due (deadlines, exam tomorrow, due flashcards, class in 15 minutes, room change of the student's group) and dedupes via the `push_sent` table. Pages Functions have no cron, so a separate Cloudflare Worker (`workers/push-cron`, deployed with `npm run deploy:cron`, secret `ADMIN_SECRET`) POSTs `/api/admin/push/tick` every 5 minutes. The Mac's `server/lib/push-tick.js` ticks too as a backup (`{ backup: true }`); the cloud skips those while the Worker has ticked in the last 8 minutes (`push_meta` table), so the two never race. Keys: `VAPID_PUBLIC_KEY` in `wrangler.toml`, `VAPID_PRIVATE_KEY` as a Pages secret (generate with `node scripts/vapid-keys.js`). Students' per-kind preferences live in their progress blob (`progress.notify`). For local cloud testing, the `mock-moodle` and `cloud-dev` (`wrangler pages dev`) launch configs work together (`.dev.vars` points `MOODLE_URL` at the mock).

### BGU student portal (each student's real groups and room changes)

The portal (portal.bgu.ac.il) is the only per-student source of groups and timetable — Moodle has neither (no groups in academic courses, merged "01" course codes, no timetable events). Its firewall (AWS CloudFront) blocks Cloudflare's servers and answers only from Israel, so the **Mac** reads it: `server/lib/portal-relay.js` polls `/api/admin/portal/jobs` every minute, signs in when needed (`shared/portal-api.js`: `StandardLogin` → bearer token + the cookies it sets → `umbraco/Surface/MainPortalSurface/GetPageData` with `pageUrl: 'academy/schedule-and-courses'` → the `StudentCoursesAndScheduleBlockList` block's `scheduleByDays`; `Portal/Api/Home/Index` is only the home page), and posts the lessons to `/api/admin/portal/result`. The student's sign-in (username, password, ID) is sealed in their browser with the Mac's RSA-OAEP public key (`PORTAL_PUBLIC_KEY` in `wrangler.toml`; private key in `portal-key.json`, created by `node scripts/portal-key.js`, not in git) — the cloud stores it in `portal_links` but can't open it. A failed sign-in sets `ok = 0` and is never retried. The cloud derives the student's groups from the lessons (`shared/groups.js` `groupsFromPortal`: day/time, then room numbers, then BGU numbering — tutorial 21 belongs to lecture 2); those groups override hand-picked ones in notifications, and the timetable page copies them into `progress.classGroups`. `forOtherGroups` (same file) drops course announcements aimed at other groups, both from phone notifications and (hidden by default) from the updates feed. A wrong portal password must not return HTTP 401 — the client treats 401 as "signed out of this site". Local tests: `mock-portal` launch config, `PORTAL_URL` in `.dev.vars`, and a relay run with `CLOUD_URL=http://localhost:8788`.

### Client notes

- Flashcards use Anki-style SM-2 scheduling in `client/src/lib/srs.js`; old Leitner cards (`{box, due}`) are converted on read, and `box` is still written because `lib/exam.js` and `Home.jsx` count it.
- The deck a student sees is built by `deckOf` in `client/src/lib/cards.js`: AI cards keep the key of their original question even when edited (`progress.cardEdits`), hidden ones are dropped (`cardHidden`), and the student's own cards (`customCards`) are keyed `${lectureId}:c-${id}`. Anything that looks up a card's progress must go through these keys.
- `progress` is one blob saved whole on every change: anything that writes automatically (timers, effects) must wait for `progressLoaded`, or it overwrites the saved progress with the empty default.

- `client/src/store.jsx` holds app-wide state (signed-in student in the cloud, progress with Leitner flashcard scheduling, courses, updates, toasts). Progress is one JSON blob: `PUT /api/progress` locally, per-user D1 row in the cloud.
- Interactive per-course "labs" are registered in `client/src/labs/index.js`.
- `client/public/sw.js` is a service worker; `_headers` (written by `build-static.js`) sets it to `no-cache`.
