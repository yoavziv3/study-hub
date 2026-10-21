// The Mac's part in reading students' BGU portal schedules: the backup of the always-on VM in Israel
// (oracle/portal-relay). Every minute it asks the cloud for due links; the cloud hands it none while the VM is
// running, so this only works when the VM is down or not set up. The reading itself is shared/portal-relay-core.js.
//
// Keys: portal-key.json (RSA-OAEP, created on first run, not in git). Its public half is PORTAL_PUBLIC_KEY in
// wrangler.toml (students' browsers seal their portal sign-in with it); the VM holds a copy of the private key
// (scripts/deploy-portal-vm.sh). Losing the key means every student reconnects their portal once.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './store.js';
import { relayRound as round } from '../../shared/portal-relay-core.js';

const CLOUD = (process.env.CLOUD_URL || '').replace(/\/$/, '');
const SECRET = process.env.STUDY_ADMIN_SECRET || '';
const PORTAL_URL = process.env.PORTAL_URL || undefined;
const KEY_FILE = path.join(ROOT, 'portal-key.json');
const EVERY = 60000;

const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

/** The key pair (created the first time). Returns { publicJwk, privateJwk }. */
export async function portalKey() {
  if (!fs.existsSync(KEY_FILE)) {
    const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
    const file = { publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
    await fsp.writeFile(KEY_FILE, JSON.stringify(file), { mode: 0o600 });
  }
  return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
}

let running = false;
let failing = false;

/** One round (exported for manual runs and local tests). */
export async function relayRound() {
  if (running) return;
  running = true;
  try {
    const { privateJwk } = await portalKey();
    await round({ cloud: CLOUD, secret: SECRET, privateJwk, source: 'mac', backup: true, portalUrl: PORTAL_URL });
    if (failing) console.log('[portal] back to normal');
    failing = false;
  } catch (e) {
    // One line when the cloud can't be reached, not one a minute.
    if (!failing) console.error('[portal] round failed:', e.message);
    failing = true;
  } finally {
    running = false;
  }
}

export async function startPortalRelay() {
  if (!CLOUD || SECRET.length < 32 || process.env.PORTAL_RELAY === '0') return;
  await portalKey(); // create the key pair on first run
  setTimeout(relayRound, 20000).unref?.();
  setInterval(relayRound, EVERY).unref?.();
}
