import { useCallback, useEffect, useRef, useState } from 'react';

// Cloud build (Cloudflare Pages): no server – data comes from pre-exported JSON files, progress lives in the browser.
export const STATIC = import.meta.env.VITE_STATIC === '1';
export const LOCAL_ONLY = 'זמין רק באתר שרץ במחשב שלך';

const PROGRESS_KEY = 'study-progress';
let searchIndex = null;

async function staticSearch(q) {
  searchIndex ||= await (await fetch('/data/search.json')).json();
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
    const score = e.type === 'lecture' ? 10 : e.type === 'topic' ? 8 : e.type === 'term' ? (e.title.toLowerCase().includes(q) ? 9 : 5) : 3;
    out.push({ ...e, snippet: e.text ? snippet(e.text) : undefined, text: undefined, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 40);
}

const STATIC_ROUTES = [
  [/^\/api\/status$/, () => '/data/status.json'],
  [/^\/api\/courses$/, () => '/data/courses.json'],
  [/^\/api\/courses\/([\w-]+)$/, (m) => `/data/courses/${m[1]}.json`],
  [/^\/api\/courses\/([\w-]+)\/bundle$/, (m) => `/data/bundles/${m[1]}.json`],
  [/^\/api\/lectures$/, () => '/data/lectures.json'],
  [/^\/api\/updates$/, () => '/data/updates.json'],
  [/^\/api\/lectures\/([\w-]+)$/, (m) => `/data/lectures/${m[1]}.json`],
];

async function staticRequest(method, url, body) {
  const [path, query = ''] = url.split('?');
  if (path === '/api/progress') {
    if (method === 'GET') { try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch { return {}; } }
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(body)); } catch { /* storage unavailable */ }
    return { ok: true };
  }
  if (path === '/api/search') return staticSearch(new URLSearchParams(query).get('q') || '');
  if (path === '/api/moodle') return { connected: false, static: true, courses: [] };
  if (method !== 'GET') throw new Error(LOCAL_ONLY);
  for (const [re, to] of STATIC_ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    const res = await fetch(to(m));
    if (!res.ok) throw new Error(res.status === 404 ? 'לא נמצא' : `שגיאה ${res.status}`);
    return res.json();
  }
  throw new Error(LOCAL_ONLY);
}

async function request(method, url, body) {
  if (STATIC) return staticRequest(method, url, body);
  const res = await fetch(url, {
    method,
    headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `שגיאה ${res.status}`);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};

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
