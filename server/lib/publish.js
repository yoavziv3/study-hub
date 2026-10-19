// Auto-publish: after lecture data changes, commit data/ and push so Cloudflare Pages redeploys.
// Runs only when the project is a git repo with an "origin" remote; disable with AUTO_PUBLISH=0.
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const QUIET_MS = 2 * 60 * 1000;
const PATHS = ['data/lectures', 'data/courses.json', 'data/practice'];

let timer = null;
let busy = false;
const changed = new Set();
let root = null;
let isProcessing = () => false;

export function initPublish({ rootDir, processing }) {
  root = rootDir;
  isProcessing = processing;
}

const git = (...args) => run('git', args, { cwd: root, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });

export function schedulePublish(label) {
  if (!root || process.env.AUTO_PUBLISH === '0') return;
  if (label) changed.add(label);
  clearTimeout(timer);
  timer = setTimeout(publish, QUIET_MS);
  timer.unref?.();
}

async function publish() {
  // Wait for lectures still converting / being summarised; they are published once ready.
  if (busy || isProcessing()) return schedulePublish();
  if (!fs.existsSync(path.join(root, '.git'))) return;
  busy = true;
  try {
    await git('remote', 'get-url', 'origin');
    await git('add', '-A', '--', ...PATHS);
    const staged = await git('diff', '--cached', '--name-only', '--', ...PATHS);
    if (!staged.stdout.trim()) return;
    const titles = [...changed].slice(0, 6);
    const msg = `עדכון תוכן: ${titles.join(', ') || 'הרצאות'}${changed.size > 6 ? ` ועוד ${changed.size - 6}` : ''}`;
    // Commit only the data paths, leaving any code changes in the working tree untouched.
    await git('commit', '-m', msg, '--', ...PATHS);
    await git('pull', '--rebase', '--autostash');
    await git('push');
    changed.clear();
    console.log(`[publish] pushed: ${msg}`);
  } catch (e) {
    // Never leave the repo stuck mid-rebase; the commit stays local and is pushed next time.
    if (fs.existsSync(path.join(root, '.git', 'rebase-merge')) || fs.existsSync(path.join(root, '.git', 'rebase-apply'))) {
      await git('rebase', '--abort').catch(() => {});
    }
    console.error('[publish] failed:', (e.stderr || e.message).toString().trim().split('\n').slice(-3).join(' | '));
  } finally {
    busy = false;
  }
}
