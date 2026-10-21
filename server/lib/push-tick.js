// Phone notifications are sent by the cloud site, triggered every 5 minutes by a Cloudflare cron Worker
// (workers/push-cron). This Mac is the backup: it knocks too, and the cloud skips its ticks while the Worker runs.
// Needs CLOUD_URL and STUDY_ADMIN_SECRET in .env, like the rest of the admin channel.
const CLOUD = (process.env.CLOUD_URL || '').replace(/\/$/, '');
const SECRET = process.env.STUDY_ADMIN_SECRET || '';
const EVERY = 5 * 60000;

let failing = false;

async function tick() {
  try {
    const res = await fetch(`${CLOUD}/api/admin/push/tick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'mac', backup: true }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = await res.json();
    if (failing) console.log('[push] back to normal');
    failing = false;
    if (r.sent) console.log(`[push] sent ${r.sent} notifications (the cron Worker was not running)`);
  } catch (e) {
    // One line when it starts failing (cloud down, no network), not one every 5 minutes.
    if (!failing) console.error('[push] tick failed:', e.message);
    failing = true;
  }
}

export function startPushTicks() {
  if (!CLOUD || SECRET.length < 32 || process.env.PUSH_TICK === '0') return;
  setTimeout(tick, 30000).unref?.();
  setInterval(tick, EVERY).unref?.();
}
