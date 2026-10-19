import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, X, ArrowLeft, RotateCcw, Presentation, Sparkles, Trophy } from 'lucide-react';
import { useApp } from '../store.jsx';
import { hebLetters, shuffle } from '../api.js';
import { Markdown, Ring, ltr } from './ui.jsx';

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
 */
// Shuffle answer options once per quiz so the correct answer's position carries no signal.
function shuffleOptions(q) {
  const order = shuffle(q.options.map((_, i) => i));
  return { ...q, options: order.map((i) => q.options[i]), correctIndex: order.indexOf(q.correctIndex) };
}

export default function Quiz({ questions: source, lectureId, exam = false, onExit, onSlide }) {
  const { recordAnswer, openChat } = useApp();
  // Frozen per mount: parents pass a fresh array on every render, and reshuffling mid-question would
  // desync the displayed options from the recorded answer. Callers remount (key) for a new set.
  const [questions] = useState(() => source.map(shuffleOptions));
  const [order, setOrder] = useState(() => questions.map((_, i) => i));
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [answers, setAnswers] = useState({});
  const [shake, setShake] = useState(false);
  const done = idx >= order.length;
  const q = questions[order[idx]];
  const correctCount = Object.values(answers).filter(Boolean).length;

  const choose = (i) => {
    if (picked != null) return;
    setPicked(i);
    const ok = i === q.correctIndex;
    setAnswers((a) => ({ ...a, [order[idx]]: ok }));
    recordAnswer(lectureId || q.lectureId, q.question, ok);
    if (!ok) { setShake(true); setTimeout(() => setShake(false), 450); }
  };
  const next = () => { setPicked(null); setIdx((i) => i + 1); };
  const restart = (onlyWrong) => {
    const wrong = order.filter((i) => answers[i] === false);
    setOrder(onlyWrong && wrong.length ? wrong : questions.map((_, i) => i));
    setAnswers({});
    setPicked(null);
    setIdx(0);
  };

  if (!questions.length) return <p className="muted">אין שאלות בסינון הזה.</p>;

  if (done) {
    const score = correctCount / order.length;
    const wrong = order.filter((i) => answers[i] === false);
    return (
      <motion.div className="card result-hero quiz-wrap" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} style={{ position: 'relative' }}>
        {score >= 0.8 && <Confetti />}
        <div style={{ display: 'grid', placeItems: 'center' }}><Ring value={score} size={130} stroke={11} color={score >= 0.8 ? 'var(--good)' : score >= 0.55 ? 'var(--warn)' : 'var(--bad)'} /></div>
        <h2 style={{ fontSize: 26, marginTop: 16 }}>
          {score >= 0.9 ? 'מצוין! שולטים בחומר 🏆' : score >= 0.7 ? 'יפה מאוד! עוד קצת ליטוש' : score >= 0.5 ? 'בכיוון הנכון – כדאי לחזור על החומר' : 'שווה לחזור לסיכום ולנסות שוב'}
        </h2>
        <p className="muted">{correctCount} תשובות נכונות מתוך {order.length}</p>
        {wrong.length > 0 && (
          <div style={{ textAlign: 'start', margin: '20px auto', maxWidth: 640 }}>
            <h4 style={{ marginBottom: 8 }}>שאלות לחזרה:</h4>
            <div className="stack" style={{ gap: 6 }}>
              {wrong.map((i) => (
                <div key={i} className="keypoint"><b style={{ background: 'var(--bad)' }}><X size={13} /></b><span>{ltr(questions[i].question)}</span></div>
              ))}
            </div>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
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
        <span className="chip good"><Trophy size={13} /> {correctCount}</span>
        {exam && onExit && <button className="btn sm ghost" onClick={onExit}>יציאה</button>}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={order[idx] + '-' + idx} className={`card q-card ${shake ? 'shake' : ''}`} initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className={`chip ${diff.cls}`}>{diff.label}</span>
            {q.generated && <span className="chip c"><Sparkles size={12} /> נוצרה ב-AI</span>}
            {exam && q.lectureTitle && <span className="chip">{q.lectureTitle}</span>}
          </div>
          <div className="q-text">{ltr(q.question)}</div>
          <div className="options">
            {q.options.map((o, i) => {
              const state = picked == null ? '' : i === q.correctIndex ? 'correct' : i === picked ? 'wrong' : '';
              return (
                <motion.button key={i} className={`option ${state}`} disabled={picked != null} onClick={() => choose(i)} whileTap={picked == null ? { scale: 0.98 } : undefined}>
                  <span className="letter">{state === 'correct' ? <Check size={16} /> : state === 'wrong' ? <X size={16} /> : hebLetters[i]}</span>
                  <span className="grow">{ltr(o)}</span>
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
                  {q.slide > 0 && (onSlide && !exam ? (
                    <button className="btn sm" onClick={() => onSlide(q.slide)}><Presentation size={14} /> לשקף {q.slide}</button>
                  ) : (
                    <Link className="btn sm" to={`/lecture/${q.lectureId || lectureId}?tab=slides&slide=${q.slide}`}><Presentation size={14} /> לשקף {q.slide}</Link>
                  ))}
                  <button className="local-only btn sm" onClick={() => openChat({ prompt: `בשאלה: "${q.question}" – ${picked === q.correctIndex ? 'עניתי נכון אבל' : `בחרתי "${q.options[picked]}" ו`}אני רוצה להבין לעומק למה התשובה הנכונה היא "${q.options[q.correctIndex]}".`, autoSend: true })}>
                    <Sparkles size={14} /> הסבר לי עוד
                  </button>
                  <div className="spacer" />
                  <button className="btn primary" onClick={next}>{idx + 1 === order.length ? 'לתוצאות' : 'לשאלה הבאה'} <ArrowLeft size={16} /></button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
