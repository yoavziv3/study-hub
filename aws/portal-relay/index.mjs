// AWS Lambda in Tel Aviv (il-central-1) that reads students' BGU portal schedules for the cloud site – the portal
// only answers from Israel. Runs every minute (EventBridge Scheduler); the Mac is its backup. The reading is
// shared/portal-relay-core.js; scripts/deploy-portal-lambda.sh packs it next to this file (as ./shared) and deploys.
// Settings: CLOUD_URL, ADMIN_SECRET (same as the Pages project's), PORTAL_PRIVATE_KEY (the key pair's private JWK).
import { relayRound } from './shared/portal-relay-core.js';
import { ping } from './shared/portal-api.js';

const privateJwk = JSON.parse(process.env.PORTAL_PRIVATE_KEY || '{}');

export const handler = async (event = {}) => {
  // { "ping": true }: can this function reach the portal at all? (no sign-in involved)
  if (event.ping) return ping(process.env.PORTAL_URL);
  const result = await relayRound({
    cloud: process.env.CLOUD_URL,
    secret: process.env.ADMIN_SECRET,
    privateJwk,
    source: 'lambda',
    portalUrl: process.env.PORTAL_URL || undefined,
  });
  if (result.jobs) console.log(JSON.stringify(result));
  return result;
};
