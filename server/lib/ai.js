import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';

// Two ways to reach Claude:
//  - "api": the Anthropic SDK with ANTHROPIC_API_KEY from .env
//  - "cli": the locally installed Claude Code CLI in headless mode, using the user's own login
const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let client = null;

function findClaudeCli() {
  if (process.env.CLAUDE_CLI && fs.existsSync(process.env.CLAUDE_CLI)) return process.env.CLAUDE_CLI;
  const candidates = [
    path.join(os.homedir(), '.local/bin/claude'),
    path.join(os.homedir(), '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const dir of (process.env.PATH || '').split(':')) candidates.push(path.join(dir, 'claude'));
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

export function aiStatus() {
  const forced = process.env.AI_PROVIDER;
  const cli = findClaudeCli();
  let provider = 'none';
  if (forced === 'api' || (!forced && process.env.ANTHROPIC_API_KEY)) provider = 'api';
  else if ((forced === 'cli' || !forced) && cli) provider = 'cli';
  return { provider, model: MODEL, ready: provider !== 'none' };
}

const NO_AI = 'לא הוגדר חיבור ל-AI. הוסיפו ANTHROPIC_API_KEY לקובץ ‎.env או התקינו את Claude Code.';

function sdk() {
  if (!client) client = new Anthropic();
  return client;
}

// ---------- CLI plumbing ----------
function cliArgs({ system, effort, extra = [] }) {
  return [
    '-p',
    '--model', MODEL,
    '--tools', '',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--system-prompt', system,
    ...(effort ? ['--effort', effort] : []),
    ...extra,
  ];
}

function spawnCli(args, input, { onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    const bin = findClaudeCli();
    if (!bin) return reject(new Error('Claude CLI not found'));
    const child = spawn(bin, args, { cwd: os.tmpdir(), env: process.env });
    let out = '';
    let err = '';
    let buf = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      out += s;
      if (!onLine) return;
      buf += s;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) onLine(line);
      }
    });
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (onLine && buf.trim()) onLine(buf.trim());
      if (code === 0 || signal?.aborted) return resolve(out);
      // With --output-format json the reason is in the reply's "result" (e.g. an expired sign-in), not in stderr.
      let reason = '';
      try { reason = JSON.parse(out).result || ''; } catch { /* not JSON */ }
      reject(new Error(`claude exited ${code}: ${reason || (err || out).slice(-600)}`));
    });
    signal?.addEventListener('abort', () => child.kill('SIGTERM'));
    child.stdin.end(input);
  });
}

function parseLooseJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return JSON.parse(text.slice(start, end + 1));
}

// ---------- structured generation ----------
export async function generateJSON({ system, prompt, schema, effort = 'high', maxTokens = 48000 }) {
  const { provider } = aiStatus();
  if (provider === 'api') {
    const stream = sdk().messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      output_config: { effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('הבקשה נדחתה על ידי המודל');
    return parseLooseJSON(msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  }
  if (provider === 'cli') {
    const out = await spawnCli(
      cliArgs({ system, effort, extra: ['--output-format', 'json', '--json-schema', JSON.stringify(schema)] }),
      prompt
    );
    const res = JSON.parse(out);
    if (res.is_error) throw new Error(res.result || 'CLI error');
    if (res.structured_output) return res.structured_output;
    return parseLooseJSON(res.result);
  }
  throw new Error(NO_AI);
}

// ---------- streaming chat ----------
// messages: [{role:'user'|'assistant', content:string}]
export async function chatStream({ system, messages, onText, signal, effort = 'low' }) {
  const { provider } = aiStatus();
  if (provider === 'api') {
    // Server-side fallbacks keep the tutor answering if a safety classifier declines on the primary model.
    const stream = sdk().beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        cache_control: { type: 'ephemeral' },
        system,
        output_config: { effort },
        messages,
      },
      { signal }
    );
    stream.on('text', (t) => onText(t));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') onText('\n\n_המודל לא יכול לענות על השאלה הזו._');
    return;
  }
  if (provider === 'cli') {
    // The CLI takes one prompt, so earlier turns are folded into a transcript.
    const last = messages[messages.length - 1];
    const history = messages.slice(0, -1);
    const prompt = history.length
      ? `<conversation_so_far>\n${history.map((m) => `${m.role === 'user' ? 'סטודנט' : 'מורה'}: ${m.content}`).join('\n\n')}\n</conversation_so_far>\n\nההודעה הנוכחית של הסטודנט:\n${last.content}`
      : last.content;
    let streamed = false;
    await spawnCli(
      cliArgs({ system, effort, extra: ['--output-format', 'stream-json', '--verbose', '--include-partial-messages'] }),
      prompt,
      {
        signal,
        onLine(line) {
          let ev;
          try { ev = JSON.parse(line); } catch { return; }
          if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
            streamed = true;
            onText(ev.event.delta.text);
          } else if (ev.type === 'result' && !streamed && ev.result) {
            onText(ev.result);
          }
        },
      }
    );
    return;
  }
  throw new Error(NO_AI);
}
