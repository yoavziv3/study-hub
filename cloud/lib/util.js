// Small helpers shared by the cloud (Cloudflare Pages Functions) code.

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });

export const fail = (status, error, extra = {}) => json({ error, ...extra }, status);

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const randomId = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

// Moodle tokens are stored encrypted (AES-GCM) with a key that lives only in the Cloudflare secret TOKEN_KEY.
let keyCache = null;
async function aesKey(env) {
  if (!env.TOKEN_KEY) throw new Error('TOKEN_KEY is not configured');
  keyCache ||= crypto.subtle.importKey('raw', unb64(env.TOKEN_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return keyCache;
}
export async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function decrypt(env, packed) {
  const [iv, ct] = String(packed || '').split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

export function safeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** JSON body of a state-changing request. Rejects cross-site form posts (they cannot send JSON without CORS). */
export async function readJson(request, maxBytes = 300_000) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) throw new HttpError(415, 'בקשה לא תקינה');
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'בקשה לא תקינה');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'הבקשה גדולה מדי');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new HttpError(400, 'בקשה לא תקינה');
  }
}

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
