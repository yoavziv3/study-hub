// Structured log of every process run: one JSON line per run in logs/runs.jsonl (this Mac only, not in git).
// Each line says which process ran, what triggered it, when it started and ended, what went in and what came out,
// and what the fixed checks after its AI step found (checks.js). It is the record the project's "documented runs"
// are taken from (the /runs page exports it as CSV).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The project root, worked out here rather than taken from store.js: store → publish → runlog would be a cycle.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = process.env.STUDY_RUNLOG || path.join(ROOT, 'logs', 'runs.jsonl');
const KEEP = 5000; // lines kept when the file is trimmed

export const PROCESSES = {
  lecture: 'עיבוד חומר לימוד',
  notes: 'כתיבת סיכום מובנה',
  syllabus: 'חילוץ משקלי ציון מהסילבוס',
  practice: 'שאלות תרגול נוספות',
  homework: 'תרגול ברמת שיעורי הבית',
  'moodle-sync': 'סנכרון מודל',
  publish: 'פרסום לאתר',
  weekly: 'דוח עומס שבועי',
  notices: 'קריאת הודעות (Claude)',
};

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let writing = Promise.resolve();

function append(entry) {
  writing = writing
    .then(async () => {
      await fsp.mkdir(path.dirname(FILE), { recursive: true });
      await fsp.appendFile(FILE, `${JSON.stringify(entry)}\n`);
    })
    .catch((e) => console.error('[runlog]', e.message));
  return writing;
}

/** Run status from its checks: a "reject" means the AI output was not used, a "fixed"/"warn" that it was cleaned. */
const statusOf = (checks) => (checks.some((c) => c.level === 'reject') ? 'rejected' : checks.length ? 'checked' : 'ok');

/**
 * Starts a run; call .ok(output, checks) or .fail(error, checks) when it ends (exactly one of them).
 * trigger: what started it – 'schedule', 'moodle', 'upload', 'inbox', 'import', 'retry', 'manual'.
 */
export function startRun(process, { trigger = 'manual', input = {} } = {}) {
  const started = Date.now();
  const base = { id: rid(), process, trigger, startedAt: new Date(started).toISOString(), input };
  const end = (extra) => append({ ...base, finishedAt: new Date().toISOString(), durationMs: Date.now() - started, ...extra });
  return {
    id: base.id,
    ok: (output = {}, checks = []) => end({ status: statusOf(checks), output, checks }),
    fail: (error, checks = []) => end({ status: 'error', error: String(error?.message || error).slice(0, 500), checks }),
  };
}

/** Newest first. */
export function listRuns({ process = null, limit = 300 } = {}) {
  if (!fs.existsSync(FILE)) return [];
  const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length > KEEP * 1.2) fsp.writeFile(FILE, `${lines.slice(-KEEP).join('\n')}\n`).catch(() => {});
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const r = JSON.parse(lines[i]);
      if (!process || r.process === process) out.push(r);
    } catch { /* a torn line */ }
  }
  return out;
}
