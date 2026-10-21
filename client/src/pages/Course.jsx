import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Target, Layers, BookMarked, FlaskConical, Upload, Check, Loader2, AlertTriangle, Users, Sigma, Sparkles, Presentation, PencilRuler, Eye, EyeOff, Wand2, Award, ExternalLink, Info, FileText, Link2, ScrollText, GraduationCap, Printer } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, thumbUrl, useFetch, shuffle } from '../api.js';
import { CourseIcon, Page, Ring, Tabs, fadeUp, safeHref } from '../components/ui.jsx';
import { Markdown, Tex, RichText } from '../components/markdown.jsx';
import Quiz from '../components/Quiz.jsx';
import Flashcards from '../components/Flashcards.jsx';
import Glossary from '../components/Glossary.jsx';
import CourseSummaries from '../components/CourseSummaries.jsx';
import CourseLinks from '../components/CourseLinks.jsx';
import { LABS } from '../labs/index.js';
import { AssignmentLine } from '../components/Assignment.jsx';
import ExamPrep from '../components/ExamPrep.jsx';
import { nextEvent, daysText } from '../lib/exam.js';

function LectureCard({ l, course, i }) {
  const { progress } = useApp();
  const studied = progress.studied[l.id];
  const q = progress.quiz[l.id];
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" custom={i}>
      <Link to={`/lecture/${l.id}`} className="card hover lecture-card">
        <div className="lecture-thumb">
          {l.slideCount > 0 && thumbUrl(l) && <img src={thumbUrl(l)} alt="" loading="lazy" />}
          <span className="badge chip" style={{ background: 'rgba(0,0,0,.6)', color: '#fff', borderColor: 'transparent' }}>{l.slideCount} שקפים</span>
        </div>
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            {l.unitNumber && course.unitLabel === 'יחידה' && <span className="chip c">יחידה {l.unitNumber}</span>}
            {l.status === 'processing' && <span className="chip warn"><Loader2 size={12} className="spin" /> בעיבוד</span>}
            {l.status === 'error' && <span className="chip bad"><AlertTriangle size={12} /> שגיאה</span>}
            {l.source?.type === 'moodle' && <span className="chip">ממודל</span>}
            {studied && <span className="studied-check" title="סומן כנלמד"><Check size={13} /></span>}
          </div>
          <h2 className="lecture-card-title">{l.title}</h2>
          {l.kind === 'homework' && <AssignmentLine assignment={l.source?.assignment} />}
          <p>{l.overview ? <RichText>{l.overview}</RichText> : l.originalName}</p>
          <div className="row wrap" style={{ gap: 6 }}>
            {l.topicCount > 0 && <span className="chip">{l.topicCount} נושאים</span>}
            {l.quizCount > 0 && <span className="chip">{l.quizCount} שאלות</span>}
            {l.flashcardCount > 0 && <span className="chip">{l.flashcardCount} כרטיסיות</span>}
            {q && <span className="chip good">{Math.round((q.correct / q.answered) * 100)}% הצלחה</span>}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function ExamMode({ bundle, courseId }) {
  const { updatePrep } = useApp();
  const [count, setCount] = useState(12);
  const [source, setSource] = useState('all');
  const [mode, setMode] = useState('practice');
  const [run, setRun] = useState(null);
  const ready = bundle.lectures.filter((l) => l.content?.quiz?.length);
  const start = () => {
    const pool = ready
      .filter((l) => source === 'all' || l.id === source)
      .flatMap((l) => [...(l.content.quiz || []), ...(l.content.extraQuiz || [])].map((q) => ({ ...q, lectureId: l.id, lectureTitle: l.title })));
    const questions = shuffle(pool).slice(0, count);
    setRun({ key: Math.random(), questions, sim: mode === 'sim', timeLimit: mode === 'sim' ? questions.length * 90 : 0 });
  };
  const finishSim = (r) => {
    if (r.total) updatePrep(courseId, (p) => ({ ...p, sims: [...(p.sims || []), { at: Date.now(), correct: r.correct, total: r.total }].slice(-12) }));
  };
  if (!ready.length) return <Empty course={bundle} text="מבחן התרגול ייבנה מהשאלות של ההרצאות שיועלו." />;
  if (run) return <Quiz key={run.key} questions={run.questions} lectureId={null} exam sim={run.sim} timeLimit={run.timeLimit} onFinish={run.sim ? finishSim : undefined} onExit={() => setRun(null)} />;
  return (
    <div className="card pad" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
      <div className="empty-icon" style={{ marginBottom: 14 }}><Target size={30} /></div>
      <h2 style={{ fontSize: 24 }}>מבחן תרגול – {bundle.short}</h2>
      <p className="muted">{mode === 'sim' ? 'כמו במבחן: שעון רץ (דקה וחצי לשאלה) ובלי משוב בזמן הפתרון – התשובות וההסברים בסוף.' : 'שאלות מעורבבות מכל ההרצאות, עם משוב והסבר אחרי כל תשובה וציון בסוף.'}</p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
        <div className="tabs">
          {[['practice', 'תרגול עם משוב'], ['sim', 'סימולציה בזמן']].map(([id, label]) => (
            <button key={id} className={`tab ${mode === id ? 'active' : ''}`} onClick={() => setMode(id)} aria-pressed={mode === id}>
              {mode === id && <motion.span layoutId="exam-mode" className="tab-bg" />}
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'center', marginTop: 18, gap: 12, flexWrap: 'wrap' }}>
        <label className="field" style={{ width: 220 }}>
          חומר
          <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">כל ההרצאות</option>
            {ready.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
          </select>
        </label>
        <label className="field" style={{ width: 140 }}>
          מספר שאלות
          <select className="input" value={count} onChange={(e) => setCount(+e.target.value)}>
            {[8, 12, 20, 30, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <button className="btn accent" style={{ marginTop: 20, height: 46, padding: '0 28px' }} onClick={start}>התחלת מבחן</button>
    </div>
  );
}

function Problem({ p, i }) {
  const [open, setOpen] = useState(false);
  const DIFF = { easy: ['קל', 'good'], medium: ['בינוני', 'warn'], hard: ['קשה', 'bad'] };
  const [label, cls] = DIFF[p.difficulty] || DIFF.medium;
  return (
    <motion.div className="card pad" variants={fadeUp} initial="hidden" animate="show" custom={i % 10}>
      <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
        <span className="topic-index" style={{ width: 34, height: 34, fontSize: 15 }}>{i + 1}</span>
        <span className={`chip ${cls}`}>{label}</span>
        {p.topic && <span className="chip c">{p.topic}</span>}
      </div>
      <Markdown>{p.question}</Markdown>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
            <div className="explain"><Markdown>{p.solution}</Markdown></div>
            <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setOpen(false)}><EyeOff size={14} /> הסתרת הפתרון</button>
          </motion.div>
        ) : (
          <motion.div exit={{ opacity: 0 }} style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={() => setOpen(true)}><Eye size={14} /> הצגת פתרון מלא</button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function HomeworkPractice({ course, bundle, setBundle }) {
  const { toast } = useApp();
  const practice = bundle.practice || { quiz: [], problems: [] };
  const [count, setCount] = useState(5);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('problems');
  // Exercises set the style; before there are any, the lectures do (exams and files kept as is don't count).
  const hasMaterial = bundle.lectures.some((l) => kindOf(l) !== 'exam' && kindOf(l) !== 'prep' && !l.noAi && l.status === 'ready');
  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/courses/${course.id}/practice`, { count, topic });
      setBundle({ ...bundle, practice: r.practice });
      toast(`נוספו ${r.added.problems} תרגילים ו-${r.added.quiz} שאלות`);
    } catch (e) {
      toast(e.message, 'info');
    } finally {
      setBusy(false);
    }
  };
  const problems = practice.problems;
  return (
    <div style={{ marginTop: 34 }}>
      <div className="section-title" style={{ marginTop: 0 }}><h2>תרגול ברמת שיעורי הבית</h2><div className="line" /></div>
      <p className="muted" style={{ marginTop: -6 }}>
        תרגילים חדשים באותה רמה ובאותו סגנון כמו שיעורי הבית והתרגולים של הקורס (או ההרצאות, כשעוד אין תרגול), רק על מה שכבר נלמד, עם פתרון מלא לכל תרגיל.
      </p>
      <div className="card pad local-only row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 130 }}>מספר תרגילים
          <select className="input" value={count} onChange={(e) => setCount(+e.target.value)}>{[3, 5, 8, 10].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        <label className="field grow" style={{ minWidth: 200 }}>נושא (לא חובה)
          <input className="input" placeholder="למשל: נגזרות, רישומי התאמה…" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <button className="btn accent" style={{ height: 42 }} disabled={busy || !hasMaterial} onClick={generate}>
          {busy ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />} {busy ? 'כותב תרגילים… (כדקה–שתיים)' : 'צור תרגילים חדשים'}
        </button>
        {!hasMaterial && <div className="faint" style={{ fontSize: 13, width: '100%' }}>התרגול ייווצר אחרי שיעלו לקורס הרצאות, תרגולים או שיעורי בית.</div>}
      </div>
      {(problems.length > 0 || practice.quiz.length > 0) && (
        <>
          <div className="row" style={{ margin: '18px 0 12px', justifyContent: 'center' }}>
            <div className="tabs">
              {[['problems', `תרגילים פתוחים (${problems.length})`], ['quiz', `שאלות אמריקאיות (${practice.quiz.length})`]].map(([id, label]) => (
                <button key={id} className={`tab ${mode === id ? 'active' : ''}`} onClick={() => setMode(id)}>
                  {mode === id && <motion.span layoutId="hw-mode" className="tab-bg" />}
                  {label}
                </button>
              ))}
            </div>
          </div>
          {mode === 'problems' && <div className="stack">{problems.map((p, i) => <Problem key={p.at + i} p={p} i={i} />)}</div>}
          {mode === 'quiz' && practice.quiz.length > 0 && <Quiz key={practice.quiz.length} questions={practice.quiz} lectureId={`${course.id}-homework`} />}
        </>
      )}
    </div>
  );
}

/** The student's grades in this course, straight from Moodle. */
function Grades({ course }) {
  const { data, error, loading } = useFetch(`/api/me/grades/${course.id}`);
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Loader2 className="spin" /></div>;
  if (error) return <div className="card pad muted" style={{ textAlign: 'center' }}>{error}</div>;
  const graded = (data?.items || []).filter((g) => g.grade);
  const total = data?.items.find((g) => g.total);
  return (
    <div className="stack" style={{ gap: 10, maxWidth: 760 }}>
      {graded.length === 0 && <div className="card pad muted" style={{ textAlign: 'center' }}>עוד אין ציונים בקורס הזה במודל.</div>}
      {(data?.items || []).filter((g) => !g.total).map((g, i) => (
        <motion.div key={i} className="card pad row" style={{ gap: 14, padding: '14px 18px' }} variants={fadeUp} initial="hidden" animate="show" custom={i % 10}>
          <div className="deadline-icon" style={{ '--dl': g.grade ? 'var(--good)' : 'var(--text-3)' }}><Award size={18} /></div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{g.name}</div>
            {g.feedback && <div className="faint" style={{ fontSize: 13 }}>{g.feedback}</div>}
          </div>
          <div style={{ textAlign: 'end' }}>
            <div style={{ fontWeight: 800, fontSize: 18 }} dir="ltr">{g.grade || '—'}</div>
            {g.percentage && <div className="faint" style={{ fontSize: 12.5 }} dir="ltr">{g.percentage}</div>}
          </div>
          {safeHref(g.url) && <a className="btn sm icon ghost" href={safeHref(g.url)} target="_blank" rel="noreferrer" title="במודל"><ExternalLink size={14} /></a>}
        </motion.div>
      ))}
      {total?.grade && (
        <div className="card pad row" style={{ gap: 12, background: 'var(--c-soft)' }}>
          <b className="grow">ציון הקורס עד כה</b>
          <b style={{ fontSize: 20 }} dir="ltr">{total.grade}</b>
        </div>
      )}
    </div>
  );
}

const KIND = {
  lecture: { tab: 'שיעורים', group: 'שיעור', empty: 'הרצאות' },
  tutorial: { tab: 'תרגולים', group: 'תרגול', empty: 'תרגולים' },
  homework: { tab: 'שיעורי בית ותרגילים', group: 'מס׳', empty: 'שיעורי בית או תרגילים' },
  exam: { tab: 'מבחנים קודמים', group: 'מבחן', empty: 'מבחנים קודמים' },
};
const kindOf = (l) => l.kind || 'lecture';

function Empty({ course, text, what = 'הרצאות' }) {
  const { openUpload } = useApp();
  return (
    <motion.div className="empty" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
      <div className="empty-icon"><CourseIcon name={course.icon} size={30} /></div>
      <h2>עדיין אין כאן {what}</h2>
      <p>{text || 'גררו לכאן מצגת או לחצו להעלאה – היא תומר לשקפים, תסוכם ותחולק לנושאים אוטומטית.'}</p>
      <button className="local-only btn accent" onClick={() => openUpload(course.id)}><Upload size={17} /> העלאת הרצאה ל{course.short}</button>
    </motion.div>
  );
}

export default function Course() {
  const { id, tab = 'lessons' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { setContext, openUpload, openChat, progress } = useApp();
  const { data: course } = useFetch(`/api/courses/${id}`, { poll: (d) => d.lectures.some((l) => l.status === 'processing') });
  const needsBundle = !['lessons', 'tutorials', 'labs', 'grades', 'links', 'exams'].includes(tab);
  const { data: links } = useFetch(`/api/courses/${id}/links`);
  const { data: bundle, setData: setBundle } = useFetch(needsBundle ? `/api/courses/${id}/bundle` : null);
  const [labOpen, setLabOpen] = useState(null);

  useEffect(() => {
    if (course) setContext({ courseId: course.id, color: course.color, label: course.short });
  }, [course?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const out = {};
    for (const kind of Object.keys(KIND)) {
      const g = new Map();
      for (const l of (course?.lectures || []).filter((x) => kindOf(x) === kind)) {
        const k = l.lessonNumber || 0;
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(l);
      }
      out[kind] = [...g.entries()].sort((a, b) => (a[0] || 99) - (b[0] || 99));
    }
    return out;
  }, [course]);

  if (!course) return <Page><div style={{ padding: 60, textAlign: 'center' }}><Loader2 className="spin" /></div></Page>;

  const labs = LABS[course.id] || [];
  const studied = course.lectures.filter((l) => progress.studied[l.id]).length;
  const flashTotal = course.lectures.reduce((s, l) => s + l.flashcardCount, 0);
  const quizTotal = course.lectures.reduce((s, l) => s + l.quizCount, 0);
  // Courses built for other students have no AI material: files, the lecturer's exercises and grades only.
  const ai = course.ai !== false;
  const exam = nextEvent(course, progress);
  const tabs = [
    { id: 'lessons', label: 'שיעורים', icon: <BookOpen size={16} />, count: course.lectures.filter((l) => kindOf(l) === 'lecture').length },
    ...(ai ? [{ id: 'summaries', label: 'סיכומים', icon: <FileText size={16} />, count: course.lectures.filter((l) => kindOf(l) !== 'homework' && l.hasContent).length || null }] : []),
    { id: 'prep', label: 'הכנה למבחן', icon: <GraduationCap size={16} /> },
    { id: 'tutorials', label: 'תרגולים', icon: <Presentation size={16} />, count: course.lectures.filter((l) => kindOf(l) === 'tutorial').length || null },
    { id: 'homework', label: ai ? 'שיעורי בית ותרגילים' : 'תרגול מהמרצה', icon: <PencilRuler size={16} />, count: course.lectures.filter((l) => kindOf(l) === 'homework').length || null },
    ...(ai
      ? [
          { id: 'exam', label: 'מבחן תרגול', icon: <Target size={16} />, count: quizTotal || null },
          { id: 'flashcards', label: 'כרטיסיות', icon: <Layers size={16} />, count: flashTotal || null },
          { id: 'glossary', label: 'מילון מושגים', icon: <BookMarked size={16} /> },
          { id: 'formulas', label: 'נוסחאות', icon: <Sigma size={16} /> },
        ]
      : []),
    ...(labs.length ? [{ id: 'labs', label: 'מעבדה אינטראקטיבית', icon: <FlaskConical size={16} />, count: labs.length }] : []),
    { id: 'exams', label: 'מבחנים קודמים', icon: <ScrollText size={16} />, count: course.lectures.filter((l) => kindOf(l) === 'exam').length || null },
    ...(links?.length ? [{ id: 'links', label: 'קישורים', icon: <Link2 size={16} />, count: links.length }] : []),
    { id: 'grades', label: 'ציונים', icon: <Award size={16} /> },
  ];

  const allCards = bundle?.lectures.flatMap((l) => (l.content?.flashcards || []).map((c) => ({ ...c, lectureId: l.id, lectureTitle: l.title }))) || [];
  const cardLectures = bundle?.lectures.filter((l) => l.kind !== 'exam' && l.content).map((l) => ({ id: l.id, title: l.title })) || [];
  const allTerms = bundle?.lectures.flatMap((l) => (l.content?.glossary || []).map((g) => ({ ...g, lectureId: l.id, lectureTitle: l.title }))) || [];
  const allFormulas = bundle?.lectures.flatMap((l) => (l.content?.formulas || []).map((f) => ({ ...f, lectureId: l.id, lectureTitle: l.title }))) || [];
  const Lab = labOpen && labs.find((x) => x.id === labOpen);

  return (
    <Page>
      <div data-color={course.color}>
        <motion.div className="course-head" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="pattern" />
          <div className="row" style={{ alignItems: 'flex-start', gap: 18, position: 'relative' }}>
            <motion.div className="course-icon" style={{ width: 62, height: 62, borderRadius: 18 }} initial={{ rotate: -12, scale: 0.8 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
              <CourseIcon name={course.icon} size={30} />
            </motion.div>
            <div className="grow">
              <div className="course-code">{course.code}</div>
              <h1>{course.name}</h1>
              <div className="meta">
                {exam && <Link to={`/course/${course.id}/prep`} className="chip warn">🎯 {exam.label} {daysText(exam.days)}</Link>}
                {course.staff.length > 0 && <span className="chip"><Users size={13} /> {course.staff.join(' · ')}</span>}
                <span className="chip">{course.lectures.filter((l) => kindOf(l) === 'lecture').length} {course.unitLabel === 'יחידה' ? 'יחידות' : 'הרצאות'}</span>
                {course.lectures.some((l) => kindOf(l) === 'tutorial') && <span className="chip">{course.lectures.filter((l) => kindOf(l) === 'tutorial').length} תרגולים</span>}
                {course.lectures.some((l) => kindOf(l) === 'homework') && <span className="chip">{course.lectures.filter((l) => kindOf(l) === 'homework').length} שיעורי בית ותרגילים</span>}
                <span className="chip">{course.lectures.reduce((s, l) => s + (l.slideCount || 0), 0)} שקפים</span>
              </div>
            </div>
            <div className="row" style={{ gap: 14 }}>
              <Ring value={course.lectures.length ? studied / course.lectures.length : 0} size={74} stroke={7} />
              <div className="stack" style={{ gap: 8 }}>
                <button className="local-only btn accent" onClick={() => openUpload(course.id)}><Upload size={16} /> העלאה</button>
                <button className="local-only btn" onClick={() => openChat()}><Sparkles size={16} /> שאלה על הקורס</button>
              </div>
            </div>
          </div>
        </motion.div>

        <div style={{ margin: '22px 0 6px' }}>
          <Tabs tabs={tabs} value={tab} onChange={(t) => { setLabOpen(null); navigate(`/course/${id}/${t === 'lessons' ? '' : t}`, { replace: true }); }} layoutId="course-tab" />
        </div>

        {[['lessons', 'lecture'], ['tutorials', 'tutorial'], ['homework', 'homework'], ['exams', 'exam']].map(([t, kind]) => tab === t && (
          <div key={t}>
            {groups[kind].length === 0 ? (
              <div style={{ marginTop: 22 }}><Empty course={course} what={KIND[kind].empty} text={kind === 'lecture' ? undefined : kind === 'exam' ? 'כשהמרצה יעלה מבחנים קודמים למודל (בדרך כלל לקראת סוף הסמסטר) הם ייכנסו לכאן אוטומטית. אפשר גם להעלות מבחן ידנית ולבחור "מבחן קודם".' : `${KIND[kind].empty} נכנסים לכאן אוטומטית ממודל, או בהעלאה ידנית (בחירת הסוג בחלון ההעלאה).`} /></div>
            ) : (
              groups[kind].map(([num, ls]) => (
                <div className="lesson-group" key={num}>
                  <div className="lesson-num"><span>{KIND[kind].group}</span><b>{num || '•'}</b></div>
                  <div className="lecture-list">{ls.map((l, i) => <LectureCard key={l.id} l={l} course={course} i={i} />)}</div>
                </div>
              ))
            )}
            {kind === 'lecture' && course.lectures.some((l) => l.kind === 'prep' && l.hasContent) && (
              <Link to={`/course/${course.id}/prep`} className="callout row" style={{ marginTop: 18, gap: 10 }}>
                <GraduationCap size={17} />
                <span className="grow">השיעורים הבאים מהסמסטר הקודם ({course.lectures.filter((l) => l.kind === 'prep' && l.hasContent).length}), עם סיכומים ושאלות, נמצאים ב"הכנה למבחן".</span>
              </Link>
            )}
            {kind === 'homework' && course.ai === false && (
              <div className="callout row" style={{ marginTop: 18, gap: 10 }}>
                <Info size={17} />
                <span>בקורס הזה התרגול הוא חוברות התרגילים והתרגולים של המרצה, ישירות מהמודל. סמנו כל אחד כ"נלמד" כשסיימתם אותו.</span>
              </div>
            )}
            {kind === 'homework' && bundle && course.ai !== false && <HomeworkPractice course={course} bundle={bundle} setBundle={setBundle} />}
          </div>
        ))}

        <div style={{ marginTop: 22 }}>
          {needsBundle && !bundle && <div style={{ padding: 40, textAlign: 'center' }}><Loader2 className="spin" /></div>}
          {tab === 'grades' && <Grades course={course} />}
          {tab === 'links' && <CourseLinks links={links} />}
          {tab === 'summaries' && bundle && <CourseSummaries course={course} bundle={bundle} />}
          {tab === 'prep' && bundle && <ExamPrep course={course} bundle={bundle} />}
          {tab === 'exam' && bundle && <ExamMode bundle={bundle} courseId={course.id} />}
          {tab === 'flashcards' && bundle && (allCards.length || cardLectures.length ? <Flashcards cards={allCards} lectures={cardLectures} initialMode={search.get('cards') || 'due'} /> : <Empty course={course} />)}
          {tab === 'glossary' && bundle && (allTerms.length ? <Glossary terms={allTerms} showSource /> : <Empty course={course} />)}
          {tab === 'formulas' && bundle && (
            allFormulas.length ? (
              <>
              <div className="row no-print" style={{ marginBottom: 14, gap: 10 }}>
                <span className="muted grow" style={{ fontSize: 14 }}>{allFormulas.length} נוסחאות מכל השיעורים – דף נוסחאות מוכן לחזרה לפני המבחן.</span>
                <button className="btn sm" onClick={() => window.print()}><Printer size={14} /> הדפסה / PDF</button>
              </div>
              <h1 className="print-only" style={{ fontSize: 20, marginBottom: 12 }}>דף נוסחאות – {course.name}</h1>
              <div className="glossary formula-sheet">
                {allFormulas.map((f, i) => (
                  <motion.div key={i} className="card formula" variants={fadeUp} initial="hidden" animate="show" custom={i % 12}>
                    <h4 style={{ fontSize: 16 }}>{f.name}</h4>
                    <div className="tex"><Tex>{f.latex}</Tex></div>
                    <p className="muted" style={{ margin: 0, fontSize: 14 }}><RichText>{f.explanation}</RichText></p>
                    <Link to={`/lecture/${f.lectureId}?tab=summary`} className="faint" style={{ fontSize: 12.5 }}>מתוך: {f.lectureTitle}</Link>
                  </motion.div>
                ))}
              </div>
              </>
            ) : <Empty course={course} text="נוסחאות יופיעו כאן אחרי שיועלו הרצאות עם חישובים." />
          )}
          {tab === 'labs' && !Lab && (
            <div className="lab-grid">
              {labs.map((lab, i) => (
                <motion.button key={lab.id} className="card hover lab-tile" variants={fadeUp} initial="hidden" animate="show" custom={i} onClick={() => setLabOpen(lab.id)}>
                  <div className="course-icon"><lab.icon size={20} /></div>
                  <h3 style={{ fontSize: 17 }}>{lab.title}</h3>
                  <p className="muted" style={{ margin: 0, fontSize: 14 }}>{lab.description}</p>
                  <span className="chip c" style={{ width: 'fit-content' }}>{lab.source}</span>
                </motion.button>
              ))}
            </div>
          )}
          {tab === 'labs' && Lab && (
            <div>
              <button className="btn sm ghost" onClick={() => setLabOpen(null)} style={{ marginBottom: 10 }}>→ חזרה לכל הכלים</button>
              <Lab.Component />
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
