import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Headphones, Pause, Play, Square, SkipBack, SkipForward } from 'lucide-react';

// Reads a lesson summary aloud with the browser's own Hebrew voice (Web Speech API – nothing leaves the device).
// Text is spoken in short chunks: long utterances get cut off in Chrome, and chunks make pause/resume and speed
// changes reliable everywhere (pausing = stopping and restarting the current chunk, since pause() is broken on Android).

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const BLOCK_WORD = { definition: 'הגדרה', example: 'דוגמה', rule: 'כלל', important: 'חשוב לזכור', mistake: 'טעות נפוצה' };

/** Markdown / LaTeX → text that sounds right. */
export function speakable(md = '') {
  return String(md)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$[\s\S]+?\$\$/g, ' (נוסחה) ')
    .replace(/\$[^$\n]+\$/g, ' (נוסחה) ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?[-:\s|]+\|?\s*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/[*_`~]+/g, '')
    .replace(/[⁦-⁩‎‏]/g, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(\.\s*){2,}/g, '. ')
    .trim();
}

/** Sentences packed into chunks of up to ~220 characters. */
function chunk(text, max = 220) {
  const sentences = text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [text];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + s).length > max) { out.push(cur.trim()); cur = ''; }
    if (s.length > max) {
      for (const part of s.split(/,\s*/)) {
        if (cur && (cur + part).length > max) { out.push(cur.trim()); cur = ''; }
        cur += `${part}, `;
      }
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((x) => /[\p{L}\p{N}]/u.test(x));
}

function sectionText(s) {
  const parts = [s.title];
  for (const b of s.blocks || []) parts.push([BLOCK_WORD[b.type], b.title, speakable(b.body)].filter(Boolean).join('. '));
  for (const it of s.items || []) {
    if (typeof it === 'string') parts.push(speakable(it));
    else parts.push([it.name, speakable(it.explanation)].filter(Boolean).join('. '));
  }
  return parts.filter(Boolean).join('. ');
}

function useHebrewVoice() {
  const [voice, setVoice] = useState(undefined); // undefined = still loading, null = none on this device
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return undefined;
    const pick = () => {
      const all = synth.getVoices();
      if (!all.length) return;
      const he = all.filter((v) => /^(he|iw)\b/i.test(v.lang));
      setVoice(he.find((v) => v.localService) || he[0] || null);
    };
    pick();
    synth.addEventListener?.('voiceschanged', pick);
    const t = setTimeout(() => setVoice((v) => (v === undefined ? null : v)), 2500);
    return () => { synth.removeEventListener?.('voiceschanged', pick); clearTimeout(t); };
  }, []);
  return voice;
}

/** "השמע" for a summary: play/pause, previous/next section, stop, speed. sections: [{id, title, blocks?, items?}] */
export default function ReadAloud({ intro, sections, onSection }) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const voice = useHebrewVoice();
  const [state, setState] = useState('idle'); // idle | playing | paused
  const [rate, setRate] = useState(() => {
    try { return Number(localStorage.getItem('tts-rate')) || 1; } catch { return 1; }
  });
  const [pos, setPos] = useState(0);
  const run = useRef(0); // bumps on every start/stop, so callbacks of cancelled utterances do nothing
  const rateRef = useRef(rate);

  const chunks = useMemo(() => {
    const out = [];
    if (intro) for (const text of chunk(speakable(intro))) out.push({ text, section: sections[0]?.id });
    for (const s of sections) for (const text of chunk(sectionText(s))) out.push({ text, section: s.id });
    return out;
  }, [intro, sections]);

  const stopSpeech = () => {
    run.current++;
    window.speechSynthesis?.cancel();
  };

  const speakFrom = (i) => {
    stopSpeech();
    const id = run.current;
    if (i >= chunks.length) {
      setState('idle');
      setPos(0);
      onSection?.(null);
      return;
    }
    setPos(i);
    setState('playing');
    onSection?.(chunks[i].section);
    const u = new SpeechSynthesisUtterance(chunks[i].text);
    u.lang = voice?.lang || 'he-IL';
    if (voice) u.voice = voice;
    u.rate = rateRef.current;
    u.onend = () => { if (run.current === id) speakFrom(i + 1); };
    u.onerror = (e) => {
      if (run.current !== id || e.error === 'interrupted' || e.error === 'canceled') return;
      setState('idle');
      onSection?.(null);
    };
    window.speechSynthesis.speak(u);
  };

  // Leaving the page (or a different lesson) stops the voice.
  useEffect(() => () => stopSpeech(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state !== 'idle') { stopSpeech(); setState('idle'); setPos(0); onSection?.(null); }
  }, [chunks]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeRate = (r) => {
    setRate(r);
    rateRef.current = r;
    try { localStorage.setItem('tts-rate', String(r)); } catch { /* storage unavailable */ }
    if (state === 'playing') speakFrom(pos);
  };
  const toggle = () => {
    if (state === 'playing') { stopSpeech(); setState('paused'); } else speakFrom(pos);
  };
  const stop = () => { stopSpeech(); setState('idle'); setPos(0); onSection?.(null); };
  const jump = (dir) => {
    const current = chunks[pos]?.section;
    const order = [...new Set(chunks.map((c) => c.section))];
    const target = order[Math.max(0, Math.min(order.length - 1, order.indexOf(current) + dir))];
    const i = chunks.findIndex((c) => c.section === target);
    if (i < 0) return;
    if (state === 'playing') return speakFrom(i);
    setPos(i);
    onSection?.(target);
  };

  if (!supported || !chunks.length) return null;
  const pct = Math.round((pos / chunks.length) * 100);

  return (
    <div className={`read-aloud ${state}`}>
      {state === 'idle' ? (
        <button className="btn sm" onClick={() => speakFrom(0)}><Headphones size={15} /> השמע</button>
      ) : (
        <motion.div className="read-aloud-bar" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          <button className="btn sm icon ghost" onClick={() => jump(-1)} aria-label="לקטע הקודם"><SkipForward size={15} /></button>
          <button className="btn sm icon accent" onClick={toggle} aria-label={state === 'playing' ? 'השהיה' : 'המשך'}>
            {state === 'playing' ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button className="btn sm icon ghost" onClick={() => jump(1)} aria-label="לקטע הבא"><SkipBack size={15} /></button>
          <button className="btn sm icon ghost" onClick={stop} aria-label="עצירה"><Square size={13} /></button>
          <div className="read-aloud-progress" aria-hidden><span style={{ width: `${pct}%` }} /></div>
          <span className="faint num" style={{ fontSize: 12 }}>{pct}%</span>
        </motion.div>
      )}
      <label className="read-aloud-rate">
        <span className="faint">מהירות</span>
        <select className="input sm" value={rate} onChange={(e) => changeRate(Number(e.target.value))} aria-label="מהירות ההקראה">
          {RATES.map((r) => <option key={r} value={r}>×{r}</option>)}
        </select>
      </label>
      {voice === null && <span className="faint" style={{ fontSize: 12.5 }}>לא נמצא במכשיר קול בעברית – ההקראה עלולה להישמע לא טוב</span>}
    </div>
  );
}
