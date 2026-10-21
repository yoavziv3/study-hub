import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  CalendarDays, Pencil, Target, Flame, Timer, Bookmark, Layers, Sigma, ScrollText, ListChecks, Lightbulb, NotebookPen,
  Check, Plus, Trash2, ArrowLeft, ChevronDown, BookOpen, Crosshair, PartyPopper, Info, X, MapPin,
} from 'lucide-react';
import { useApp } from '../store.jsx';
import { Ring, fadeUp, ltr } from './ui.jsx';
import { isHard } from '../lib/srs.js';
import { Markdown } from './markdown.jsx';
import Quiz from './Quiz.jsx';
import {
  STRONG, LEVELS, levelOf, reasonOf, masteryMap, readiness, priorities, examEvents, nextEvent, fmtDay, fmtShortDay, todayKey,
  buildPlan, courseQuestions, mistakesOf, weakSet, daysUntil, questionKey,
} from '../lib/exam.js';

const SIM_SIZE = 20;
const SIM_SECONDS_PER_QUESTION = 90;
const pct = (x) => `${Math.round(x * 100)}%`;
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1]);

/** The student's own exam dates – when the university hasn't published them, or to replace them. */
function ExamDates({ course, initial, onDone }) {
  const { setExam, toast } = useApp();
  const [a, setA] = useState(initial?.a || '');
  const [b, setB] = useState(initial?.b || '');
  const save = (e) => {
    e.preventDefault();
    if (a && b && b < a) return toast('מועד ב׳ צריך להיות אחרי מועד א׳', 'info');
    setExam(course.id, { a, b });
    toast(a || b ? 'תאריכי המבחן נשמרו' : 'תאריכי המבחן נמחקו');
    onDone?.();
  };
  return (
    <form className="exam-dates" onSubmit={save}>
      <label className="field">מועד א׳<input className="input" type="date" value={a} onChange={(e) => setA(e.target.value)} /></label>
      <label className="field"><span>מועד ב׳ <span className="faint" style={{ fontWeight: 500 }}>(לא חובה)</span></span><input className="input" type="date" value={b} onChange={(e) => setB(e.target.value)} /></label>
      <button className="btn accent" type="submit">שמירה</button>
      {onDone && <button className="btn ghost" type="button" onClick={onDone}>ביטול</button>}
    </form>
  );
}

function Header({ course, sched, next, map, ready, stats, onPractice }) {
  const { setExam, setExamGroup, toast } = useApp();
  const [editing, setEditing] = useState(false);
  const level = ready >= STRONG ? 'good' : ready >= 0.45 ? 'warn' : 'bad';
  const official = sched.events.filter((e) => e.official);
  const byKey = (k) => sched.events.find((e) => e.key === k && !e.quiz)?.date || '';
  const resetOfficial = () => { setExam(course.id, {}); toast('חזרה לתאריכים של לוח הבחינות'); };
  return (
    <motion.div className="card pad prep-hero" variants={fadeUp} initial="hidden" animate="show">
      <div className="prep-hero-main">
        {next ? (
          <>
            <div className="prep-count">
              <span className="prep-count-num">{next.days === 0 ? '🎯' : next.days}</span>
              <span className="prep-count-label">{next.days === 0 ? `${next.quiz ? 'הבוחן' : 'המבחן'} היום` : next.days === 1 ? `יום ל${next.quiz ? 'בוחן' : 'מבחן'}` : `ימים ל${next.quiz ? 'בוחן' : 'מבחן'}`}</span>
            </div>
            <div className="grow" style={{ minWidth: 200 }}>
              <h2 style={{ fontSize: 22 }}>{next.label} · {fmtDay(next.date)}{next.time ? ` · ${next.time}` : ''}</h2>
              {next.place?.length > 0 && (
                <div className="exam-place"><MapPin size={14} /><div>{next.place.map((p) => <div key={p}>{ltr(p)}</div>)}</div></div>
              )}
              <p className="muted" style={{ margin: '6px 0 0' }}>
                {next.days === 0 ? 'בהצלחה! עברו על הצ׳קליסט והנוסחאות – ובלי חומר חדש היום.' : ready >= STRONG ? 'את/ה במצב טוב. עכשיו – סימולציות וחזרה על הטעויות.' : 'התוכנית למטה מתעדכנת לפי ההתקדמות שלך, כל יום מחדש.'}
              </p>
            </div>
          </>
        ) : (
          <div className="grow">
            <div className="row" style={{ gap: 10 }}>
              <div className="course-icon"><CalendarDays size={20} /></div>
              <h2 style={{ fontSize: 22 }}>{sched.events.length ? 'המבחנים בקורס הזה כבר עברו' : 'מתי המבחן?'}</h2>
            </div>
            <p className="muted" style={{ margin: '8px 0 12px' }}>
              {sched.events.length
                ? 'אפשר להזין תאריך חדש (למשל מועד מיוחד), ותיבנה תוכנית חדשה.'
                : 'התאריכים נמשכים אוטומטית מלוח הבחינות של האוניברסיטה, אבל לקורס הזה עוד לא פורסמו. אפשר להזין אותם בינתיים:'}
            </p>
            <ExamDates course={course} initial={{ a: byKey('a'), b: byKey('b') }} />
          </div>
        )}
        <div className="prep-ready">
          <Ring value={ready} size={96} stroke={9} color={`var(--${level})`} />
          <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>מוכנות</div>
        </div>
      </div>

      {sched.events.length > 0 && (
        <div className="exam-sched">
          <div className="row wrap" style={{ gap: 6 }}>
            {sched.events.map((e) => {
              const past = daysUntil(e.date) < 0;
              return (
                <span key={e.key} className={`chip ${e.key === next?.key ? 'warn' : past ? 'faded' : ''}`}>
                  {e.label} · {fmtShortDay(e.date)}{e.time ? ` ${e.time}` : ''}
                </span>
              );
            })}
          </div>
          <div className="row wrap faint" style={{ gap: 10, fontSize: 12.5, marginTop: 8 }}>
            <span>{sched.own ? 'מועד א׳/ב׳ – לפי התאריכים שהזנת' : official.length ? 'מלוח הבחינות של האוניברסיטה · מתעדכן אוטומטית' : ''}</span>
            {sched.differ && (
              <label className="row" style={{ gap: 6 }}>
                הקבוצה שלי:
                <select className="input sm" value={sched.group || ''} onChange={(e) => setExamGroup(course.id, e.target.value)}>
                  {sched.groups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
            )}
            <button className="linklike" onClick={() => setEditing(!editing)}><Pencil size={12} /> {sched.own ? 'עריכת התאריכים שלי' : 'להזין תאריכים אחרים'}</button>
            {sched.own && (course.exams?.groups?.[sched.group] || []).some((e) => !e.quiz) && <button className="linklike" onClick={resetOfficial}>חזרה ללוח הבחינות</button>}
          </div>
          {editing && <div style={{ marginTop: 12 }}><ExamDates course={course} initial={{ a: byKey('a'), b: byKey('b') }} onDone={() => setEditing(false)} /></div>}
        </div>
      )}

      <div className="prep-stats">
        <div><b>{stats.studied}/{map.length}</b><span>שיעורים נלמדו</span></div>
        {stats.quizTotal > 0 && <div><b>{stats.answered ? pct(stats.right / stats.answered) : '—'}</b><span>תשובות נכונות ({stats.answered}/{stats.quizTotal})</span></div>}
        {stats.cardsTotal > 0 && <div><b>{stats.known}/{stats.cardsTotal}</b><span>כרטיסיות שידעת</span></div>}
        {stats.quizTotal > 0 && (
          <div>
            <b>{stats.lastSim ? pct(stats.lastSim.correct / stats.lastSim.total) : '—'}</b>
            <span>{stats.lastSim ? 'בסימולציה האחרונה' : <button className="linklike" onClick={() => onPractice('sim')}>עוד לא עשית סימולציה</button>}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

const TASK = {
  weak: { icon: Crosshair, title: 'תרגול לפי החולשות', sub: '10 שאלות מהנושאים החלשים שלך' },
  sim: { icon: Timer, title: 'סימולציית מבחן בזמן', sub: `${SIM_SIZE} שאלות · ${(SIM_SIZE * SIM_SECONDS_PER_QUESTION) / 60} דקות, בלי רמזים` },
  mistakes: { icon: Bookmark, title: 'חזרה על הטעויות', sub: 'השאלות שטעית בהן ושמרת לחזרה' },
  cards: { icon: Layers, title: 'כרטיסיות', sub: 'מה שהגיע הזמן לחזור עליו' },
  past: { icon: ScrollText, title: 'מבחנים קודמים', sub: 'לפתור מבחן מלא, עם שעון' },
  review: { icon: BookOpen, title: 'חזרה כללית', sub: 'לעבור שוב על השיעורים והתרגילים – בעיקר מה שהיה קשה' },
  checklist: { icon: ListChecks, title: 'צ׳קליסט לפני המבחן', sub: 'לוודא שלא נשאר פער' },
};

function TaskRow({ done, icon: Icon, title, sub, children }) {
  return (
    <div className={`plan-task ${done ? 'done' : ''}`}>
      <span className="plan-check">{done ? <Check size={14} /> : <Icon size={15} />}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="plan-title">{title}</div>
        {sub && <div className="faint" style={{ fontSize: 13 }}>{sub}</div>}
      </div>
      <div className="row" style={{ gap: 6, flex: 'none' }}>{children}</div>
    </div>
  );
}

function Today({ course, ai, map, today, future, info, onPractice, onDone, exam }) {
  const [all, setAll] = useState(false);
  const byId = new Map(map.map((x) => [x.l.id, x]));
  const units = (today?.ids || []).map((id) => byId.get(id)).filter(Boolean);
  const others = today?.types || [];
  const lectureLink = (l, tab) => `/lecture/${l.id}${ai && l.kind !== 'homework' ? `?tab=${tab}` : ''}`;
  const doneOther = (t) => info.done[t];
  const total = units.length + others.length;
  const finished = units.filter((x) => x.m.value >= STRONG).length + others.filter(doneOther).length;
  const label = (t) => (t.type === 'unit' ? t.l.title : TASK[t.type].title);
  return (
    <div className="card pad">
      <div className="row" style={{ marginBottom: 12 }}>
        <h3 className="grow" style={{ fontSize: 17 }}>התוכנית להיום</h3>
        {total > 0 && <span className={`chip ${finished === total ? 'good' : ''}`}>{finished}/{total}</span>}
      </div>
      {exam.days === 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          <TaskRow icon={ListChecks} title="מעבר על הצ׳קליסט" sub="ולוודא שיש את כל מה שצריך לבחינה" done={info.done.checklist} />
          {ai && <TaskRow icon={Sigma} title="מבט אחרון על הנוסחאות" sub="בלי חומר חדש"><Link className="btn sm" to={`/course/${course.id}/formulas`}>לנוסחאות</Link></TaskRow>}
        </div>
      ) : total === 0 ? (
        <p className="muted" style={{ margin: 0 }}>אין משימות להיום 🎉</p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {units.map(({ l, m }) => (
            <TaskRow key={l.id} icon={BookOpen} done={m.value >= STRONG} title={l.title} sub={m.value >= STRONG ? 'הושלם' : m.value === 0 ? (ai && l.quizCount ? 'ללמוד את הסיכום, לסמן "נלמד" ולפתור את התרגול' : 'לעבור על החומר ולסמן "נלמד"') : reasonOf(m)}>
              <Link className="btn sm" to={lectureLink(l, 'summary')}>{ai && l.quizCount ? 'סיכום' : 'פתיחה'}</Link>
              {ai && l.quizCount > 0 && <Link className="btn sm ghost" to={lectureLink(l, 'practice')}>תרגול</Link>}
            </TaskRow>
          ))}
          {others.map((t) => {
            const T = TASK[t];
            const action = t === 'cards' ? <Link className="btn sm" to={`/course/${course.id}/flashcards`}>פתיחה</Link>
              : t === 'past' ? <Link className="btn sm" to={`/course/${course.id}/exams`}>פתיחה</Link>
              : t === 'checklist' || t === 'review' ? null
              : <button className="btn sm" onClick={() => onPractice(t)}>התחלה</button>;
            const manual = (t === 'past' || t === 'review') && !doneOther(t);
            return (
              <TaskRow key={t} icon={T.icon} title={T.title} sub={T.sub} done={doneOther(t)}>
                {action}
                {manual && <button className="btn sm ghost" onClick={() => onDone(t)}><Check size={14} /> סיימתי</button>}
              </TaskRow>
            );
          })}
          {finished === total && <div className="callout row" style={{ gap: 8 }}><PartyPopper size={17} /> סיימת את התוכנית להיום. רוצה להתקדם? המשימות של מחר כבר מחכות למטה.</div>}
        </div>
      )}
      {future.length > 0 && (
        <>
          <button className="btn sm ghost" style={{ marginTop: 14 }} onClick={() => setAll(!all)} aria-expanded={all}>
            <ChevronDown size={14} style={{ transform: all ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} /> {all ? 'הסתרת' : 'כל'} התוכנית עד המבחן ({future.length} ימים)
          </button>
          {all && (
            <div className="plan-days">
              {future.map((d) => (
                <div key={d.date} className="plan-day">
                  <div className="plan-date">{fmtShortDay(d.date)}</div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {d.tasks.map((t, i) => <span key={i} className={`chip ${t.type === 'unit' ? 'c' : ''}`}>{label(t)}</span>)}
                  </div>
                </div>
              ))}
              <div className="plan-day">
                <div className="plan-date">{fmtShortDay(exam.date)}</div>
                <span className="chip warn">🎯 {exam.label}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Priorities({ ai, list }) {
  if (!list.length) {
    return (
      <div className="card pad">
        <h3 style={{ fontSize: 17, marginBottom: 8 }}>מה ללמוד קודם?</h3>
        <p className="muted" style={{ margin: 0 }}>כל השיעורים בשליטה טובה 💪 מכאן – סימולציות וחזרה על הטעויות.</p>
      </div>
    );
  }
  return (
    <div className="card pad">
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>מה ללמוד קודם?</h3>
      <p className="faint" style={{ fontSize: 13, margin: '0 0 12px' }}>לפי מה שעוד לא למדת ואיפה טעית בתרגול – החלש ביותר למעלה.</p>
      <div className="stack" style={{ gap: 8 }}>
        {list.slice(0, 5).map(({ l, m }, i) => (
          <Link key={l.id} to={`/lecture/${l.id}${ai && l.quizCount ? (m.studied ? '?tab=practice' : '?tab=summary') : ''}`} className="priority-row">
            <span className="priority-num">{i + 1}</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650 }}>{l.title}</div>
              <div className="faint" style={{ fontSize: 13 }}>{reasonOf(m)}</div>
            </div>
            <span className={`chip ${LEVELS[levelOf(m.value)].cls}`}>{pct(m.value)}</span>
            <ArrowLeft size={16} className="faint" />
          </Link>
        ))}
      </div>
    </div>
  );
}

function MasteryMap({ map }) {
  const [filter, setFilter] = useState('all');
  const FILTERS = [['all', 'הכל'], ['weak', 'לחיזוק'], ['mid', 'כמעט שם'], ['strong', 'שליטה טובה'], ['new', 'טרם התחלת']];
  const shown = map.filter((x) => filter === 'all' || levelOf(x.m.value) === filter);
  const kindLabel = (l) => (l.kind === 'tutorial' ? 'תרגול' : l.kind === 'homework' ? 'תרגיל' : 'שיעור');
  return (
    <div className="card pad">
      <div className="row wrap" style={{ marginBottom: 12, gap: 8 }}>
        <h3 className="grow" style={{ fontSize: 17 }}>מפת שליטה</h3>
        <div className="row wrap" style={{ gap: 4 }}>
          {FILTERS.map(([id, label]) => {
            const n = id === 'all' ? map.length : map.filter((x) => levelOf(x.m.value) === id).length;
            if (id !== 'all' && !n) return null;
            return <button key={id} className={`btn sm ${filter === id ? 'accent' : 'ghost'}`} onClick={() => setFilter(id)} aria-pressed={filter === id}>{label} · {n}</button>;
          })}
        </div>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        {shown.map(({ l, m }) => {
          const lv = LEVELS[levelOf(m.value)];
          return (
            <Link key={l.id} to={`/lecture/${l.id}`} className="mastery-row">
              <span className="faint mastery-kind">{kindLabel(l)} {l.lessonNumber || ''}</span>
              <span className="grow mastery-title">{l.title}</span>
              <span className="mastery-bar" aria-hidden><span style={{ width: pct(m.value), background: `var(--${lv.cls || 'text-3'})` }} /></span>
              <span className="mastery-pct">{pct(m.value)}</span>
            </Link>
          );
        })}
      </div>
      <p className="faint" style={{ fontSize: 12.5, margin: '12px 0 0' }}>
        השליטה בכל שיעור מחושבת מסימון "נלמד", מהשאלות שענית עליהן נכון (התשובה האחרונה לכל שאלה) ומהכרטיסיות שידעת.
      </p>
    </div>
  );
}

function PracticeCards({ course, counts, onPractice }) {
  const items = [
    { id: 'weak', icon: Crosshair, title: 'תרגול לפי החולשות', sub: 'שאלות שטעית בהן ושאלות מהשיעורים החלשים', n: counts.questions ? 10 : 0 },
    { id: 'mistakes', icon: Bookmark, title: 'הטעויות שלי', sub: counts.mistakes ? `${counts.mistakes} שאלות לחזרה` : 'אין כרגע – כל הכבוד', n: counts.mistakes },
    { id: 'sim', icon: Timer, title: 'סימולציית מבחן', sub: `${Math.min(SIM_SIZE, counts.questions)} שאלות בזמן, משוב רק בסוף`, n: counts.questions },
  ];
  return (
    <div className="practice-grid">
      {items.map((it) => (
        <button key={it.id} className="card hover practice-tile" disabled={!it.n} onClick={() => onPractice(it.id)}>
          <div className="course-icon"><it.icon size={19} /></div>
          <div style={{ fontWeight: 700 }}>{it.title}</div>
          <div className="faint" style={{ fontSize: 13 }}>{it.sub}</div>
        </button>
      ))}
      <Link className="card hover practice-tile" to={`/course/${course.id}/flashcards`}>
        <div className="course-icon"><Layers size={19} /></div>
        <div style={{ fontWeight: 700 }}>כרטיסיות</div>
        <div className="faint" style={{ fontSize: 13 }}>{counts.dueCards ? `${counts.dueCards} מחכות לחזרה` : 'חזרה מהירה על המושגים'}</div>
      </Link>
      {counts.hardCards > 0 && (
        <Link className="card hover practice-tile" to={`/course/${course.id}/flashcards?cards=hard`}>
          <div className="course-icon"><Flame size={19} /></div>
          <div style={{ fontWeight: 700 }}>הכרטיסיות שקשות לי</div>
          <div className="faint" style={{ fontSize: 13 }}>{counts.hardCards} כרטיסיות שנשכחות שוב ושוב</div>
        </Link>
      )}
    </div>
  );
}

function MistakeItem({ x }) {
  const [open, setOpen] = useState(false);
  const { toggleFlag } = useApp();
  const { q } = x;
  return (
    <div className="review-item">
      <button className="review-q" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b style={{ background: x.wrong ? 'var(--bad)' : 'var(--warn)' }}>{x.wrong ? <X size={13} /> : <Bookmark size={12} />}</b>
        <span className="grow">{ltr(q.question)}<span className="faint" style={{ display: 'block', fontSize: 12.5 }}>{q.lectureTitle}</span></span>
        <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flex: 'none' }} />
      </button>
      {open && (
        <div className="review-a">
          <div style={{ fontWeight: 700, color: 'var(--good-text)', marginBottom: 6 }}>התשובה הנכונה: {ltr(q.options[q.correctIndex])}</div>
          <Markdown>{q.explanation}</Markdown>
          {x.flagged && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => toggleFlag(x.key)}>הסרה מהשמורות</button>}
        </div>
      )}
    </div>
  );
}

function Mistakes({ list, onPractice }) {
  const [more, setMore] = useState(false);
  if (!list.length) return null;
  const shown = more ? list : list.slice(0, 6);
  return (
    <div className="card pad">
      <div className="row wrap" style={{ marginBottom: 10, gap: 8 }}>
        <h3 className="grow" style={{ fontSize: 17 }}>הטעויות והשאלות ששמרת</h3>
        <button className="btn sm accent" onClick={() => onPractice('mistakes')}><Target size={14} /> תרגול כולן ({list.length})</button>
      </div>
      <p className="faint" style={{ fontSize: 13, margin: '0 0 10px' }}>שאלה שטעית בה יוצאת מהרשימה כשעונים עליה נכון. שאלה ששמרת עם "לחזרה" נשארת עד שמסירים אותה.</p>
      <div className="stack" style={{ gap: 6 }}>{shown.map((x) => <MistakeItem key={x.key} x={x} />)}</div>
      {list.length > 6 && <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setMore(!more)}>{more ? 'פחות' : `עוד ${list.length - 6}`}</button>}
    </div>
  );
}

function Checklist({ course, auto, prep }) {
  const { updatePrep } = useApp();
  const [text, setText] = useState('');
  const manual = [
    ...auto.manual,
    ...(prep.custom || []).map((c) => ({ id: c.id, label: c.text, custom: true })),
  ];
  const isDone = (it) => (it.auto ? it.done : !!prep.checks?.[it.id]);
  const all = [...auto.items, ...manual];
  const done = all.filter(isDone).length;
  const toggle = (id) => updatePrep(course.id, (p) => ({ ...p, checks: { ...p.checks, [id]: !p.checks?.[id] } }), { quiet: true });
  const add = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    updatePrep(course.id, (p) => ({ ...p, custom: [...(p.custom || []), { id: `c${Date.now().toString(36)}`, text: text.trim().slice(0, 200) }] }), { quiet: true });
    setText('');
  };
  const remove = (id) => updatePrep(course.id, (p) => {
    const checks = { ...p.checks };
    delete checks[id];
    return { ...p, checks, custom: (p.custom || []).filter((c) => c.id !== id) };
  }, { quiet: true });
  return (
    <div className="card pad">
      <div className="row" style={{ marginBottom: 12, gap: 12 }}>
        <Ring value={all.length ? done / all.length : 0} size={54} color={done === all.length ? 'var(--good)' : 'var(--c)'} />
        <div className="grow">
          <h3 style={{ fontSize: 17 }}>צ׳קליסט לפני המבחן</h3>
          <div className="faint" style={{ fontSize: 13 }}>{done} מתוך {all.length} · חלק מהסעיפים מסתמנים לבד לפי ההתקדמות</div>
        </div>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        {auto.items.map((it) => (
          <div key={it.id} className={`check-row auto ${it.done ? 'done' : ''}`} title="מסתמן אוטומטית">
            <span className="check-box">{it.done && <Check size={13} />}</span>
            <span className="grow">{it.label}</span>
            {it.hint && <span className="faint" style={{ fontSize: 12.5 }}>{it.hint}</span>}
          </div>
        ))}
        {manual.map((it) => (
          <div key={it.id} className={`check-row ${prep.checks?.[it.id] ? 'done' : ''}`}>
            <button className="check-box" onClick={() => toggle(it.id)} aria-pressed={!!prep.checks?.[it.id]} aria-label={it.label}>{prep.checks?.[it.id] && <Check size={13} />}</button>
            <span className="grow" onClick={() => toggle(it.id)}>{it.label}</span>
            {it.custom && <button className="btn sm icon ghost" onClick={() => remove(it.id)} aria-label="מחיקת הסעיף"><Trash2 size={13} /></button>}
          </div>
        ))}
      </div>
      <form className="row" style={{ gap: 6, marginTop: 10 }} onSubmit={add}>
        <input className="input grow" placeholder="סעיף משלך…" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
        <button className="btn sm" type="submit" disabled={!text.trim()}><Plus size={14} /> הוספה</button>
      </form>
    </div>
  );
}

function Tips({ bundle, map }) {
  const [more, setMore] = useState(false);
  // Round-robin over the lessons in course order, so the first few tips cover several lessons.
  const tips = useMemo(() => {
    const rank = new Map(map.map((x, i) => [x.l.id, i]));
    const per = (bundle?.lectures || [])
      .filter((l) => l.content?.examTips?.length)
      .sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999))
      .map((l) => l.content.examTips.map((t) => ({ t, l })));
    const out = [];
    for (let i = 0; per.some((p) => p[i]); i++) for (const p of per) if (p[i]) out.push(p[i]);
    return out;
  }, [bundle, map]);
  if (!tips.length) return null;
  const shown = more ? tips : tips.slice(0, 6);
  return (
    <div className="card pad">
      <h3 style={{ fontSize: 17, marginBottom: 10 }}><Lightbulb size={17} style={{ verticalAlign: -3 }} /> טיפים למבחן מהשיעורים</h3>
      <div className="stack" style={{ gap: 6 }}>
        {shown.map(({ t, l }, i) => (
          <div key={i} className="keypoint tip"><b>{i + 1}</b><div><Markdown>{t}</Markdown><Link className="faint" style={{ fontSize: 12.5 }} to={`/lecture/${l.id}?tab=summary`}>{l.title}</Link></div></div>
        ))}
      </div>
      {tips.length > 6 && <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setMore(!more)}>{more ? 'פחות' : `עוד ${tips.length - 6} טיפים`}</button>}
    </div>
  );
}

function MyNotes({ course, progress }) {
  const notes = course.lectures.filter((l) => progress.notes?.[l.id]?.trim());
  if (!notes.length) return null;
  return (
    <div className="card pad">
      <h3 style={{ fontSize: 17, marginBottom: 10 }}><NotebookPen size={17} style={{ verticalAlign: -3 }} /> ההערות שלך</h3>
      <div className="stack" style={{ gap: 8 }}>
        {notes.map((l) => (
          <Link key={l.id} to={`/lecture/${l.id}?tab=notes`} className="note-snippet">
            <div className="faint" style={{ fontSize: 12.5 }}>{l.title}</div>
            <div className="note-text">{progress.notes[l.id]}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** The course's exam-preparation page: countdown, readiness, today's plan, priorities, focused practice and a checklist. */
export default function ExamPrep({ course, bundle }) {
  const { progress, progressLoaded, updatePrep } = useApp();
  const ai = course.ai !== false;
  const sched = useMemo(() => examEvents(course, progress), [course, progress]);
  const next = useMemo(() => nextEvent(course, progress), [course, progress]);
  const prep = progress.prep?.[course.id] || { checks: {}, custom: [], sims: [] };
  const [run, setRun] = useState(null);
  const today = todayKey();

  const map = useMemo(() => masteryMap(course, progress), [course, progress]);
  const ready = readiness(map);
  const prio = useMemo(() => priorities(map), [map]);
  const questions = useMemo(() => (ai ? courseQuestions(bundle, course.id) : []), [ai, bundle, course.id]);
  const mistakes = useMemo(
    () => mistakesOf(questions, progress).map((x) => ({ ...x, key: questionKey(x.q) })),
    [questions, progress]
  );
  const pastExams = course.lectures.filter((l) => l.kind === 'exam');
  const hasQuiz = questions.length > 0;

  const stats = useMemo(() => {
    const s = { studied: 0, answered: 0, right: 0, quizTotal: 0, known: 0, cardsTotal: 0 };
    for (const { m } of map) {
      s.studied += m.studied ? 1 : 0;
      s.answered += m.quiz.answered;
      s.right += m.quiz.right;
      s.quizTotal += m.quiz.total;
      s.known += m.cards.known;
      s.cardsTotal += m.cards.total;
    }
    s.lastSim = prep.sims?.[prep.sims.length - 1];
    return s;
  }, [map, prep.sims]);

  const dueCards = useMemo(() => {
    const ids = new Set(course.lectures.map((l) => `${l.id}:`));
    return Object.entries(progress.cards || {}).filter(([k, c]) => c.due <= Date.now() && ids.has(k.slice(0, k.indexOf(':') + 1))).length;
  }, [course.lectures, progress.cards]);
  const hardCards = useMemo(() => {
    const ids = new Set(course.lectures.map((l) => `${l.id}:`));
    return Object.entries(progress.cards || {}).filter(([k, c]) => isHard(c) && ids.has(k.slice(0, k.indexOf(':') + 1))).length;
  }, [course.lectures, progress.cards]);

  // Today's tasks are fixed when the day starts (so finishing one doesn't pull tomorrow's in); the rest of
  // the plan is recomputed from the current progress.
  const fullPlan = useMemo(
    () => (next ? buildPlan({ map, examDate: next.date, hasQuiz, hasPastExams: pastExams.length > 0 }) : []),
    [map, next?.date, hasQuiz, pastExams.length] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const snapshotFresh = prep.today?.date === today && prep.today?.exam === next?.date;
  useEffect(() => {
    if (!progressLoaded || !next || snapshotFresh || !fullPlan.length) return;
    const first = fullPlan[0].tasks;
    updatePrep(course.id, (p) => ({
      ...p,
      today: { date: today, exam: next.date, ids: first.filter((t) => t.type === 'unit').map((t) => t.id), types: first.filter((t) => t.type !== 'unit').map((t) => t.type) },
    }), { quiet: true });
  }, [progressLoaded, next?.date, snapshotFresh, fullPlan.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const todayPlan = snapshotFresh ? prep.today : fullPlan[0] && {
    ids: fullPlan[0].tasks.filter((t) => t.type === 'unit').map((t) => t.id),
    types: fullPlan[0].tasks.filter((t) => t.type !== 'unit').map((t) => t.type),
  };
  const future = useMemo(() => {
    if (!next || next.days < 2) return [];
    const tomorrow = new Date(Date.now() + 86400000);
    const skip = new Set(todayPlan?.ids || []);
    return buildPlan({ map: map.filter((x) => !skip.has(x.l.id)), examDate: next.date, hasQuiz, hasPastExams: pastExams.length > 0, now: tomorrow });
  }, [map, next?.date, todayPlan?.ids?.join(), hasQuiz, pastExams.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Checklist items that tick themselves from the student's progress.
  const answeredShare = stats.quizTotal ? stats.answered / stats.quizTotal : 0;
  const auto = {
    items: [
      { id: 'studied', auto: true, label: 'עברתי על כל השיעורים והתרגולים', done: map.length > 0 && stats.studied === map.length, hint: `${stats.studied}/${map.length}` },
      ...(hasQuiz ? [
        { id: 'quiz', auto: true, label: 'תרגלתי את רוב שאלות התרגול', done: answeredShare >= 0.9, hint: pct(answeredShare) },
        { id: 'accuracy', auto: true, label: 'הגעתי ל־80% תשובות נכונות', done: stats.answered > 0 && stats.right / stats.answered >= 0.8, hint: stats.answered ? pct(stats.right / stats.answered) : '' },
        { id: 'mistakes', auto: true, label: 'תיקנתי את הטעויות שלי', done: stats.answered > 0 && !mistakes.some((x) => x.wrong), hint: mistakes.filter((x) => x.wrong).length ? `${mistakes.filter((x) => x.wrong).length} נשארו` : '' },
        { id: 'sim', auto: true, label: 'עשיתי סימולציה בזמן עם 70% ומעלה', done: (prep.sims || []).some((s) => s.correct / s.total >= 0.7) },
      ] : []),
      ...(pastExams.length ? [{ id: 'past', auto: true, label: 'פתרתי את המבחנים הקודמים (וסימנתי "נלמד")', done: pastExams.every((l) => progress.studied?.[l.id]), hint: `${pastExams.filter((l) => progress.studied?.[l.id]).length}/${pastExams.length}` }] : []),
    ],
    manual: [
      ...(ai ? [{ id: 'formulas', label: 'עברתי על דף הנוסחאות' }, { id: 'tips', label: 'קראתי את הטיפים למבחן' }] : []),
      { id: 'aids', label: 'בדקתי אילו חומרי עזר מותרים (מחשבון, דף נוסחאות)' },
      { id: 'place', label: 'בדקתי שעה וכיתה של הבחינה' },
      { id: 'last24', label: 'תכננתי את 24 השעות האחרונות – חזרה קלה ושינה טובה' },
    ],
  };
  const checklistDone = [...auto.items.filter((x) => x.done), ...auto.manual.filter((x) => prep.checks?.[x.id])].length === auto.items.length + auto.manual.length;
  const ranToday = (t) => prep.log?.date === today && prep.log.types?.includes(t);
  const info = {
    done: {
      weak: ranToday('weak'),
      sim: (prep.sims || []).some((s) => todayKey(new Date(s.at)) === today),
      mistakes: ranToday('mistakes') || (stats.answered > 0 && !mistakes.length),
      cards: dueCards === 0 && stats.known > 0,
      past: ranToday('past') || (pastExams.length > 0 && pastExams.every((l) => progress.studied?.[l.id])),
      review: ranToday('review'),
      checklist: checklistDone,
    },
  };

  const logToday = (kind) => updatePrep(course.id, (p) => ({ ...p, log: { date: today, types: [...new Set([...(p.log?.date === today ? p.log.types : []), kind])] } }), { quiet: true });
  const startPractice = (kind) => {
    let qs = [];
    if (kind === 'weak') qs = weakSet(questions, map, progress, 10);
    if (kind === 'mistakes') qs = mistakes.map((x) => x.q);
    if (kind === 'sim') qs = shuffle(questions).slice(0, SIM_SIZE);
    if (!qs.length) return;
    logToday(kind);
    setRun({ kind, key: Math.random(), questions: kind === 'sim' ? qs : shuffle(qs), timeLimit: kind === 'sim' ? qs.length * SIM_SECONDS_PER_QUESTION : 0 });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const finishSim = (r) => {
    if (r.total) updatePrep(course.id, (p) => ({ ...p, sims: [...(p.sims || []), { at: Date.now(), correct: r.correct, total: r.total }].slice(-12) }));
  };

  if (run) {
    const title = { weak: 'תרגול לפי החולשות', mistakes: 'חזרה על הטעויות', sim: 'סימולציית מבחן' }[run.kind];
    return (
      <div>
        <div className="row" style={{ marginBottom: 14, gap: 10 }}>
          <button className="btn sm ghost" onClick={() => setRun(null)}>→ חזרה להכנה למבחן</button>
          <h2 style={{ fontSize: 20 }}>{title}</h2>
        </div>
        {run.kind === 'sim' && <div className="callout row" style={{ gap: 8, marginBottom: 14, maxWidth: 760, marginInline: 'auto' }}><Info size={16} /> כמו במבחן: בלי משוב בזמן הפתרון. התשובות וההסברים – בסוף.</div>}
        <Quiz key={run.key} questions={run.questions} lectureId={null} exam sim={run.kind === 'sim'} timeLimit={run.timeLimit} onExit={() => setRun(null)} onFinish={run.kind === 'sim' ? finishSim : undefined} />
      </div>
    );
  }

  if (!map.length) {
    return <div className="empty"><div className="empty-icon"><Target size={28} /></div><h2>עוד אין חומר בקורס</h2><p>כשיעלו שיעורים, כאן תופיע התוכנית למבחן.</p></div>;
  }

  return (
    <div className="prep">
      <Header course={course} sched={sched} next={next} map={map} ready={ready} stats={stats} onPractice={startPractice} />
      {!ai && (
        <div className="callout row" style={{ gap: 8, marginTop: 14 }}>
          <Info size={16} /> בקורס הזה אין שאלות תרגול אוטומטיות, אז המוכנות מחושבת לפי השיעורים, התרגולים והתרגילים שסימנת כ"נלמד".
        </div>
      )}
      <div className="prep-grid">
        <div className="stack" style={{ gap: 18 }}>
          {next && <Today course={course} ai={ai} map={map} today={todayPlan} future={future} info={info} onPractice={startPractice} onDone={logToday} exam={next} />}
          <Priorities ai={ai} list={prio} />
          {hasQuiz && <PracticeCards course={course} counts={{ questions: questions.length, mistakes: mistakes.length, dueCards, hardCards }} onPractice={startPractice} />}
          <Mistakes list={mistakes} onPractice={startPractice} />
          <MasteryMap map={map} />
        </div>
        <div className="stack" style={{ gap: 18 }}>
          <Checklist course={course} auto={auto} prep={prep} />
          {ai && (
            <Link to={`/course/${course.id}/formulas`} className="card hover pad row" style={{ gap: 12 }}>
              <div className="course-icon"><Sigma size={19} /></div>
              <div className="grow"><div style={{ fontWeight: 700 }}>דף הנוסחאות של הקורס</div><div className="faint" style={{ fontSize: 13 }}>כל הנוסחאות במקום אחד, מוכן להדפסה</div></div>
              <ArrowLeft size={16} className="faint" />
            </Link>
          )}
          {pastExams.length > 0 && (
            <Link to={`/course/${course.id}/exams`} className="card hover pad row" style={{ gap: 12 }}>
              <div className="course-icon"><ScrollText size={19} /></div>
              <div className="grow"><div style={{ fontWeight: 700 }}>מבחנים קודמים</div><div className="faint" style={{ fontSize: 13 }}>{pastExams.length} מבחנים מהמודל</div></div>
              <ArrowLeft size={16} className="faint" />
            </Link>
          )}
          <Tips bundle={bundle} map={map} />
          <MyNotes course={course} progress={progress} />
        </div>
      </div>
      {next && next.days > 0 && daysUntil(next.date) <= 3 && <div className="callout row" style={{ gap: 8, marginTop: 18 }}><Flame size={16} /> שלושה ימים אחרונים: פחות חומר חדש, יותר סימולציות ותיקון טעויות.</div>}
    </div>
  );
}
