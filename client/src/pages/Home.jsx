import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Upload, PlayCircle, Sparkles, RotateCcw, Flame } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, slideUrl, useFetch, STATIC } from '../api.js';
import { CountUp, CourseIcon, Page, Ring, fadeUp, ltr } from '../components/ui.jsx';
import { UpcomingWidget } from './Updates.jsx';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

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
    <div className="card daily-card" data-color={card.lecture.course?.color}>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="chip c"><Sparkles size={13} /> כרטיסיית היום</span>
        <span className="faint" style={{ fontSize: 12.5 }}>{card.lecture.course?.short}</span>
        <div className="spacer" />
        <button className="btn sm icon ghost" title="כרטיסייה אחרת" onClick={() => pick(Math.floor(Math.random() * 1000))}><RotateCcw size={15} /></button>
      </div>
      <motion.div onClick={() => setFlip((f) => !f)} style={{ cursor: 'pointer', minHeight: 110 }} key={card.front + flip} initial={{ rotateX: -70, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
        {!flip ? (
          <>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700, lineHeight: 1.4 }}>{ltr(card.front)}</div>
            <div className="faint" style={{ fontSize: 13, marginTop: 10 }}>לחצו כדי לראות את התשובה</div>
          </>
        ) : (
          <div style={{ fontSize: 16, lineHeight: 1.7 }}>{ltr(card.back)}</div>
        )}
      </motion.div>
      <Link to={`/lecture/${card.lecture.id}?tab=flashcards`} className="row" style={{ fontSize: 13.5, color: 'var(--c-strong)', fontWeight: 600, marginTop: 12 }}>
        לכל הכרטיסיות של {card.lecture.title} <ArrowLeft size={15} />
      </Link>
    </div>
  );
}

function Heatmap({ activity }) {
  const days = 7 * 12;
  const today = new Date();
  const cells = [...Array(days)].map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    const key = d.toISOString().slice(0, 10);
    return { key, v: activity?.[key] || 0 };
  });
  const streak = (() => {
    let s = 0;
    for (let i = cells.length - 1; i >= 0 && cells[i].v > 0; i--) s++;
    return s;
  })();
  return (
    <div className="card pad">
      <div className="row" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 16 }} className="grow">פעילות למידה</h3>
        <span className="chip warn"><Flame size={13} /> רצף {streak} ימים</span>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 1fr)', gridAutoFlow: 'column', gap: 4, direction: 'ltr' }}>
        {cells.map((c, i) => (
          <motion.div
            key={c.key}
            title={`${c.key}: ${c.v} פעולות`}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: i * 0.004 }}
            style={{ aspectRatio: '1', borderRadius: 4, background: c.v === 0 ? 'var(--surface-3)' : `color-mix(in srgb, #12976a ${Math.min(100, 25 + c.v * 6)}%, transparent)` }}
          />
        ))}
      </div>
    </div>
  );
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
  const href = `/lecture/${lecture.id}?tab=slides&slide=${at}`;
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" custom={1} className="resume-wrap">
      <Link to={href} className="card hover resume-card" data-color={course?.color}>
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

export default function Home() {
  const { courses, progress, openUpload, setContext } = useApp();
  const { data: lectures = [] } = useFetch('/api/lectures', { poll: (d) => d.some((l) => l.status === 'processing') });
  const list = lectures || [];

  useEffect(() => { setContext({}); }, [setContext]);

  const stats = useMemo(() => {
    const quiz = Object.values(progress.quiz);
    const answered = quiz.reduce((s, q) => s + q.answered, 0);
    const correct = quiz.reduce((s, q) => s + q.correct, 0);
    const mastered = Object.values(progress.cards).filter((c) => c.box >= 3).length;
    return {
      lectures: list.length,
      slides: list.reduce((s, l) => s + (l.slideCount || 0), 0),
      accuracy: answered ? (correct / answered) * 100 : 0,
      answered,
      mastered,
      totalCards: list.reduce((s, l) => s + (l.flashcardCount || 0), 0),
    };
  }, [list, progress]);

  const last = progress.last && list.find((l) => l.id === progress.last.lectureId);
  const lastCourse = last && courses.find((c) => c.id === last.courseId);
  // No history yet: suggest the first lecture not studied, in course order.
  const nextUp = !last ? courses.flatMap((c) => list.filter((l) => l.courseId === c.id && (l.kind || 'lecture') === 'lecture' && l.status === 'ready' && !progress.studied[l.id]))[0] : null;
  const nextCourse = nextUp && courses.find((c) => c.id === nextUp.courseId);
  const recent = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);

  return (
    <Page>
      <section className="home-top">
        <motion.div className="welcome" variants={fadeUp} initial="hidden" animate="show">
          <div className="welcome-date">{new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>{greeting()}</h1>
          <p>{STATIC ? 'כל הקורסים שלך במקום אחד – מצגות, תרגולים, הגשות, הודעות מהמודל, סיכומים ותרגול.' : 'כל ההרצאות של הסמסטר במקום אחד – מצגות, סיכומים, נושאים ותרגול.'}</p>
        </motion.div>

        <div className="home-main">
          <ResumeCard last={last} lastCourse={lastCourse} next={nextUp} nextCourse={nextCourse} slide={progress.last?.slide || 1} onUpload={() => openUpload()} />
          <UpcomingWidget />
        </div>

        <motion.div className="card stat-strip" variants={fadeUp} initial="hidden" animate="show" custom={2}>
          {[
            { value: stats.lectures, label: 'הרצאות' },
            { value: stats.slides, label: 'שקפים' },
            { value: stats.accuracy, label: `דיוק בתרגול · ${stats.answered} שאלות`, suffix: '%' },
            { value: stats.mastered, label: `כרטיסיות שנשלטו מתוך ${stats.totalCards}` },
          ].map((s) => (
            <div key={s.label} className="stat-item">
              <b><CountUp to={s.value} suffix={s.suffix} /></b>
              <span>{s.label}</span>
            </div>
          ))}
        </motion.div>
      </section>

      <div className="section-title"><h2>הקורסים שלי</h2><div className="line" /></div>
      <div className="course-grid">
        {courses.map((c, i) => {
          const ls = list.filter((l) => l.courseId === c.id);
          const studied = ls.filter((l) => progress.studied[l.id]).length;
          return (
            <motion.div key={c.id} variants={fadeUp} initial="hidden" animate="show" custom={i}>
              <Link to={`/course/${c.id}`} className="card hover course-card" data-color={c.color}>
                <div className="course-card-top">
                  <div className="course-icon sm"><CourseIcon name={c.icon} size={20} /></div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <h3>{c.short}</h3>
                    <div className="course-code">{c.code}</div>
                  </div>
                  <Ring value={ls.length ? studied / ls.length : 0} size={40} stroke={4} />
                </div>
                {c.tagline && <div className="course-tagline">{c.tagline}</div>}
                <div className="foot">
                  {(() => {
                    const lec = ls.filter((l) => (l.kind || 'lecture') === 'lecture').length;
                    const hw = ls.filter((l) => l.kind === 'homework' || l.kind === 'tutorial').length;
                    if (!ls.length) return <span className="chip">ממתין לחומרים</span>;
                    return (
                      <>
                        {lec > 0 && <span className="chip">{lec} {lec === 1 ? c.unitLabel : c.unitLabel === 'יחידה' ? 'יחידות' : c.unitLabel === 'שיעור' ? 'שיעורים' : 'הרצאות'}</span>}
                        {hw > 0 && <span className="chip">{hw} תרגול ושיעורי בית</span>}
                      </>
                    );
                  })()}
                  <div className="spacer" />
                  <ArrowLeft size={17} className="course-arrow" />
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      <div className="two-col" style={{ marginTop: 34 }}>
        <div className="stack">
          <DailyCard lectures={list} />
          <Heatmap activity={progress.activity} />
        </div>
        <div className="card pad">
          <div className="row" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 16 }} className="grow">נוספו לאחרונה</h3>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {recent.map((l) => {
              const c = courses.find((x) => x.id === l.courseId);
              return (
                <Link key={l.id} to={`/lecture/${l.id}`} className="row" data-color={c?.color} style={{ padding: 10, borderRadius: 12 }}>
                  <div className="continue-thumb" style={{ width: 92 }}>{l.slideCount > 0 && <img src={slideUrl(l.id, 1, true)} alt="" loading="lazy" />}</div>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{l.title}</div>
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      <span className="chip c">{c?.short}</span>
                      {l.status === 'processing' && <span className="chip warn">בעיבוד…</span>}
                      {progress.studied[l.id] && <span className="chip good">נלמד</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
            {!recent.length && <p className="muted">עוד לא הועלו הרצאות.</p>}
          </div>
        </div>
      </div>
    </Page>
  );
}
