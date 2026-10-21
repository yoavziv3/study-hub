import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Shuffle, RotateCcw, Layers, Keyboard, MousePointerClick, Pencil, Plus, Flame } from 'lucide-react';
import { useApp } from '../store.jsx';
import { shuffle } from '../api.js';
import { GRADES, previews, schedule, stageOf, isHard, STAGE_LABEL, STAGE_ONE } from '../lib/srs.js';
import { deckOf, ownKey } from '../lib/cards.js';
import { ltr } from './ui.jsx';

// Typing mode: how much of the right answer the student wrote (shared words, ignoring niqqud and punctuation).
const norm = (s) => String(s || '').normalize('NFC').replace(/[֑-ׇ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
const tokens = (s) => norm(s).split(/\s+/).filter((w) => w.length > 1);
function overlap(typed, answer) {
  const want = [...new Set(tokens(answer))];
  if (!want.length) return 0;
  const have = new Set(tokens(typed));
  // Hebrew prefixes (ה, ו, ב, ל, מ, ש, כ) shouldn't make a right word count as wrong.
  const hit = (w) => have.has(w) || [...have].some((h) => (h.length > 2 && (h.endsWith(w) || w.endsWith(h))));
  return want.filter(hit).length / want.length;
}
const suggestion = (score) => (score >= 0.75 ? 'good' : score >= 0.4 ? 'hard' : 'again');

const MODES = [['due', 'לחזרה עכשיו'], ['all', 'כל הכרטיסיות'], ['hard', 'קשות לי']];

/**
 * Spaced-repetition flashcards (Anki-style). cards: the AI's [{front, back, lectureId, lectureTitle?}];
 * lectures: [{id, title}] – where the student's own cards come from and can be added to (omit for a fixed deck).
 */
export default function Flashcards({ cards, lectures = null, initialMode = 'due' }) {
  const { progress, gradeCard, saveOwnCard, removeOwnCard, editCard, hideCard, toast } = useApp();
  const [mode, setMode] = useState(MODES.some(([m]) => m === initialMode) ? initialMode : 'due'); // due | all | hard
  const [form, setForm] = useState(null); // { card? } while adding (no card) or editing a card
  const [style, setStyle] = useState(() => {
    try { return localStorage.getItem('fc-style') || 'flip'; } catch { return 'flip'; }
  }); // flip | type
  const [deck, setDeck] = useState([]);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const [typed, setTyped] = useState('');
  const [exit, setExit] = useState(0);
  const input = useRef(null);

  const withKeys = useMemo(() => deckOf(cards, progress, lectures || []), [cards, lectures, progress.customCards, progress.cardEdits, progress.cardHidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const hardCount = useMemo(() => withKeys.filter((c) => isHard(progress.cards[c.key])).length, [withKeys, progress.cards]);
  const stages = useMemo(() => {
    const s = { new: 0, learning: 0, young: 0, mature: 0 };
    withKeys.forEach((c) => s[stageOf(progress.cards[c.key])]++);
    return s;
  }, [withKeys, progress.cards]);

  const build = (m = mode) => {
    const now = Date.now();
    // "Hard for me": the cards forgotten most often, worst first.
    const list = m === 'due' ? shuffle(withKeys.filter((c) => !progress.cards[c.key] || progress.cards[c.key].due <= now))
      : m === 'hard' ? withKeys.filter((c) => isHard(progress.cards[c.key])).sort((a, b) => (progress.cards[b.key].lapses || 0) - (progress.cards[a.key].lapses || 0))
      : shuffle(withKeys);
    setDeck(list);
    setI(0);
    setFlip(false);
    setTyped('');
  };
  useEffect(() => { build(); }, [cards.length, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // An edited card changes in place; a hidden or deleted one leaves the round.
  useEffect(() => {
    const byKey = new Map(withKeys.map((c) => [c.key, c]));
    setDeck((d) => d.filter((c) => byKey.has(c.key)).map((c) => byKey.get(c.key)));
  }, [withKeys]);
  useEffect(() => {
    try { localStorage.setItem('fc-style', style); } catch { /* storage unavailable */ }
  }, [style]);

  const card = deck[i];
  const stored = card ? progress.cards[card.key] : null;
  const labels = useMemo(() => (card ? previews(stored) : {}), [card, stored]);
  const score = style === 'type' && flip && card ? overlap(typed, card.back) : null;
  const suggested = score == null ? null : suggestion(score);

  useEffect(() => { if (style === 'type' && card && !flip) input.current?.focus({ preventScroll: true }); }, [style, card, flip, i]);

  const grade = (g) => {
    // Cards still in learning come back later in this same session (a few cards on), like Anki's learning steps.
    const { requeue } = schedule(stored, g);
    gradeCard(card.key, g);
    if (requeue) {
      setDeck((d) => {
        const at = Math.min(d.length, i + 1 + Math.max(2, Math.min(5, d.length - i - 1)));
        return [...d.slice(0, at), card, ...d.slice(at)];
      });
    }
    setExit(g === 'again' ? -1 : 1);
    setFlip(false);
    setTyped('');
    setTimeout(() => setI((x) => x + 1), 10);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (!card || form) return;
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if (typing) return;
      if (e.key === ' ') { e.preventDefault(); setFlip((f) => !f); }
      if (!flip) return;
      const g = GRADES.find((x) => x.key === e.key);
      if (g) grade(g.id);
      if (e.key === 'ArrowLeft') grade('good');
      if (e.key === 'ArrowRight') grade('again');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const check = () => {
    setFlip(true);
    input.current?.blur();
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <div className="tabs">
          {MODES.filter(([id]) => id !== 'hard' || hardCount || mode === 'hard').map(([id, label]) => (
            <button key={id} className={`tab ${mode === id ? 'active' : ''}`} onClick={() => setMode(id)}>
              {mode === id && <motion.span layoutId="fc-mode" className="tab-bg" />}
              {id === 'hard' && <Flame size={14} />} {label}
              {id === 'hard' && <span className="count">{hardCount}</span>}
            </button>
          ))}
        </div>
        <div className="tabs">
          {[['flip', 'הפיכה', MousePointerClick], ['type', 'כתיבה', Keyboard]].map(([id, label, Icon]) => (
            <button key={id} className={`tab ${style === id ? 'active' : ''}`} onClick={() => { setStyle(id); setFlip(false); setTyped(''); }}>
              {style === id && <motion.span layoutId="fc-style" className="tab-bg" />}
              <Icon size={14} /> {label}
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
              {card.customId && <span className="chip c">שלי</span>}
              {card.edited && <span className="chip">נערכה</span>}
              <div className="spacer" />
              <span className="faint" style={{ fontSize: 12.5 }}>{STAGE_ONE[stageOf(stored)]}</span>
              {lectures && <button className="btn sm icon ghost" onClick={() => setForm({ card })} aria-label="עריכת הכרטיסייה"><Pencil size={14} /></button>}
            </div>
            {form?.card?.key === card.key ? (
              <CardForm
                card={card}
                onCancel={() => setForm(null)}
                onSave={({ front, back }) => {
                  if (card.customId) saveOwnCard({ id: card.customId, front, back });
                  else editCard(card.key, front, back);
                  setForm(null);
                  toast('הכרטיסייה עודכנה');
                }}
                onRemove={() => {
                  if (card.customId) removeOwnCard(card.customId, card.key);
                  else hideCard(card.key);
                  setForm(null);
                  toast(card.customId ? 'הכרטיסייה נמחקה' : 'הכרטיסייה הוסתרה');
                }}
                removeLabel={card.customId ? 'מחיקה' : 'הסתרה מהחפיסה'}
              />
            ) : (
            <AnimatePresence mode="wait" custom={exit}>
              <motion.div
                key={card.key + i}
                custom={exit}
                initial={{ opacity: 0, y: 30, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={(d) => ({ opacity: 0, x: d * -160, rotate: d * -8, transition: { duration: 0.3 } })}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              >
                {style === 'flip' ? (
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
                ) : (
                  <div className="card fc-type">
                    <span className="label">שאלה</span>
                    <div className="fc-front-text">{ltr(card.front)}</div>
                    {!flip ? (
                      <form onSubmit={(e) => { e.preventDefault(); check(); }} className="stack" style={{ gap: 10, marginTop: 18 }}>
                        <textarea
                          ref={input}
                          className="input fc-answer"
                          rows={3}
                          placeholder="כתבו את התשובה במילים שלכם…"
                          value={typed}
                          onChange={(e) => setTyped(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); check(); } }}
                        />
                        <div className="row" style={{ justifyContent: 'center' }}>
                          <button className="btn accent" type="submit">בדיקה (Enter)</button>
                          <button className="btn ghost" type="button" onClick={check}>לא יודע/ת – הצגת התשובה</button>
                        </div>
                      </form>
                    ) : (
                      <motion.div className="fc-compare" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                        <div>
                          <span className="label">התשובה שלך</span>
                          <p className={typed.trim() ? '' : 'faint'}>{typed.trim() ? ltr(typed) : 'לא נכתבה תשובה'}</p>
                        </div>
                        <div>
                          <span className="label">התשובה הנכונה</span>
                          <p>{ltr(card.back)}</p>
                        </div>
                        {typed.trim() && (
                          <div className="faint" style={{ fontSize: 13 }}>
                            {Math.round(score * 100)}% מהמילים החשובות בתשובה שלך – אבל רק אתם יודעים אם הבנתם. דרגו בעצמכם.
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
            )}
            <div className="fc-actions">
              <AnimatePresence>
                {flip && !form && GRADES.map((g, j) => (
                  <motion.button
                    key={g.id}
                    className={`btn fc-grade ${g.cls} ${suggested === g.id ? 'suggested' : ''}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: j * 0.04 }}
                    exit={{ opacity: 0 }}
                    onClick={() => grade(g.id)}
                    title={`מקש ${g.key}`}
                  >
                    <b>{g.label}</b>
                    <span>{labels[g.id]}</span>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
            {flip && !form && <div className="faint fc-hint">מקשים 1–4 · שוב = לא זכרתי · קשה = בקושי · טוב = זכרתי · קל = בלי לחשוב</div>}
          </>
        ) : (
          <motion.div className="card result-hero" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
            <div className="empty-icon" style={{ marginBottom: 12 }}><Layers size={28} /></div>
            <h3 style={{ fontSize: 22 }}>{deck.length ? 'סיימתם את הסבב! 🎉' : mode === 'hard' ? 'אין כרטיסיות קשות כרגע 💪' : 'אין כרטיסיות לחזרה כרגע'}</h3>
            <p className="muted">כל כרטיסייה חוזרת לפי מה שעניתם: "קל" מרחיק אותה בהרבה, "שוב" מחזיר אותה עוד כמה דקות – כך הזיכרון מתקבע לטווח ארוך.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn accent" onClick={() => { setMode('all'); build('all'); }}><RotateCcw size={16} /> חזרה על כל הכרטיסיות</button>
            </div>
          </motion.div>
        )}
        <div className="boxes">
          {Object.entries(stages).map(([s, n]) => (
            <div key={s}><b>{n}</b>{STAGE_LABEL[s]}</div>
          ))}
        </div>
        {lectures?.length > 0 && (
          form && !form.card ? (
            <CardForm
              lectures={lectures}
              onCancel={() => setForm(null)}
              onSave={({ front, back, lectureId }) => {
                const own = { id: Math.random().toString(36).slice(2, 10), lectureId, front, back };
                saveOwnCard(own);
                // New cards are due right away: they join this round too.
                setDeck((d) => [...d, { front, back, lectureId, key: ownKey(own), customId: own.id, lectureTitle: card?.lectureTitle && lectures.find((l) => l.id === lectureId)?.title }]);
                setForm(null);
                toast('הכרטיסייה נוספה');
              }}
            />
          ) : (
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button className="btn sm ghost" onClick={() => setForm({})}><Plus size={14} /> כרטיסייה משלי</button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** Add a card of your own, or edit one (the AI's edits are kept separately, so its review history stays). */
function CardForm({ card, lectures, onSave, onCancel, onRemove, removeLabel }) {
  const [front, setFront] = useState(card?.front || '');
  const [back, setBack] = useState(card?.back || '');
  const [lectureId, setLectureId] = useState(lectures?.[0]?.id);
  const ok = front.trim() && back.trim();
  return (
    <form className="card pad card-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ front: front.trim(), back: back.trim(), lectureId }); }}>
      <b>{card ? 'עריכת כרטיסייה' : 'כרטיסייה חדשה'}</b>
      {!card && lectures.length > 1 && (
        <select className="input" value={lectureId} onChange={(e) => setLectureId(e.target.value)} aria-label="השיעור">
          {lectures.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
      )}
      <label className="stack" style={{ gap: 4 }}>
        <span className="faint" style={{ fontSize: 12.5 }}>שאלה</span>
        <textarea className="input fc-answer" rows={2} value={front} onChange={(e) => setFront(e.target.value)} autoFocus />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="faint" style={{ fontSize: 12.5 }}>תשובה</span>
        <textarea className="input fc-answer" rows={3} value={back} onChange={(e) => setBack(e.target.value)} />
      </label>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn accent sm" type="submit" disabled={!ok}>שמירה</button>
        <button className="btn ghost sm" type="button" onClick={onCancel}>ביטול</button>
        <div className="spacer" />
        {onRemove && <button className="btn ghost sm danger" type="button" onClick={onRemove}>{removeLabel}</button>}
      </div>
    </form>
  );
}
