import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { BookOpen, Target, Layers, BookMarked, FlaskConical, Upload, Check, Loader2, AlertTriangle, Users, Sigma, Sparkles } from 'lucide-react';
import { useApp } from '../store.jsx';
import { slideUrl, useFetch, shuffle } from '../api.js';
import { CourseIcon, Page, Ring, Tabs, fadeUp, Tex, ltr } from '../components/ui.jsx';
import Quiz from '../components/Quiz.jsx';
import Flashcards from '../components/Flashcards.jsx';
import Glossary from '../components/Glossary.jsx';
import { LABS } from '../labs/index.js';

function LectureCard({ l, course, i }) {
  const { progress } = useApp();
  const studied = progress.studied[l.id];
  const q = progress.quiz[l.id];
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" custom={i}>
      <Link to={`/lecture/${l.id}`} className="card hover lecture-card">
        <div className="lecture-thumb">
          {l.slideCount > 0 && l.hasPdf && <img src={slideUrl(l.id, 1, true)} alt="" loading="lazy" />}
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
          <h3>{l.title}</h3>
          <p>{ltr(l.overview) || l.originalName}</p>
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

function ExamMode({ bundle }) {
  const [count, setCount] = useState(12);
  const [source, setSource] = useState('all');
  const [run, setRun] = useState(null);
  const ready = bundle.lectures.filter((l) => l.content?.quiz?.length);
  const start = () => {
    const pool = ready
      .filter((l) => source === 'all' || l.id === source)
      .flatMap((l) => [...(l.content.quiz || []), ...(l.content.extraQuiz || [])].map((q) => ({ ...q, lectureId: l.id, lectureTitle: l.title })));
    setRun({ key: Math.random(), questions: shuffle(pool).slice(0, count) });
  };
  if (!ready.length) return <Empty course={bundle} text="מבחן התרגול ייבנה מהשאלות של ההרצאות שיועלו." />;
  if (run) return <Quiz key={run.key} questions={run.questions} lectureId={null} exam onExit={() => setRun(null)} />;
  return (
    <div className="card pad" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
      <div className="empty-icon" style={{ marginBottom: 14 }}><Target size={30} /></div>
      <h2 style={{ fontSize: 24 }}>מבחן תרגול – {bundle.short}</h2>
      <p className="muted">שאלות מעורבבות מכל ההרצאות, עם משוב והסבר אחרי כל תשובה וציון בסוף.</p>
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

function Empty({ course, text }) {
  const { openUpload } = useApp();
  return (
    <motion.div className="empty" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
      <div className="empty-icon"><CourseIcon name={course.icon} size={30} /></div>
      <h3>עדיין אין כאן הרצאות</h3>
      <p>{text || 'גררו לכאן מצגת או לחצו להעלאה – היא תומר לשקפים, תסוכם ותחולק לנושאים אוטומטית.'}</p>
      <button className="local-only btn accent" onClick={() => openUpload(course.id)}><Upload size={17} /> העלאת הרצאה ל{course.short}</button>
    </motion.div>
  );
}

export default function Course() {
  const { id, tab = 'lessons' } = useParams();
  const navigate = useNavigate();
  const { setContext, openUpload, openChat, progress } = useApp();
  const { data: course } = useFetch(`/api/courses/${id}`, { poll: (d) => d.lectures.some((l) => l.status === 'processing') });
  const needsBundle = tab !== 'lessons' && tab !== 'labs';
  const { data: bundle } = useFetch(needsBundle ? `/api/courses/${id}/bundle` : null);
  const [labOpen, setLabOpen] = useState(null);

  useEffect(() => {
    if (course) setContext({ courseId: course.id, color: course.color, label: course.short });
  }, [course?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const g = new Map();
    for (const l of course?.lectures || []) {
      const k = l.lessonNumber || 0;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(l);
    }
    return [...g.entries()].sort((a, b) => (a[0] || 99) - (b[0] || 99));
  }, [course]);

  if (!course) return <Page><div style={{ padding: 60, textAlign: 'center' }}><Loader2 className="spin" /></div></Page>;

  const labs = LABS[course.id] || [];
  const studied = course.lectures.filter((l) => progress.studied[l.id]).length;
  const flashTotal = course.lectures.reduce((s, l) => s + l.flashcardCount, 0);
  const quizTotal = course.lectures.reduce((s, l) => s + l.quizCount, 0);
  const tabs = [
    { id: 'lessons', label: 'שיעורים', icon: <BookOpen size={16} />, count: course.lectures.length },
    { id: 'exam', label: 'מבחן תרגול', icon: <Target size={16} />, count: quizTotal || null },
    { id: 'flashcards', label: 'כרטיסיות', icon: <Layers size={16} />, count: flashTotal || null },
    { id: 'glossary', label: 'מילון מושגים', icon: <BookMarked size={16} /> },
    { id: 'formulas', label: 'נוסחאות', icon: <Sigma size={16} /> },
    ...(labs.length ? [{ id: 'labs', label: 'מעבדה אינטראקטיבית', icon: <FlaskConical size={16} />, count: labs.length }] : []),
  ];

  const allCards = bundle?.lectures.flatMap((l) => (l.content?.flashcards || []).map((c) => ({ ...c, lectureId: l.id, lectureTitle: l.title }))) || [];
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
                {course.staff.length > 0 && <span className="chip"><Users size={13} /> {course.staff.join(' · ')}</span>}
                <span className="chip">{course.lectures.length} {course.unitLabel === 'יחידה' ? 'יחידות' : 'הרצאות'}</span>
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

        {tab === 'lessons' && (
          course.lectures.length === 0 ? <div style={{ marginTop: 22 }}><Empty course={course} /></div> : (
            groups.map(([num, ls]) => (
              <div className="lesson-group" key={num}>
                <div className="lesson-num"><span>שיעור</span><b>{num || '?'}</b></div>
                <div className="lecture-list">{ls.map((l, i) => <LectureCard key={l.id} l={l} course={course} i={i} />)}</div>
              </div>
            ))
          )
        )}

        <div style={{ marginTop: 22 }}>
          {needsBundle && !bundle && <div style={{ padding: 40, textAlign: 'center' }}><Loader2 className="spin" /></div>}
          {tab === 'exam' && bundle && <ExamMode bundle={bundle} />}
          {tab === 'flashcards' && bundle && (allCards.length ? <Flashcards cards={allCards} /> : <Empty course={course} />)}
          {tab === 'glossary' && bundle && (allTerms.length ? <Glossary terms={allTerms} showSource /> : <Empty course={course} />)}
          {tab === 'formulas' && bundle && (
            allFormulas.length ? (
              <div className="glossary">
                {allFormulas.map((f, i) => (
                  <motion.div key={i} className="card formula" variants={fadeUp} initial="hidden" animate="show" custom={i % 12}>
                    <h4 style={{ fontSize: 16 }}>{f.name}</h4>
                    <div className="tex"><Tex>{f.latex}</Tex></div>
                    <p className="muted" style={{ margin: 0, fontSize: 14 }}>{ltr(f.explanation)}</p>
                    <Link to={`/lecture/${f.lectureId}?tab=summary`} className="faint" style={{ fontSize: 12.5 }}>מתוך: {f.lectureTitle}</Link>
                  </motion.div>
                ))}
              </div>
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
