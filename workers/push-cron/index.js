// Cloudflare Worker with a Cron Trigger: every 5 minutes it asks the cloud site to send the phone notifications
// that are due (cloud/lib/notify.js), so they keep coming when the Mac is off. Deploy: npm run deploy:cron.
// Secret: ADMIN_SECRET – the same value as the Pages project's ADMIN_SECRET (STUDY_ADMIN_SECRET in the Mac's .env).

async function tick(env) {
  const res = await fetch(`${env.SITE_URL}/api/admin/push/tick`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ADMIN_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'cron' }),
  });
  const text = await res.text();
  // A failed run shows up as an error in the Worker's cron logs (dashboard → Workers → study-hub-push-cron).
  if (!res.ok) throw new Error(`tick failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  console.log(text);
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
  // No public page: the Worker only runs on its schedule.
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
