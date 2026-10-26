// The student's own files in the cloud (cloud/lib/files.js): a file travels as base64 chunks, cut and rebuilt here.
import { api } from '../api.js';

export const CHUNK = 512 * 1024;
export const ACCEPT = '.pdf,.ppt,.pptx,.doc,.docx';
export const KIND_LABEL = { lecture: 'הרצאות', tutorial: 'תרגולים' };
export const KINDS = Object.keys(KIND_LABEL);

export const extOf = (name = '') => name.split('.').pop().toLowerCase();
export const isPdf = (f) => extOf(f.name) === 'pdf';
export const isAllowed = (name) => ['pdf', 'ppt', 'pptx', 'doc', 'docx'].includes(extOf(name));

export function formatSize(n = 0) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
}

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('לא הצלחתי לקרוא את הקובץ'));
    r.readAsDataURL(blob);
  });

const fromBase64 = (s) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Uploads `file` as a lecture or tutorial of a course; `onProgress` gets 0…1. Returns the saved file. */
export async function uploadPersonalFile(file, { courseId, kind, title }, onProgress = () => {}) {
  const chunks = Math.max(1, Math.ceil(file.size / CHUNK));
  const { id } = await api.post('/api/me/files', { courseId, kind, title, name: file.name, size: file.size, chunks });
  try {
    for (let n = 0; n < chunks; n++) {
      const data = await toBase64(file.slice(n * CHUNK, (n + 1) * CHUNK));
      await api.put(`/api/me/files/${id}/chunks/${n}`, { data });
      onProgress((n + 1) / chunks);
    }
    return (await api.post(`/api/me/files/${id}/done`, {})).file;
  } catch (e) {
    api.del(`/api/me/files/${id}`).catch(() => {});
    throw e;
  }
}

const blobs = new Map();

/** The file as a Blob (kept for the visit, so opening it again is instant). */
export function loadPersonalFile(f, onProgress = () => {}) {
  if (!blobs.has(f.id)) {
    const p = (async () => {
      const parts = [];
      for (let n = 0; n < f.chunks; n++) {
        parts.push(fromBase64((await api.get(`/api/me/files/${f.id}/chunks/${n}`)).data));
        onProgress((n + 1) / f.chunks);
      }
      return new Blob(parts, { type: f.type || 'application/octet-stream' });
    })();
    p.catch(() => blobs.delete(f.id));
    blobs.set(f.id, p);
  }
  return blobs.get(f.id);
}

export const forgetPersonalFile = (id) => blobs.delete(id);
export const forgetAllPersonalFiles = () => blobs.clear();

export async function downloadPersonalFile(f, onProgress) {
  const url = URL.createObjectURL(await loadPersonalFile(f, onProgress));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
