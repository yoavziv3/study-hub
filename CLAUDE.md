# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"IEMprove" (formerly "מחברת", Study Hub): a personal study site for a BGU semester (Hebrew, RTL UI). Lecture decks (PDF/PPTX) are converted to slides, then analysed by Claude into summaries, topics, quizzes, flashcards, glossary and notes. It also syncs with BGU Moodle (new material, announcements, deadlines, grades) and the public BGU course catalog (class groups, exam dates).

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

The detail lives in `docs/architecture/`. **Read the matching file before working on that area** (they are not loaded automatically):

- `docs/architecture/deployments.md` — Two deployments, one client
- `docs/architecture/data-model.md` — Data model (`data/`, committed — it is the source of the cloud build)
- `docs/architecture/ingest.md` — Ingest pipeline (`server/lib/ingest.js`)
- `docs/architecture/notices.md` — Notices read by Claude (`server/lib/notices.js`)
- `docs/architecture/gaps.md` — What's missing on the site (`server/lib/gaps.js`)
- `docs/architecture/committee.md` — The degree committee's view (owner and committee members)
- `docs/architecture/student-files.md` — Students' own files (`/files`, cloud only)
- `docs/architecture/exams.md` — Exam schedule (`/exams`, `client/src/pages/Exams.jsx`)
- `docs/architecture/runlog-checks-weekly.md` — Run log, AI output checks, weekly report
- `docs/architecture/ai.md` — AI (`server/lib/ai.js`)
- `docs/architecture/publish.md` — Auto-publish (`server/lib/publish.js`)
- `docs/architecture/moodle-admin.md` — Moodle and the admin channel (`server/lib/moodle.js`)
- `docs/architecture/push.md` — Phone notifications (cloud only)
- `docs/architecture/system-status.md` — System status (owner only)
- `docs/architecture/portal.md` — BGU student portal (each student's real groups and room changes)
- `docs/architecture/client.md` — Client notes

Core facts: the client (`client/src`, React 19 + Vite) is shared by the local Express server (`server/index.js`, full features) and the Cloudflare Pages site (static `/data/*` + `/api/*` Functions, D1). All store reads/writes go through `server/lib/store.js`; data writes auto-publish to git (`AUTO_PUBLISH=0` to stop). All user-facing strings are Hebrew; new AI output must pass a check in `server/lib/checks.js`. Keep `/guide` (`Guide.jsx`) and the matching architecture file in step when a feature changes.
