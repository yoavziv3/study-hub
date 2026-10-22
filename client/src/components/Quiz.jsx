import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, X, ArrowLeft, RotateCcw, Presentation, Sparkles, Trophy, Bookmark, BookmarkCheck, Timer, ChevronDown } from 'lucide-react';
import { useApp } from '../store.jsx';
import { hebLetters, shuffle, hash } from '../api.js';
import { Ring } from './ui.jsx';
import SlidePeek from './SlidePeek.jsx';
import { Markdown, RichText } from './markdown.jsx';

const DIFF = { easy: { label: 'קל', cls: 'good' }, medium: { label: 'בינוני', cls: 'warn' }, hard: { label: 'קשה', cls: 'bad' } };

function Confetti() {
  const bits = useMemo(() => [...Array(36)].map((_, i) => ({ i, x: (Math.random() - 0.5) * 520, y: -Math.random() * 260 - 80, r: Math.random() * 540, c: ['#f5c84c', '#12976a', '#7048e8', '#0b80d0', '#ff8a5c'][i % 5] })), []);
  return (
    <div style={{ position: 'absolute', top: '40%', left: '50%', pointerEvents: 'none' }}>
      {bits.map((b) => (
        <motion.span key={b.i} style={{ position: 'absolute', width: 8, height: 12, borderRadius: 2, background: b.c }} initial={{ x: 0, y: 0, opacity: 1 }} animate={{ x: b.x, y: [b.y, b.y + 420], rotate: b.r, opacity: [1, 1, 0] }} transition={{ duration: 1.8, ease: 'easeOut' }} />
      ))}
    </div>
  );
}

/**
 * questions: [{question, options, correctIndex, explanation, difficulty, slide, lectureId?, lectureTitle?}]
 * lectureId: lecture for progress tracking (null in course exam → uses each question's lectureId)
 * sim: exam simulation – no feedback until the end; timeLimit (seconds) ends it when time runs out.
 * onFinish({ correct, total, answered }): called once when the set is completed.
 */
// Shuffle answer options once per quiz so the correct answer's position carries no signal.
function shuffleOptions(q) {
  const order = shuffle(q.options.map((_, i) => i));
  return { ...q, options: order.map((i) => q.options[i]), correctIndex: order.indexOf(q.correctIndex) };
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// A set in progress survives a page refresh (persistKey): the shuffled questions, where the student is and what
// they answered, saved in this browser. It belongs to exactly this set of questions (sig); a new set starts fresh.
const sigOf = (qs) => qs.map((q) => hash(q.question)).join('|');
function readSaved(key, sig) {
  if (!key) return null;
  try {
    const s = JSON.parse(localStorage.getItem(key) || 'null');
    return s && s.sig === sig ? s : null;
  } catch {
    return null;
  }
}

/** A wrong (or unanswered) question in the results, with the right answer and the explanation on demand. */
function ReviewItem({ q, picked }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="review-item">
      <button className="review-q" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b style={{ background: picked == null ? 'var(--text-3)' : 'var(--bad)' }}>{picked == null ? '–' : <X size={13} />}</b>
        <span className="grow"><RichText>{q.question}</RichText></span>
        <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flex: 'none' }} />
      </button>
      {open && (
        <div className="review-a">
          {picked != null && <div className="faint" style={{ fontSize: 13.5 }}>ענית: <RichText>{q.options[picked]}</RichText></div>}
          <div style={{ fontWeight: 700, color: 'var(--good-text)', margin: '4px 0 6px' }}>התשובה הנכונה: <RichText>{q.options[q.correctIndex]}</RichText></div>
          <Markdown>{q.explanation}</Markdown>
          {q.slide > 0 && q.lectureId && !String(q.lectureId).endsWith('-homework') && (
            <Link className="btn sm" style={{ marginTop: 8 }} to={`/lecture/${q.lectureId}?tab=slides&slide=${q.slide}`}><Presentation size={14} /> לשקף {q.slide}</Link>
          )}
        </div>
      )}
    </div>
  );
}

export default function Quiz({ questions: source, lectureId, exam = false, sim = false, timeLimit = 0, onExit, onFinish, onMore, moreLabel, persistKey }) {
  const { recordAnswer, openChat, progress, toggleFlag } = useApp();
  const [sig] = useState(() => sigOf(source));
  const [saved] = useState(() => readSaved(persistKey, sig));
  // Frozen per mount: parents pass a fresh array on every render, and reshuffling mid-question would
  // desync the displayed options from the recorded answer. Callers remount (key) for a new set.
  const [questions] = useState(() => saved?.questions || source.map(shuffleOptions));
  const [order, setOrder] = useState(() => saved?.order || questions.map((_, i) => i));
  const [idx, setIdx] = useState(saved?.idx || 0);
  const [picked, setPicked] = useState(saved?.picked ?? null);
  const [answers, setAnswers] = useState(saved?.answers || {});
  const [choices, setChoices] = useState(saved?.choices || {});
  const [shake, setShake] = useState(false);
  const [left, setLeft] = useState(saved?.left ?? timeLimit);
  const [timeUp, setTimeUp] = useState(saved?.timeUp || false);
  const finished = useRef(!!saved && (saved.idx >= saved.order.length || saved.timeUp));

  useEffect(() => {
    if (!persistKey) return;
    try {
      localStorage.setItem(persistKey, JSON.stringify({ sig, questions, order, idx, picked, answers, choices, left, timeUp }));
    } catch { /* storage full or blocked: the set just won't survive a refresh */ }
  }, [persistKey, sig, questions, order, idx, picked, answers, choices, left, timeUp]);
  const done = idx >= order.length || timeUp;
  const q = questions[order[idx]];
  const correctCount = Object.values(answers).filter(Boolean).length;
  const lid = (x) => lectureId || x.lectureId;
  const flagKey = q ? `${lid(q)}:${hash(q.question)}` : '';
  const flagged = !!progress.flagged?.[flagKey];

  // The simulation clock: counts down and ends the set when time runs out.
  useEffect(() => {
    if (!timeLimit || done) return undefined;
    const t = setInterval(() => setLeft((s) => {
      if (s <= 1) { setTimeUp(true); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [timeLimit, done]);

  useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      onFinish?.({ correct: correctCount, total: order.length, answered: Object.keys(answers).length });
    }
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (i) => {
    if (picked != null) return;
    const ok = i === q.correctIndex;
    setAnswers((a) => ({ ...a, [order[idx]]: ok }));
    setChoices((c) => ({ ...c, [order[idx]]: i }));
    recordAnswer(lid(q), q.question, ok);
    if (sim) { setIdx((x) => x + 1); return; } // no feedback during a simulation
    setPicked(i);
    if (!ok) { setShake(true); setTimeout(() => setShake(false), 450); }
  };
  // The slide opened under a question closes when moving on.
  const [peek, setPeek] = useState(false);
  const next = () => { setPicked(null); setPeek(false); setIdx((i) => i + 1); };
  const restart = (onlyWrong) => {
    const wrong = order.filter((i) => answers[i] !== true);
    setOrder(onlyWrong && wrong.length ? wrong : questions.map((_, i) => i));
    setAnswers({});
    setChoices({});
    setPicked(null);
    setIdx(0);
    setTimeUp(false);
    setLeft(timeLimit);
    finished.current = false;
  };

  if (!questions.length) return <p className="muted">אין שאלות בסינון הזה.</p>;

  if (done) {
    const score = correctCount / order.length;
    const wrong = order.filter((i) => answers[i] !== true);
    const unanswered = order.length - Object.keys(answers).length;
    return (
      <motion.div className="card result-hero quiz-wrap" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} style={{ position: 'relative' }}>
        {score >= 0.8 && <Confetti />}
        <div style={{ display: 'grid', placeItems: 'center' }}><Ring value={score} size={130} stroke={11} color={score >= 0.8 ? 'var(--good)' : score >= 0.55 ? 'var(--warn)' : 'var(--bad)'} /></div>
        <h2 style={{ fontSize: 26, marginTop: 16 }}>
          {score >= 0.9 ? 'מצוין! שולטים בחומר 🏆' : score >= 0.7 ? 'יפה מאוד! עוד קצת ליטוש' : score >= 0.5 ? 'בכיוון הנכון – כדאי לחזור על החומר' : 'שווה לחזור לסיכום ולנסות שוב'}
        </h2>
        <p className="muted">
          {correctCount} תשובות נכונות מתוך {order.length}
          {timeUp && ' · נגמר הזמן'}
          {unanswered > 0 && ` · ${unanswered} בלי תשובה`}
          {sim && timeLimit > 0 && !timeUp && ` · ${mmss(timeLimit - left)} דקות`}
        </p>
        {wrong.length > 0 && (
          <div style={{ textAlign: 'start', margin: '20px auto', maxWidth: 640 }}>
            <h4 style={{ marginBottom: 8 }}>שאלות לחזרה <span className="faint" style={{ fontWeight: 500, fontSize: 13 }}>· לחיצה מציגה את התשובה וההסבר</span></h4>
            <div className="stack" style={{ gap: 6 }}>
              {wrong.map((i) => <ReviewItem key={i} q={questions[i]} picked={choices[i]} />)}
            </div>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
          {onMore && <button className="btn primary" onClick={onMore}><ArrowLeft size={16} /> {moreLabel || 'עוד שאלות'}</button>}
          {wrong.length > 0 && <button className="btn accent" onClick={() => restart(true)}><RotateCcw size={16} /> תרגול השגויות בלבד</button>}
          <button className="btn" onClick={() => restart(false)}><RotateCcw size={16} /> מהתחלה</button>
          {onExit && <button className="btn ghost" onClick={onExit}>סיום</button>}
        </div>
      </motion.div>
    );
  }

  const diff = DIFF[q.difficulty] || DIFF.medium;
  return (
    <div className="quiz-wrap">
      <div className="quiz-top">
        <span className="chip num">{idx + 1}/{order.length}</span>
        <div className="quiz-progress"><span style={{ width: `${(idx / order.length) * 100}%` }} /></div>
        {timeLimit > 0 ? (
          <span className={`chip num ${left <= 60 ? 'bad' : left <= timeLimit / 4 ? 'warn' : ''}`} aria-live={left <= 60 ? 'polite' : 'off'}><Timer size={13} /> {mmss(left)}</span>
        ) : !sim && <span className="chip good"><Trophy size={13} /> {correctCount}</span>}
        {exam && onExit && <button className="btn sm ghost" onClick={onExit}>יציאה</button>}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={order[idx] + '-' + idx} className={`card q-card ${shake ? 'shake' : ''}`} initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className={`chip ${diff.cls}`}>{diff.label}</span>
            {q.generated && <span className="chip c"><Sparkles size={12} /> נוצרה ב-AI</span>}
            {exam && q.lectureTitle && <span className="chip">{q.lectureTitle}</span>}
            <button className={`btn sm ghost flag-btn ${flagged ? 'on' : ''}`} onClick={() => toggleFlag(flagKey)} aria-pressed={flagged} title="שמירת השאלה לחזרה לפני המבחן">
              {flagged ? <BookmarkCheck size={15} /> : <Bookmark size={15} />} {flagged ? 'נשמרה לחזרה' : 'לחזרה'}
            </button>
          </div>
          <div className="q-text"><RichText>{q.question}</RichText></div>
          <div className="options">
            {q.options.map((o, i) => {
              const state = picked == null ? '' : i === q.correctIndex ? 'correct' : i === picked ? 'wrong' : '';
              return (
                <motion.button key={i} className={`option ${state}`} disabled={picked != null} onClick={() => choose(i)} whileTap={picked == null ? { scale: 0.98 } : undefined}>
                  <span className="letter">{state === 'correct' ? <Check size={16} /> : state === 'wrong' ? <X size={16} /> : hebLetters[i]}</span>
                  <span className="grow"><RichText>{o}</RichText></span>
                </motion.button>
              );
            })}
          </div>
          <AnimatePresence>
            {picked != null && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="explain">
                  <div style={{ fontWeight: 700, marginBottom: 4, color: picked === q.correctIndex ? 'var(--good)' : 'var(--bad)' }}>
                    {picked === q.correctIndex ? 'נכון! ' : `לא בדיוק – התשובה הנכונה: ${hebLetters[q.correctIndex]}`}
                  </div>
                  <Markdown>{q.explanation}</Markdown>
                </div>
                <div className="row wrap" style={{ marginTop: 14 }}>
                  {q.slide > 0 && !String(lid(q)).endsWith('-homework') && (
                    <button className={`btn sm ${peek ? 'accent' : ''}`} onClick={() => setPeek((x) => !x)} aria-expanded={peek}><Presentation size={14} /> {peek ? 'הסתרת השקף' : `לשקף ${q.slide}`}</button>
                  )}
                  <button className="local-only btn sm" onClick={() => openChat({ prompt: `בשאלה: "${q.question}" – ${picked === q.correctIndex ? 'עניתי נכון אבל' : `בחרתי "${q.options[picked]}" ו`}אני רוצה להבין לעומק למה התשובה הנכונה היא "${q.options[q.correctIndex]}".`, autoSend: true })}>
                    <Sparkles size={14} /> הסבר לי עוד
                  </button>
                  <div className="spacer" />
                  <button className="btn primary" onClick={next}>{idx + 1 === order.length ? 'לתוצאות' : 'לשאלה הבאה'} <ArrowLeft size={16} /></button>
                </div>
                <AnimatePresence>{peek && <SlidePeek key={`${lid(q)}-${q.slide}`} lectureId={lid(q)} slide={q.slide} onClose={() => setPeek(false)} />}</AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
