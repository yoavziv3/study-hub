// Web Push (RFC 8030) with VAPID (RFC 8292) and message encryption (RFC 8291, aes128gcm) – plain WebCrypto, so
// it runs in Cloudflare's runtime without libraries. Keys: VAPID_PUBLIC_KEY (var, base64url of the 65-byte point)
// and VAPID_PRIVATE_KEY (secret, base64url of the 32-byte private scalar). Generate with scripts/vapid-keys.js.

const enc = new TextEncoder();
export const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

export const pushConfigured = (env) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

let signingKey = null;
function vapidKey(env) {
  const pub = unb64u(env.VAPID_PUBLIC_KEY);
  signingKey ||= crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  ).catch((e) => { signingKey = null; throw e; });
  return signingKey;
}

// One signed token per push service, reused for an hour.
const jwts = new Map();
async function vapidJwt(env, audience) {
  const hit = jwts.get(audience);
  if (hit && hit.until > Date.now()) return hit.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: env.VAPID_SUBJECT || 'https://study-hub-git.pages.dev' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), enc.encode(`${head}.${body}`));
  const token = `${head}.${body}.${b64u(sig)}`;
  jwts.set(audience, { token, until: Date.now() + 3600000 });
  return token;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** The encrypted body for one subscription (a single aes128gcm record). */
export async function encryptPayload(text, p256dh, auth) {
  const ua = unb64u(p256dh);
  const secret = unb64u(auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(secret, shared, concat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(text), new Uint8Array([2]))));
  const header = new Uint8Array(21 + asPub.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPub.length;
  header.set(asPub, 21);
  return concat(header, sealed);
}

/** Push services the site sends to (anything else is refused when subscribing). */
export const PUSH_HOST = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[\w-]+(\.[\w-]+)*\.push\.apple\.com|[\w-]+(\.[\w-]+)*\.notify\.windows\.com)\//;

/** Send one notification. Returns the push service's status: 201 = delivered, 404/410 = subscription is gone. */
export async function sendPush(env, sub, data, { ttl = 6 * 3600, urgency = 'normal' } = {}) {
  if (!PUSH_HOST.test(sub.endpoint)) return 410;
  const jwt = await vapidJwt(env, new URL(sub.endpoint).origin);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body: await encryptPayload(JSON.stringify(data), sub.p256dh, sub.auth),
  });
  return res.status;
}
