// Model answers kept by what was asked: the same request – provider, model, instructions, prompt, schema and the
// bytes of every attached file – is never sent twice. A deck that comes back (re-uploaded, or the same file under
// another Moodle module) reuses its answer without a network call. Kept on this Mac in cache/ai/ (not in git);
// "regenerate" asks for a fresh answer (cache: false). Deleting the folder only costs repeat calls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = process.env.AI_CACHE_DIR || path.join(ROOT, 'cache', 'ai');

const fileHashes = new Map(); // path|size|mtime → sha256 (a deck is hashed once per change)
function hashFile(file) {
  const st = fs.statSync(file);
  const id = `${file}|${st.size}|${st.mtimeMs}`;
  if (!fileHashes.has(id)) fileHashes.set(id, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  return fileHashes.get(id);
}

export function cacheKey({ provider, model, system, prompt, schema, files = [] }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ provider, model, system, prompt, schema, files: files.filter(Boolean).map(hashFile) }))
    .digest('hex');
}

export function readCache(key) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${key}.json`), 'utf8')).value;
  } catch {
    return null;
  }
}

export function writeCache(key, value, meta = {}) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = path.join(DIR, `${key}.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ at: new Date().toISOString(), ...meta, value }));
    fs.renameSync(tmp, path.join(DIR, `${key}.json`));
  } catch { /* no cache this time */ }
}
