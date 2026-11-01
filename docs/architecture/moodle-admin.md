# Moodle and the admin channel (`server/lib/moodle.js`)

Uses the Moodle mobile web-service API. The Mac syncs its own courses with its token, and syncs other students' courses through the cloud's `/api/admin/moodle` proxy (`remoteRest`), so students' tokens never leave Cloudflare. That requires `CLOUD_URL` and a `STUDY_ADMIN_SECRET` of at least 32 chars matching the cloud's `ADMIN_SECRET`. Weekly backups of the D1 data come through `/api/admin/backup` (`server/lib/backup.js`); restore with `scripts/restore-backup.js` → `wrangler d1 execute study-hub --remote --file …`.
