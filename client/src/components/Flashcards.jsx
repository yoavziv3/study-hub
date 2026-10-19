import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Shuffle, Check, X, RotateCcw, Layers } from 'lucide-react';
import { useApp, cardKey } from '../store.jsx';
import { shuffle } from '../api.js';
import { ltr } from './ui.jsx';

/** Leitner-box flashcards. cards: [{front, back, lectureId, lectureTitle?}] */
export default function Flashcards({ cards }) {
  const { progress, gradeCard } = useApp();
  const [mode, setMode] = useState('due'); // due | all
  const [deck, setDeck] = useState([]);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const [exit, setExit] = useState(0);

  const withKeys = useMemo(() => cards.map((c) => ({ ...c, key: cardKey(c.lectureId, c.front) })), [cards]);
  const boxes = useMemo(() => {
    const b = [0, 0, 0, 0, 0, 0];
    withKeys.forEach((c) => b[progress.cards[c.key]?.box || 0]++);
    return b;
  }, [withKeys, progress.cards]);

  const build = (m = mode) => {
    const now = Date.now();
    const list = m === 'due' ? withKeys.filter((c) => !progress.cards[c.key] || progress.cards[c.key].due <= now) : withKeys;
    setDeck(shuffle(list));
    setI(0);
    setFlip(false);
  };
  useEffect(() => { build(); }, [cards.length, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = deck[i];
  const grade = (known) => {
    gradeCard(card.key, known);
    setExit(known ? 1 : -1);
    setFlip(false);
    setTimeout(() => setI((x) => x + 1), 10);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || !card) return;
      if (e.key === ' ') { e.preventDefault(); setFlip((f) => !f); }
      if (flip && e.key === 'ArrowLeft') grade(true);
      if (flip && e.key === 'ArrowRight') grade(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div>
      <div className="row" style={{ justifyContent: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <div className="tabs">
          {[['due', 'לחזרה עכשיו'], ['all', 'כל הכרטיסיות']].map(([id, label]) => (
            <button key={id} className={`tab ${mode === id ? 'active' : ''}`} onClick={() => setMode(id)}>
              {mode === id && <motion.span layoutId="fc-mode" className="tab-bg" />}
              {label}
            </button>
          ))}
        </div>
        <button className="btn sm" onClick={() => build()}><Shuffle size={14} /> ערבוב</button>
      </div>

      <div className="fc-stage">
        {card ? (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="chip num">{i + 1}/{deck.length}</span>
              {card.lectureTitle && <span className="chip">{card.lectureTitle}</span>}
              <div className="spacer" />
              <span className="faint" style={{ fontSize: 12.5 }}>קופסה {progress.cards[card.key]?.box || 0}</span>
            </div>
            <AnimatePresence mode="wait" custom={exit}>
              <motion.div
                key={card.key + i}
                custom={exit}
                initial={{ opacity: 0, y: 30, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={(d) => ({ opacity: 0, x: d * -160, rotate: d * -8, transition: { duration: 0.3 } })}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              >
                <motion.div className="fc" role="button" tabIndex={0} aria-pressed={flip} aria-label={flip ? 'הצגת השאלה' : 'הצגת התשובה'} onClick={() => setFlip((f) => !f)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setFlip((f) => !f); } }} animate={{ rotateY: flip ? 180 : 0 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
                  <div className="fc-face">
                    <span className="label">שאלה</span>
                    <div className="fc-front-text">{ltr(card.front)}</div>
                    <div className="faint" style={{ marginTop: 18, fontSize: 13 }}>לחצו או רווח כדי להפוך</div>
                  </div>
                  <div className="fc-face back">
                    <span className="label">תשובה</span>
                    <div className="fc-back-text">{ltr(card.back)}</div>
                  </div>
                </motion.div>
              </motion.div>
            </AnimatePresence>
            <div className="fc-actions">
              <AnimatePresence>
                {flip && (
                  <>
                    <motion.button key="no" className="btn" style={{ color: 'var(--bad)' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onClick={() => grade(false)}>
                      <X size={16} /> עוד לא (→)
                    </motion.button>
                    <motion.button key="yes" className="btn" style={{ color: 'var(--good)' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} exit={{ opacity: 0 }} onClick={() => grade(true)}>
                      <Check size={16} /> ידעתי (←)
                    </motion.button>
                  </>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <motion.div className="card result-hero" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
            <div className="empty-icon" style={{ marginBottom: 12 }}><Layers size={28} /></div>
            <h3 style={{ fontSize: 22 }}>{deck.length ? 'סיימתם את הסבב! 🎉' : 'אין כרטיסיות לחזרה כרגע'}</h3>
            <p className="muted">כרטיסיות שידעתם יחזרו בעוד כמה ימים (שיטת לייטנר) – כך הזיכרון מתקבע לטווח ארוך.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn accent" onClick={() => { setMode('all'); build('all'); }}><RotateCcw size={16} /> חזרה על כל הכרטיסיות</button>
            </div>
          </motion.div>
        )}
        <div className="boxes">
          {boxes.map((n, b) => (
            <div key={b}><b>{n}</b>{b === 0 ? 'חדש' : `קופסה ${b}`}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
