import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, Upload, PlayCircle, RotateCcw, Flame, Eye } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, slideUrl, useFetch, STATIC } from '../api.js';
import { CourseIcon, Page, fadeUp, ltr } from '../components/ui.jsx';
import { UpcomingWidget } from './Updates.jsx';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

/** Consecutive days (ending today or yesterday) with any study activity. */
function streakOf(activity = {}) {
  let n = 0;
  const d = new Date();
  if (!activity[d.toISOString().slice(0, 10)]) d.setDate(d.getDate() - 1);
  while (activity[d.toISOString().slice(0, 10)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** The page's main card: pick up where you stopped (or a suggested first lecture). */
function ResumeCard({ last, lastCourse, next, nextCourse, slide, onUpload }) {
  const lecture = last || next;
  const course = last ? lastCourse : nextCourse;
  if (!lecture) {
    return (
      <motion.div className="card resume-card empty-resume" variants={fadeUp} initial="hidden" animate="show" custom={1}>
        <div className="grow">
          <div className="resume-eyebrow">מתחילים</div>
          <div className="resume-title">החומר של הקורסים יופיע כאן</div>
          <div className="muted" style={{ fontSize: 14 }}>מצגות, תרגולים ושיעורי בית נכנסים אוטומטית מהמודל.</div>
        </div>
        <button className="local-only btn accent" onClick={onUpload}><Upload size={16} /> העלאת הרצאה</button>
      </motion.div>
    );
  }
  const at = last ? slide : 1;
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" custom={1} className="resume-wrap">
      <Link to={`/lecture/${lecture.id}?tab=slides&slide=${at}`} className="card hover resume-card" data-color={course?.color}>
        <div className="resume-thumb">{lecture.slideCount > 0 && lecture.hasPdf !== false && <img src={slideUrl(lecture.id, at, true)} alt="" />}</div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="resume-eyebrow">
            {last ? 'המשך מאיפה שעצרת' : 'הצעה להתחלה'}
            {course && <span className="chip c">{course.short}</span>}
          </div>
          <div className="resume-title">{lecture.title}</div>
          {last && lecture.slideCount > 0 && (
            <div className="resume-progress">
              <div className="bar"><span style={{ width: `${Math.round((at / lecture.slideCount) * 100)}%`, background: 'var(--accent)' }} /></div>
              <span>שקף {at} מתוך {lecture.slideCount}</span>
            </div>
          )}
          <span className="btn accent sm resume-btn"><PlayCircle size={16} /> {last ? 'המשך ללמוד' : 'להתחיל'}</span>
        </div>
      </Link>
    </motion.div>
  );
}

/** Courses as one quiet list: icon, name, one line of what's inside, progress once you've started. */
function CourseList({ courses, lectures, studied }) {
  return (
    <div className="card course-list">
      {courses.map((c, i) => {
        const ls = lectures.filter((l) => l.courseId === c.id);
        const lec = ls.filter((l) => (l.kind || 'lecture') === 'lecture').length;
        const practice = ls.filter((l) => l.kind === 'homework' || l.kind === 'tutorial').length;
        const done = ls.filter((l) => studied[l.id]).length;
        const unit = lec === 1 ? c.unitLabel : c.unitLabel === 'יחידה' ? 'יחידות' : c.unitLabel === 'שיעור' ? 'שיעורים' : 'הרצאות';
        const meta = ls.length ? [lec ? `${lec} ${unit}` : null, practice ? `${practice} תרגול ושיעורי בית` : null].filter(Boolean).join(' · ') : 'ממתין לחומרים מהמודל';
        return (
          <motion.div key={c.id} variants={fadeUp} initial="hidden" animate="show" custom={i}>
            <Link to={`/course/${c.id}`} className="course-row" data-color={c.color}>
              <div className="course-icon sm"><CourseIcon name={c.icon} size={19} /></div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="course-row-name">{c.short}</div>
                <div className="course-row-meta">{meta}</div>
              </div>
              {done > 0 && (
                <div className="course-row-progress" title="נלמדו">
                  <div className="bar"><span style={{ width: `${Math.round((done / ls.length) * 100)}%`, background: 'var(--accent)' }} /></div>
                  <span>{done}/{ls.length}</span>
                </div>
              )}
              <ChevronLeft size={18} className="course-arrow" />
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}

/** One flashcard a day, as a light strip rather than a big card. */
function DailyCard({ lectures }) {
  const [card, setCard] = useState(null);
  const [flip, setFlip] = useState(false);
  const ready = lectures.filter((l) => l.flashcardCount);
  const pick = async (offset = 0) => {
    if (!ready.length) return;
    const day = Math.floor(Date.now() / 86400000) + offset;
    const lec = ready[day % ready.length];
    const full = await api.get(`/api/lectures/${lec.id}`);
    const fc = full.content.flashcards;
    setFlip(false);
    setCard({ ...fc[(day * 7) % fc.length], lecture: full });
  };
  useEffect(() => { pick(); }, [ready.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!card) return null;
  return (
    <>
    <div className="home-section-title">חזרה קצרה</div>
    <div className="daily" data-color={card.lecture.course?.color}>
      <div className="daily-head">
        <span>כרטיסיית היום</span>
        <span className="faint">· {card.lecture.course?.short}</span>
        <div className="spacer" />
        <button className="btn sm icon ghost" title="כרטיסייה אחרת" onClick={() => pick(Math.floor(Math.random() * 1000))}><RotateCcw size={15} /></button>
      </div>
      <motion.div key={card.front + flip} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        {!flip ? (
          <div className="daily-front">{ltr(card.front)}</div>
        ) : (
          <div className="daily-back">{ltr(card.back)}</div>
        )}
      </motion.div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn sm" onClick={() => setFlip((f) => !f)}><Eye size={14} /> {flip ? 'חזרה לשאלה' : 'הצגת התשובה'}</button>
        <Link to={`/lecture/${card.lecture.id}?tab=flashcards`} className="btn sm ghost">לכל הכרטיסיות של השיעור</Link>
      </div>
    </div>
    </>
  );
}

export default function Home() {
  const { courses, progress, openUpload, setContext } = useApp();
  const { data: lectures = [] } = useFetch('/api/lectures', { poll: (d) => d.some((l) => l.status === 'processing') });
  const list = lectures || [];

  useEffect(() => { setContext({}); }, [setContext]);

  // A short line of real progress – shown only once there is something to show (no rows of zeros).
  const summary = useMemo(() => {
    const quiz = Object.values(progress.quiz);
    const answered = quiz.reduce((s, q) => s + q.answered, 0);
    const correct = quiz.reduce((s, q) => s + q.correct, 0);
    const studied = list.filter((l) => progress.studied[l.id]).length;
    const mastered = Object.values(progress.cards).filter((c) => c.box >= 3).length;
    const streak = streakOf(progress.activity);
    return [
      studied ? `למדת ${studied} מתוך ${list.length}` : null,
      answered ? `${Math.round((correct / answered) * 100)}% הצלחה בתרגול` : null,
      mastered ? `${mastered} כרטיסיות בעל־פה` : null,
      streak > 1 ? { streak } : null,
    ].filter(Boolean);
  }, [list, progress]);

  const last = progress.last && list.find((l) => l.id === progress.last.lectureId);
  const lastCourse = last && courses.find((c) => c.id === last.courseId);
  // No history yet: suggest the first lecture not studied, in course order.
  const nextUp = !last ? courses.flatMap((c) => list.filter((l) => l.courseId === c.id && (l.kind || 'lecture') === 'lecture' && l.status === 'ready' && !progress.studied[l.id]))[0] : null;
  const nextCourse = nextUp && courses.find((c) => c.id === nextUp.courseId);

  return (
    <Page className="home">
      <section className="home-top">
        <motion.div className="welcome" variants={fadeUp} initial="hidden" animate="show">
          <div className="welcome-date">{new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>{greeting()}</h1>
          {summary.length > 0 && (
            <div className="welcome-summary">
              {summary.map((s, i) => (typeof s === 'string'
                ? <span key={i}>{s}</span>
                : <span key={i} className="streak"><Flame size={14} /> רצף של {s.streak} ימים</span>))}
            </div>
          )}
        </motion.div>

        <div className="home-main">
          <ResumeCard last={last} lastCourse={lastCourse} next={nextUp} nextCourse={nextCourse} slide={progress.last?.slide || 1} onUpload={() => openUpload()} />
          <UpcomingWidget />
        </div>
      </section>

      <div className="home-section-title">הקורסים שלי</div>
      <CourseList courses={courses} lectures={list} studied={progress.studied} />

      <DailyCard lectures={list} />
    </Page>
  );
}
