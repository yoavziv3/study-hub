import { useCallback, useEffect, useRef, useState } from 'react';

// Cloud build (Cloudflare Pages): course material comes from pre-exported JSON under /data (served only to
// signed-in students of each course); the student's account, progress and Moodle data come from /api (Functions).
export const STATIC = import.meta.env.VITE_STATIC === '1';
export const LOCAL_ONLY = 'זמין רק באתר שרץ במחשב שלך';

/** Fired when the cloud answers 401 – the app then shows the sign-in screen. */
export const AUTH_EVENT = 'study-auth-required';

let searchIndex = null;
export const resetSearchIndex = () => { searchIndex = null; };

async function loadSearchIndex() {
  // One index file per course; the cloud only serves the student's own courses.
  const courses = await getJson('/data/courses.json');
  const parts = await Promise.all(courses.map((c) => getJson(`/data/search/${c.id}.json`).catch(() => [])));
  return parts.flat();
}

async function getJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) window.dispatchEvent(new Event(AUTH_EVENT));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || (res.status === 404 ? 'לא נמצא' : `שגיאה ${res.status}`));
  }
  return res.json();
}

async function staticSearch(q) {
  searchIndex ||= await loadSearchIndex();
  q = q.trim().toLowerCase();
  if (q.length < 2) return [];
  const snippet = (text) => {
    const i = text.toLowerCase().indexOf(q);
    const start = Math.max(0, i - 50);
    return (start ? '…' : '') + text.slice(start, i + q.length + 70).replace(/\s+/g, ' ') + '…';
  };
  const out = [];
  for (const e of searchIndex) {
    const hay = `${e.title} ${e.text}`.toLowerCase();
    if (!hay.includes(q)) continue;
    const score = e.type === 'lecture' ? 10 : e.type === 'topic' ? 8 : e.type === 'term' ? (e.title.toLowerCase().includes(q) ? 9 : 5) : e.type === 'note' ? (e.title.toLowerCase().includes(q) ? 8.5 : 6) : 3;
    out.push({ ...e, snippet: e.text ? snippet(e.text) : undefined, text: undefined, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 40);
}

const STATIC_ROUTES = [
  [/^\/api\/status$/, () => '/data/status.json'],
  [/^\/api\/courses$/, () => '/data/courses.json'],
  [/^\/api\/courses\/([\w-]+)$/, (m) => `/data/courses/${m[1]}.json`],
  [/^\/api\/courses\/([\w-]+)\/bundle$/, (m) => `/data/bundles/${m[1]}.json`],
  [/^\/api\/courses\/([\w-]+)\/links$/, (m) => `/data/links/${m[1]}.json`],
  [/^\/api\/lectures$/, () => '/data/lectures.json'],
  [/^\/api\/updates$/, () => '/data/updates.json'],
  [/^\/api\/lectures\/([\w-]+)$/, (m) => `/data/lectures/${m[1]}.json`],
];

// Served by the cloud Functions (accounts, progress, personal Moodle data) rather than by static files.
const CLOUD_API = /^\/api\/(auth|me|progress|reports|feedback|push)(\/|$)/;

async function staticRequest(method, url, body) {
  const [path, query = ''] = url.split('?');
  if (CLOUD_API.test(path)) return networkRequest(method, url, body);
  if (path === '/api/search') return staticSearch(new URLSearchParams(query).get('q') || '');
  if (path === '/api/moodle') return { connected: false, static: true, courses: [] };
  if (method !== 'GET') throw new Error(LOCAL_ONLY);
  for (const [re, to] of STATIC_ROUTES) {
    const m = path.match(re);
    if (m) return getJson(to(m));
  }
  throw new Error(LOCAL_ONLY);
}

async function request(method, url, body) {
  if (STATIC) return staticRequest(method, url, body);
  return networkRequest(method, url, body);
}

async function networkRequest(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (STATIC && res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event(AUTH_EVENT));
  if (!res.ok) {
    const err = new Error(data.error || `שגיאה ${res.status}`);
    err.status = res.status;
    err.relogin = !!data.relogin;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};

/** The original deck/PDF for download (in the cloud it sits behind the enrollment check). */
export const originalUrl = (lecture) => (STATIC ? `/data/orig/${lecture.id}/${lecture.originalFile}` : `/files/${lecture.id}/${lecture.originalFile}`);

/** A lecture's thumbnail for cards and lists (the cloud keeps one per lecture: the first slide). */
export const thumbUrl = (lecture, n = 1) => (STATIC ? lecture.thumb || null : lecture.hasPdf ? slideUrl(lecture.id, n, true) : null);

export const slideUrl = (lectureId, n, thumb = false) =>
  `/files/${lectureId}/slides/${thumb ? 't' : ''}${String(n).padStart(3, '0')}.jpg`;

/** Fetch JSON with optional polling while `shouldPoll(data)` is true. */
export function useFetch(url, { poll, interval = 1800 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef();

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const d = await api.get(url);
      setData(d);
      setError(null);
      clearTimeout(timer.current);
      if (poll && poll(d)) timer.current = setTimeout(load, interval);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    load();
    return () => clearTimeout(timer.current);
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

/** Stream a chat answer via SSE (POST). */
export async function streamChat(body, { onText, signal }) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!chunk.startsWith('data: ')) continue;
      const ev = JSON.parse(chunk.slice(6));
      if (ev.t) onText(ev.t);
      if (ev.error) throw new Error(ev.error);
    }
  }
}

export const STAGE_LABELS = {
  queued: 'בתור',
  converting: 'המרת המצגת',
  rendering: 'יצירת שקפים',
  extracting: 'חילוץ טקסט',
  classifying: 'זיהוי קורס',
  analyzing: 'ניתוח AI וכתיבת סיכום',
  ready: 'מוכן',
};
export const STAGE_ORDER = ['converting', 'rendering', 'extracting', 'classifying', 'analyzing', 'ready'];

export const hebLetters = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
