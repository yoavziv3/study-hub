// One round of reading students' BGU portal schedules for the cloud site – the same code on the always-on VM in
// Israel (oracle/portal-relay) and on the Mac (server/lib/portal-relay.js, the backup). The portal only answers
// from Israel, so neither Cloudflare nor anything abroad can do this.
//
// The cloud hands out the links that are due, each with the student's sign-in sealed for this key pair and the
// portal session from the last read (encrypted here, opaque to the cloud). The sign-in is opened only when that
// session ended. Each result goes back with the new session; a wrong sign-in is reported once and not tried again.
import { login, fetchSchedule, parseSchedule, PortalError } from './portal-api.js';

const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The private key (RSA, for sealed sign-ins) and a session key derived from it (AES, for stored sessions). */
export async function relayKeys(privateJwk) {
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, RSA, false, ['decrypt']);
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`portal-session:${privateJwk.d}`));
  const sessionKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { privateKey, sessionKey };
}

const openSealed = async (privateKey, sealed) => JSON.parse(dec.decode(await crypto.subtle.decrypt(RSA, privateKey, unb64(sealed))));

async function sealSession(sessionKey, session) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sessionKey, enc.encode(JSON.stringify(session)));
  return `${b64(iv)}.${b64(ct)}`;
}
async function openSession(sessionKey, packed) {
  if (!packed) return null;
  try {
    const [iv, ct] = packed.split('.');
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, sessionKey, unb64(ct))));
  } catch {
    return null; // made with another key, or damaged: sign in again
  }
}

/** One student's read: lessons plus the session to keep. */
async function readOne(job, keys, portalUrl) {
  let session = await openSession(keys.sessionKey, job.session);
  let page = session ? await fetchSchedule(portalUrl, session) : { days: null };
  if (!page.days) {
    session = await login(portalUrl, await openSealed(keys.privateKey, job.sealed));
    page = await fetchSchedule(portalUrl, session);
    if (!page.days) throw new PortalError(`הפורטל לא החזיר את מערכת השעות (${page.why})`);
  }
  return { lessons: parseSchedule(page.days), session };
}

/**
 * Reads every link the cloud says is due. source: the reader's name ('oracle', 'mac'); backup: the cloud hands a backup nothing while
 * the main reader has been seen in the last few minutes. Returns { jobs, read, failed }.
 */
export async function relayRound({ cloud, secret, privateJwk, source, backup = false, portalUrl, log = console }) {
  const admin = async (path, body) => {
    const res = await fetch(`${cloud.replace(/\/$/, '')}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`הענן החזיר ${res.status}`);
    return res.json();
  };
  const jobs = await admin(`/api/admin/portal/jobs?source=${encodeURIComponent(source)}${backup ? '&backup=1' : ''}`);
  const out = { jobs: jobs.length, read: 0, failed: 0 };
  if (!jobs.length) return out;
  const keys = await relayKeys(privateJwk);
  for (const job of jobs) {
    let result;
    try {
      const { lessons, session } = await readOne(job, keys, portalUrl);
      result = { userId: job.userId, ok: true, lessons, session: await sealSession(keys.sessionKey, session) };
      out.read++;
    } catch (e) {
      const known = e instanceof PortalError;
      result = { userId: job.userId, ok: false, badLogin: known && e.badLogin, error: known ? e.message : 'הקריאה מהפורטל נכשלה' };
      out.failed++;
      log.error(`[portal] student ${job.userId}: ${known ? e.message : e.message || e}`);
    }
    await admin('/api/admin/portal/result', result);
  }
  return out;
}
