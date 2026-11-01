# Auto-publish (`server/lib/publish.js`)

Every store write of published data calls `schedulePublish(label)`. After 2 quiet minutes (and once nothing is processing) the server commits **only** the data paths (`data/lectures`, `data/courses.json`, `data/practice`, `data/updates.json`, `data/links`), runs `git pull --rebase --autostash`, and pushes to `origin` — which redeploys Cloudflare. Code changes in the working tree are left alone, but expect these commits to appear on `main` while the server runs; set `AUTO_PUBLISH=0` when experimenting with data.
