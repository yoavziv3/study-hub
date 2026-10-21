// The portal reader for an always-on machine in Israel – an old Android phone at home (Termux,
// scripts/deploy-portal-android.sh) or a VM (scripts/deploy-portal-vm.sh): every minute, one round of
// shared/portal-relay-core.js – the portal only answers from Israel. The Mac is its backup: the cloud hands the Mac
// nothing while this one has been seen in the last few minutes. The install scripts put the shared code next to
// this file (./shared). Settings: relay.env (CLOUD_URL, ADMIN_SECRET, SOURCE) and portal-key.json in this folder.
//   node run.mjs           – run forever (the service)
//   node run.mjs --ping    – can this machine reach the portal? (no sign-in involved)
//   node run.mjs --once    – one round, then exit
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { relayRound } from './shared/portal-relay-core.js';
import { ping } from './shared/portal-api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const EVERY = 60000;
const portalUrl = process.env.PORTAL_URL || undefined;

if (process.argv.includes('--ping')) {
  console.log(JSON.stringify(await ping(portalUrl)));
  process.exit(0);
}

const settings = Object.fromEntries(
  fs.readFileSync(path.join(here, 'relay.env'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
const { privateJwk } = JSON.parse(fs.readFileSync(path.join(here, 'portal-key.json'), 'utf8'));
const cloud = process.env.CLOUD_URL || settings.CLOUD_URL;
const secret = process.env.ADMIN_SECRET || settings.ADMIN_SECRET;
const source = (settings.SOURCE || 'relay').replace(/\W/g, '');

let failing = false;
async function round() {
  try {
    const r = await relayRound({ cloud, secret, privateJwk, source, portalUrl });
    if (failing) console.log('[portal] back to normal');
    failing = false;
    if (r.jobs) console.log(`[portal] ${JSON.stringify(r)}`);
  } catch (e) {
    // One line when the cloud can't be reached, not one a minute.
    if (!failing) console.error('[portal] round failed:', e.message);
    failing = true;
  }
}

await round();
if (!process.argv.includes('--once')) setInterval(round, EVERY);
