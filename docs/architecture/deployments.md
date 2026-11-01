# Two deployments, one client

1. **Local server (the Mac)** — `server/index.js` (Express 5). Full feature set: upload, ingest pipeline, AI chat/practice generation, Moodle sync, catalog sync, updates/notifications, backups. Binds to `127.0.0.1` and rejects non-localhost `Host` headers and cross-site state-changing requests.
2. **Cloud site (Cloudflare Pages, `study-hub-git`)** — built from GitHub `main` with `npm run build:static`. Course material is pre-exported static JSON under `/data/*`; students sign in with their Moodle credentials. Only `/api/*` and `/data/*` run Functions (`_routes.json`):
   - `functions/api/[[route]].js` → `cloud/api.js`: auth, per-student progress/settings/deadlines/grades, ICS calendar feed, reports, and the `/api/admin/*` channel used by the Mac (Bearer `ADMIN_SECRET`).
   - `functions/data/[[path]].js` → `cloud/gate.js`: serves `/data/*` only to students enrolled in the course (filters lists, 403s other courses' files).
   - D1 database `DB`; schema is created lazily in `cloud/lib/db.js` (no migrations). Secrets `TOKEN_KEY` (encrypts Moodle tokens) and `ADMIN_SECRET` are Pages secrets; local values in `.dev.vars` for `wrangler pages dev`.

The client (`client/src`, React 19 + react-router + Vite, root is `client/`) is the same for both. `STATIC = import.meta.env.VITE_STATIC === '1'` in `client/src/api.js` switches it: in static mode `api.get('/api/…')` is rewritten via `STATIC_ROUTES` to `/data/….json`, search runs in the browser over per-course indexes, `CLOUD_API` paths go to the Functions, and anything else throws `LOCAL_ONLY`. **A new read endpoint that should also work in the cloud needs three changes:** export the data in `scripts/build-static.js`, map it in `STATIC_ROUTES`, and allow it in `cloud/gate.js`.
