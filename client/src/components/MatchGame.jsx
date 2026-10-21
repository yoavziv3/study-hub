import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { RotateCcw, Timer, Trophy, X } from 'lucide-react';
import { shuffle } from '../api.js';
import { RichText } from './markdown.jsx';

const ROUND = 6;
const mistakesText = (n) => (n === 1 ? 'טעות אחת' : `${n} טעויות`);
const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Match each term from the glossary to its definition. terms: [{term, definition}] */
export default function MatchGame({ terms }) {
  const pool = useMemo(() => terms.filter((t) => t.term && t.definition), [terms]);
  const [round, setRound] = useState(0);
  const pairs = useMemo(() => shuffle(pool).slice(0, ROUND).map((t, i) => ({ ...t, id: i })), [pool, round]); // eslint-disable-line react-hooks/exhaustive-deps
  const defs = useMemo(() => shuffle(pairs), [pairs]);
  const [picked, setPicked] = useState(null); // { side: 'term'|'def', id }
  const [done, setDone] = useState(new Set());
  const [wrong, setWrong] = useState(null); // [termId, defId] that just missed
  const [mistakes, setMistakes] = useState(0);
  const [start, setStart] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [best, setBest] = useState(() => {
    try { return Number(localStorage.getItem('match-best')) || null; } catch { return null; }
  });

  const finished = pairs.length > 0 && done.size === pairs.length;
  const elapsed = (finished ? now : Date.now()) - start;

  useEffect(() => {
    setPicked(null);
    setDone(new Set());
    setMistakes(0);
    setStart(Date.now());
    setNow(Date.now());
  }, [pairs]);
  useEffect(() => {
    if (finished) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [finished]);
  useEffect(() => {
    if (!finished || mistakes) return;
    const ms = now - start;
    if (!best || ms < best) {
      setBest(ms);
      try { localStorage.setItem('match-best', String(ms)); } catch { /* storage unavailable */ }
    }
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (side, id) => {
    if (done.has(id)) return;
    if (!picked || picked.side === side) return setPicked({ side, id });
    const termId = side === 'term' ? id : picked.id;
    const defId = side === 'def' ? id : picked.id;
    setPicked(null);
    if (termId === defId) {
      const next = new Set(done).add(termId);
      setDone(next);
      if (next.size === pairs.length) setNow(Date.now());
    } else {
      setMistakes((m) => m + 1);
      setWrong([termId, defId]);
      setTimeout(() => setWrong(null), 600);
    }
  };

  if (pool.length < 3) return <div className="card pad muted" style={{ textAlign: 'center' }}>צריך לפחות 3 מושגים במילון כדי לשחק.</div>;

  const cls = (side, id) => [
    'match-item',
    side,
    done.has(id) ? 'matched' : '',
    picked?.side === side && picked.id === id ? 'picked' : '',
    wrong && wrong[side === 'term' ? 0 : 1] === id ? 'missed shake' : '',
  ].join(' ');

  return (
    <div className="match">
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <span className="chip"><Timer size={13} /> <span className="num">{fmt(elapsed)}</span></span>
        <span className={`chip ${mistakes ? 'bad' : ''}`}><X size={13} /> {mistakes ? mistakesText(mistakes) : 'בלי טעויות'}</span>
        <span className="chip">{done.size}/{pairs.length} זוגות</span>
        {best && <span className="chip c"><Trophy size={13} /> שיא בלי טעויות: <span className="num">{fmt(best)}</span></span>}
        <div className="spacer" />
        <button className="btn sm" onClick={() => setRound((r) => r + 1)}><RotateCcw size={14} /> סבב חדש</button>
      </div>
      <p className="faint" style={{ fontSize: 13.5, marginTop: 0 }}>בחרו מושג ואז את ההגדרה שלו (או להפך).</p>

      <AnimatePresence mode="wait">
        {finished ? (
          <motion.div key="done" className="card result-hero" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
            <div className="empty-icon" style={{ marginBottom: 12 }}><Trophy size={28} /></div>
            <h3 style={{ fontSize: 22 }}>כל הזוגות הותאמו! 🎉</h3>
            <p className="muted">{fmt(elapsed)} דקות · {mistakes ? mistakesText(mistakes) : 'בלי אף טעות'}</p>
            <button className="btn accent" onClick={() => setRound((r) => r + 1)}><RotateCcw size={16} /> סבב נוסף עם מושגים אחרים</button>
          </motion.div>
        ) : (
          <motion.div key={round} className="match-board" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="match-col terms">
              {pairs.map((p) => (
                <button key={p.id} className={cls('term', p.id)} disabled={done.has(p.id)} aria-pressed={picked?.side === 'term' && picked.id === p.id} onClick={() => choose('term', p.id)}>
                  <RichText>{p.term}</RichText>
                </button>
              ))}
            </div>
            <div className="match-col defs">
              {defs.map((p) => (
                <button key={p.id} className={cls('def', p.id)} disabled={done.has(p.id)} aria-pressed={picked?.side === 'def' && picked.id === p.id} onClick={() => choose('def', p.id)}>
                  {done.has(p.id) && <b><RichText>{p.term}</RichText>: </b>}
                  <RichText>{p.definition}</RichText>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
