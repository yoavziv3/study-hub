// Reads students' BGU portal schedules for the cloud site. The portal's firewall blocks Cloudflare's servers but
// answers from Israel, so this Mac does it: every minute it asks the cloud which links are due, opens each sealed
// sign-in with its private key (only when the portal session ended), reads the schedule and sends back the lessons.
//
// Keys: portal-key.json (RSA-OAEP, created on first run, never leaves this Mac – not in git). Its public half goes
// to the cloud as PORTAL_PUBLIC_KEY (wrangler.toml), which the students' browsers seal their sign-in with.
// Portal sessions: portal-sessions.json (also local only), so a password is opened only when a session ends.
// Losing portal-key.json means every student reconnects their portal once.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './store.js';
import { login, fetchSchedule, parseSchedule, PortalError } from '../../shared/portal-api.js';

const CLOUD = (process.env.CLOUD_URL || '').replace(/\/$/, '');
const SECRET = process.env.STUDY_ADMIN_SECRET || '';
const PORTAL_URL = process.env.PORTAL_URL || undefined;
const KEY_FILE = path.join(ROOT, 'portal-key.json');
const SESSIONS_FILE = path.join(ROOT, 'portal-sessions.json');
const EVERY = 60000;
const BACKOFF = 20 * 60000; // after a failed read, wait before trying that student again (no hammering the portal)
const failedAt = new Map(); // userId → { at, sealed }

const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

/** The Mac's key pair (created the first time). Returns { publicJwk, privateKey }. */
export async function portalKey() {
  if (!fs.existsSync(KEY_FILE)) {
    const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
    const file = { publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
    await fsp.writeFile(KEY_FILE, JSON.stringify(file), { mode: 0o600 });
  }
  const { publicJwk, privateJwk } = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  return { publicJwk, privateKey: await crypto.subtle.importKey('jwk', privateJwk, RSA, false, ['decrypt']) };
}

async function openSealed(privateKey, sealed) {
  const bytes = Uint8Array.from(Buffer.from(sealed, 'base64'));
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt(RSA, privateKey, bytes)));
}

const loadSessions = () => {
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch { return {}; }
};
const saveSessions = (s) => fsp.writeFile(SESSIONS_FILE, JSON.stringify(s), { mode: 0o600 });

async function admin(pathname, init = {}) {
  const res = await fetch(`${CLOUD}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${SECRET}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`הענן החזיר ${res.status}`);
  return res.json();
}

/** One student's read. Never logs the sign-in; a wrong one is reported once and not tried again. */
async function readOne(job, privateKey, sessions) {
  const key = String(job.userId);
  // A new sealed sign-in (the student reconnected) starts a new session.
  if (sessions[key]?.sealed !== job.sealed.slice(0, 32)) delete sessions[key];
  let session = sessions[key]?.session;
  let page = session ? await fetchSchedule(PORTAL_URL, session) : { days: null };
  if (!page.days) {
    const creds = await openSealed(privateKey, job.sealed);
    session = await login(PORTAL_URL, creds);
    sessions[key] = { session, sealed: job.sealed.slice(0, 32) };
    page = await fetchSchedule(PORTAL_URL, session);
    if (!page.days) throw new PortalError(`הפורטל לא החזיר את מערכת השעות (${page.why})`);
  }
  return parseSchedule(page.days);
}

let running = false;
let failing = false;

/** One round: read every due link. Exported for manual runs and local tests. */
export async function relayRound() {
  if (running) return;
  running = true;
  try {
    const jobs = await admin('/api/admin/portal/jobs');
    if (failing) console.log('[portal] back to normal');
    failing = false;
    if (!jobs.length) return;
    const { privateKey } = await portalKey();
    const sessions = loadSessions();
    for (const job of jobs) {
      const failed = failedAt.get(job.userId);
      if (failed && failed.sealed === job.sealed && Date.now() - failed.at < BACKOFF) continue;
      let result;
      try {
        result = { userId: job.userId, ok: true, lessons: await readOne(job, privateKey, sessions) };
        failedAt.delete(job.userId);
      } catch (e) {
        if (e instanceof PortalError && e.badLogin) delete sessions[String(job.userId)];
        result = { userId: job.userId, ok: false, badLogin: e instanceof PortalError && e.badLogin, error: e instanceof PortalError ? e.message : 'הקריאה מהפורטל נכשלה' };
        failedAt.set(job.userId, { at: Date.now(), sealed: job.sealed });
        console.error(`[portal] student ${job.userId}: ${result.error}`);
      }
      await admin('/api/admin/portal/result', { method: 'POST', body: JSON.stringify(result) });
    }
    await saveSessions(sessions);
  } catch (e) {
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
