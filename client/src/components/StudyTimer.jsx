import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Timer, Play, Pause, RotateCcw, SkipForward, Coffee } from 'lucide-react';
import { useApp } from '../store.jsx';

// A Pomodoro timer in the top bar: focus, then a break, again and again. A finished focus block is saved with the
// student's progress (minutes per day), so it counts towards the study streak on the dashboard. The running timer
// lives in this browser (it survives navigating and reloading), not in the account.

const PRESETS = [
  { id: '25', focus: 25, rest: 5, label: '25 / 5' },
  { id: '50', focus: 50, rest: 10, label: '50 / 10' },
];
const STORE = 'study-timer';
const MIN = 60000;

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; }
};
const initial = () => ({ preset: '25', phase: 'focus', endsAt: null, left: 25 * MIN, ...load() });
const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const today = () => new Date().toISOString().slice(0, 10);

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = [660, 880, 990][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.4);
    });
  } catch { /* no audio */ }
}

async function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) await reg.showNotification(title, { body, icon: '/icon-192.png', lang: 'he', dir: 'rtl', tag: 'study-timer' });
    else new Notification(title, { body });
  } catch { /* not allowed here */ }
}

export default function StudyTimer() {
  const { progress, progressLoaded, addFocus, toast } = useApp();
  const [t, setT] = useState(initial);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const box = useRef(null);
  const preset = PRESETS.find((p) => p.id === t.preset) || PRESETS[0];
  const running = !!t.endsAt;
  const left = running ? t.endsAt - Date.now() : t.left;

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(t)); } catch { /* storage unavailable */ }
  }, [t]);

  // A phase ends (also when the page was closed meanwhile): save the focus minutes and move on – only once the
  // saved progress has loaded, or saving would overwrite it.
  useEffect(() => {
    if (!running || !progressLoaded) return undefined;
    const id = setInterval(() => {
      if (Date.now() < t.endsAt) return tick((x) => x + 1);
      if (t.phase === 'focus') {
        addFocus(preset.focus);
        chime();
        toast(`כל הכבוד! ${preset.focus} דקות ריכוז – עכשיו ${preset.rest} דקות הפסקה`);
        notify('סיימת סבב ריכוז 🎉', `${preset.rest} דקות הפסקה`);
        setT((x) => ({ ...x, phase: 'rest', endsAt: Date.now() + preset.rest * MIN, left: preset.rest * MIN }));
      } else {
        chime();
        toast('ההפסקה נגמרה – מוכנים לסבב הבא?', 'info');
        notify('ההפסקה נגמרה', 'לחצו כדי להתחיל עוד סבב ריכוז');
        setT((x) => ({ ...x, phase: 'focus', endsAt: null, left: preset.focus * MIN }));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, progressLoaded, t.endsAt, t.phase, preset.focus, preset.rest]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const start = () => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    setT((x) => ({ ...x, endsAt: Date.now() + x.left }));
  };
  const pause = () => setT((x) => ({ ...x, endsAt: null, left: Math.max(0, x.endsAt - Date.now()) }));
  const reset = (id = t.preset) => {
    const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
    setT({ preset: p.id, phase: 'focus', endsAt: null, left: p.focus * MIN });
  };
  const skip = () => setT((x) => (x.phase === 'focus'
    ? { ...x, phase: 'rest', endsAt: null, left: preset.rest * MIN }
    : { ...x, phase: 'focus', endsAt: null, left: preset.focus * MIN }));

  const minutesToday = progress.focus?.[today()] || 0;
  const week = Object.entries(progress.focus || {}).filter(([d]) => Date.now() - Date.parse(d) < 7 * 86400000).reduce((s, [, m]) => s + m, 0);
  const total = (t.phase === 'focus' ? preset.focus : preset.rest) * MIN;

  return (
    <div className="study-timer" ref={box}>
      <button className={`btn ghost timer-btn ${running ? 'on' : ''} ${t.phase}`} onClick={() => setOpen((o) => !o)} aria-label="טיימר לימוד" aria-expanded={open}>
        {t.phase === 'rest' ? <Coffee size={18} /> : <Timer size={18} />}
        {(running || left < total) && <span className="num">{fmt(left)}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="card timer-pop" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{t.phase === 'focus' ? 'זמן ריכוז' : 'הפסקה'}</b>
              <div className="tabs" style={{ padding: 3 }}>
                {PRESETS.map((p) => (
                  <button key={p.id} className={`tab ${t.preset === p.id ? 'active' : ''}`} style={{ height: 28, padding: '0 10px', fontSize: 12.5 }} onClick={() => reset(p.id)}>
                    {t.preset === p.id && <motion.span layoutId="timer-preset" className="tab-bg" />}
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="timer-clock num">{fmt(left)}</div>
            <div className="timer-bar"><span style={{ width: `${Math.min(100, (1 - left / total) * 100)}%` }} /></div>
            <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 12 }}>
              {running
                ? <button className="btn accent" onClick={pause}><Pause size={16} /> השהיה</button>
                : <button className="btn accent" onClick={start}><Play size={16} /> {left < total ? 'המשך' : t.phase === 'focus' ? 'התחלה' : 'התחלת הפסקה'}</button>}
              <button className="btn icon ghost" onClick={skip} aria-label={t.phase === 'focus' ? 'דילוג להפסקה' : 'דילוג לריכוז'} title={t.phase === 'focus' ? 'דילוג להפסקה' : 'דילוג לריכוז'}><SkipForward size={16} /></button>
              <button className="btn icon ghost" onClick={() => reset()} aria-label="איפוס"><RotateCcw size={16} /></button>
            </div>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 12, textAlign: 'center' }}>
              היום: <b className="num">{minutesToday}</b> דק׳ ריכוז · השבוע: <b className="num">{week}</b> דק׳
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
