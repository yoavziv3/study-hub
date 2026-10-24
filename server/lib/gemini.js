// Gemini (Google AI Studio) as the AI provider: AI_PROVIDER=gemini with GEMINI_API_KEY. Used by ai.js for the same
// structured-JSON calls as Claude, with two differences:
//  - the deck's PDF can go with the prompt (files), and Gemini reads each page as an image too – tables, charts
//    and formulas the extracted text misses;
//  - the free tier has small, per-project limits, so calls go one at a time, spaced to GEMINI_RPM, and are counted
//    against GEMINI_RPD per Pacific day (when Google resets it). Low-priority calls (the question banks) stop at
//    (1 - GEMINI_RESERVE) of the day, so new lessons always find quota left. A used-up day surfaces as a
//    "usage limit" error, which the rest of the server already knows how to wait out.
// On the free tier Google may use what is sent to improve its products (the paid tier doesn't).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const RPM = Number(process.env.GEMINI_RPM) || 5;
const RPD = Number(process.env.GEMINI_RPD) || 100;
const RESERVE = Math.min(0.9, Math.max(0, Number(process.env.GEMINI_RESERVE ?? 0.4)));
const MB = 1024 * 1024;
const INLINE_MAX = 18 * MB; // bigger PDFs go through the File API (up to 50 MB / 1000 pages)
const PDF_MAX = 50 * MB;
const THINKING = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE_FILE = path.join(ROOT, 'logs', 'gemini-usage.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let client = null;
const ai = () => (client ||= new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  // A different endpoint (tests point it at a local mock).
  ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}),
}));

export const geminiReady = () => !!process.env.GEMINI_API_KEY;

// ---------- the free tier's limits ----------
const dayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
let usage = (() => {
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch { return { day: dayPT(), count: 0 }; }
})();
const saveUsage = () => {
  try {
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage));
  } catch { /* the count lives on in memory */ }
};
let last = 0;
let line = Promise.resolve();

/** Waits for a turn: one request at a time, spaced to RPM, within the day's quota (less for low priority). */
function acquire(priority = 'normal') {
  const turn = line.then(async () => {
    if (usage.day !== dayPT()) usage = { day: dayPT(), count: 0 };
    const cap = priority === 'low' ? Math.floor(RPD * (1 - RESERVE)) : RPD;
    if (usage.count >= cap) {
      throw new Error(`429 usage_limit: Gemini daily quota ${usage.count}/${RPD}${priority === 'low' ? ' (the rest is kept for new lessons)' : ''} – resets at midnight Pacific time`);
    }
    const wait = last + 60000 / RPM - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    usage.count++;
    saveUsage();
  });
  line = turn.catch(() => {});
  return turn;
}

export const geminiUsage = () => ({ model: GEMINI_MODEL, day: usage.day === dayPT() ? usage.count : 0, limit: RPD, rpm: RPM });

// Errors in the words the rest of the server checks for (429 / usage_limit → wait; authenticate → bad key).
function normalize(e) {
  const status = e?.status;
  const msg = String(e?.message || e).slice(0, 300);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return new Error(`429 usage_limit: ${msg}`);
  if (status === 401 || status === 403 || /API key not valid|PERMISSION_DENIED/i.test(msg)) return new Error(`authenticate: Gemini rejected GEMINI_API_KEY (${status || 'invalid'})`);
  return e instanceof Error ? e : new Error(msg);
}

// ---------- the deck itself ----------
async function pdfPart(file) {
  const size = fs.statSync(file).size;
  if (size > PDF_MAX) throw new Error(`הקובץ גדול מדי ל-Gemini (${Math.round(size / MB)}MB, עד 50MB)`);
  if (size <= INLINE_MAX) return { inlineData: { mimeType: 'application/pdf', data: fs.readFileSync(file).toString('base64') } };
  const up = await ai().files.upload({ file, config: { mimeType: 'application/pdf' } });
  let f = up;
  for (let i = 0; f.state === 'PROCESSING' && i < 60; i++) {
    await sleep(3000);
    f = await ai().files.get({ name: up.name });
  }
  if (f.state !== 'ACTIVE' && f.state !== undefined) throw new Error(`Gemini couldn't read the PDF (${f.state})`);
  return { fileData: { fileUri: f.uri, mimeType: 'application/pdf' } };
}

// ---------- calls ----------
/** Structured output: the reply must match `schema` (JSON Schema). `files`: paths of PDFs to read along. */
export async function geminiJSON({ system, prompt, schema, effort = 'high', maxTokens = 48000, files = [], priority = 'normal' }) {
  await acquire(priority);
  try {
    const parts = [...(await Promise.all(files.filter(Boolean).map(pdfPart))), { text: prompt }];
    const config = {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      maxOutputTokens: Math.min(maxTokens, 65536),
      ...(THINKING[effort] ? { thinkingConfig: { thinkingLevel: THINKING[effort] } } : {}),
      abortSignal: AbortSignal.timeout(20 * 60000),
    };
    let res;
    try {
      res = await ai().models.generateContent({ model: GEMINI_MODEL, contents: [{ role: 'user', parts }], config });
    } catch (e) {
      // A model without adjustable thinking: once more without it.
      if (e?.status !== 400 || !/thinking/i.test(String(e.message))) throw e;
      delete config.thinkingConfig;
      res = await ai().models.generateContent({ model: GEMINI_MODEL, contents: [{ role: 'user', parts }], config });
    }
    const text = res.text;
    if (!text) throw new Error(`Gemini returned no answer (${res.candidates?.[0]?.finishReason || res.promptFeedback?.blockReason || 'empty'})`);
    if (res.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new Error('Gemini stopped at the output limit – the answer was cut short');
    return JSON.parse(text);
  } catch (e) {
    throw normalize(e);
  }
}

/** The tutor chat, streamed. messages: [{ role: 'user' | 'assistant', content }] */
export async function geminiStream({ system, messages, onText, signal }) {
  await acquire('normal');
  try {
    const stream = await ai().models.generateContentStream({
      model: GEMINI_MODEL,
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      config: { systemInstruction: system, ...(signal ? { abortSignal: signal } : {}) },
    });
    for await (const chunk of stream) {
      if (chunk.text) onText(chunk.text);
    }
  } catch (e) {
    if (signal?.aborted) return;
    throw normalize(e);
  }
}

/** Is the key good and is there quota left today? (Reading the model's details doesn't use the daily quota.) */
export async function geminiProbe() {
  if (!geminiReady()) return { ok: false, kind: 'signed-out', reason: 'GEMINI_API_KEY חסר ב-.env' };
  if (usage.day === dayPT() && usage.count >= RPD) return { ok: false, kind: 'limit', reason: `Gemini: נוצלו ${usage.count}/${RPD} הבקשות של היום` };
  try {
    await ai().models.get({ model: GEMINI_MODEL });
    return { ok: true };
  } catch (e) {
    const n = normalize(e);
    return { ok: false, kind: /authenticate/.test(n.message) ? 'signed-out' : /usage_limit/.test(n.message) ? 'limit' : 'error', reason: n.message.slice(0, 200) };
  }
}
