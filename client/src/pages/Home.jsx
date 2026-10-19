import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Upload, Presentation, Layers, Target, Brain, PlayCircle, Sparkles, Flame } from 'lucide-react';
import { useApp } from '../store.jsx';
import { slideUrl, useFetch, STATIC } from '../api.js';
import { CountUp, CourseIcon, Page, Ring, fadeUp } from '../components/ui.jsx';
import { UpcomingWidget } from './Updates.jsx';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

/** Study activity of the last 12 weeks, the current streak, and today's flashcard review. */
function Heatmap({ activity, dueCards }) {
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
  const week = cells.slice(-7).reduce((n, c) => n + (c.v > 0 ? 1 : 0), 0);
  return (
    <div className="card pad heat-card">
      <div className="row" style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 16 }} className="grow">פעילות למידה</h3>
        <span className="chip warn"><Flame size={13} /> {streak === 0 ? 'מתחילים רצף היום' : streak === 1 ? 'יום אחד ברצף' : `${streak} ימים ברצף`}</span>
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
      <div className="heat-foot">
        <span className="muted">למדת ב־{week} מתוך 7 הימים האחרונים</span>
        <Link to="/review" className="btn sm accent"><Layers size={15} /> {dueCards ? `חזרה להיום · ${dueCards} כרטיסיות` : 'חזרה על כרטיסיות'}</Link>
      </div>
    </div>
  );
}

export default function Home() {
  const { courses, progress, openUpload, openChat, setContext, me } = useApp();
  // "ערב טוב, יואב" – the first name from the Moodle account.
  const firstName = me?.user?.name?.trim().split(/\s+/)[0] || '';
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

  const dueCards = Object.values(progress.cards).filter((c) => c.due && c.due <= Date.now()).length;
  const last = progress.last && list.find((l) => l.id === progress.last.lectureId);
  const lastCourse = last && courses.find((c) => c.id === last.courseId);
  const recent = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);

  return (
    <Page>
      <section className="hero">
        <motion.div className="hero-main" variants={fadeUp} initial="hidden" animate="show">
          <motion.div className="hero-orb" style={{ width: 280, height: 280, background: '#f5c84c', top: -90, left: -60 }} animate={{ x: [0, 30, 0], y: [0, 20, 0] }} transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }} />
          <motion.div className="hero-orb" style={{ width: 220, height: 220, background: '#7048e8', bottom: -110, left: 160 }} animate={{ x: [0, -30, 0], y: [0, -15, 0] }} transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ opacity: 0.6, fontSize: 14 }}>{new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <h1>{greeting()}{firstName ? `, ${firstName}` : ''} 👋</h1>
            <p>{STATIC ? 'כל הקורסים שלך במקום אחד – מצגות, תרגולים, הגשות, הודעות מהמודל, סיכומים ותרגול.' : 'כל ההרצאות של הסמסטר במקום אחד – מצגות, סיכומים, נושאים, תרגול ומורה פרטי שמכיר את כל החומר.'}</p>
            <div className="row wrap">
              {last ? (
                <Link to={`/lecture/${last.id}?tab=slides&slide=${progress.last.slide || 1}`} className="btn"><PlayCircle size={17} /> המשך: {last.title}</Link>
              ) : (
                <button className="local-only btn" onClick={() => openUpload()}><Upload size={17} /> העלאת הרצאה</button>
              )}
              <button className="local-only btn ghost" onClick={() => openChat()}><Sparkles size={16} /> שאלה למורה</button>
            </div>
          </div>
        </motion.div>
        <div className="stat-grid">
          {[
            { icon: Presentation, value: stats.lectures, label: 'הרצאות במערכת' },
            { icon: Layers, value: stats.slides, label: 'שקפים' },
            { icon: Target, value: stats.accuracy, label: `דיוק בתרגול (${stats.answered} שאלות)`, suffix: '%' },
            { icon: Brain, value: stats.mastered, label: `כרטיסיות שנשלטו מתוך ${stats.totalCards}` },
          ].map((s, i) => (
            <motion.div key={s.label} className="card stat" variants={fadeUp} initial="hidden" animate="show" custom={i + 1}>
              <div className="stat-icon"><s.icon size={18} /></div>
              <div className="stat-value"><CountUp to={s.value} suffix={s.suffix} /></div>
              <div className="stat-label">{s.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      <div className="section-title"><h2>הקורסים שלי</h2><div className="line" /></div>
      <div className="course-grid">
        {courses.map((c, i) => {
          const ls = list.filter((l) => l.courseId === c.id);
          const studied = ls.filter((l) => progress.studied[l.id]).length;
          return (
            <motion.div key={c.id} variants={fadeUp} initial="hidden" animate="show" custom={i}>
              <Link to={`/course/${c.id}`} className="card hover course-card" data-color={c.color}>
                <div className="glow" />
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div className="course-icon"><CourseIcon name={c.icon} /></div>
                  <div className="spacer" />
                  <Ring value={ls.length ? studied / ls.length : 0} size={50} />
                </div>
                <div>
                  <h3>{c.short}</h3>
                  <div className="course-code">{c.code}</div>
                </div>
                <div className="muted" style={{ fontSize: 14 }}>{c.tagline}</div>
                <div className="foot">
                  {(() => {
                    const lec = ls.filter((l) => (l.kind || 'lecture') === 'lecture').length;
                    const hw = ls.filter((l) => l.kind === 'homework' || l.kind === 'tutorial').length;
                    if (!ls.length) return <span className="chip c">ממתין לחומרים</span>;
                    return (
                      <>
                        {lec > 0 && <span className="chip c">{lec} {lec === 1 ? c.unitLabel : c.unitLabel === 'יחידה' ? 'יחידות' : c.unitLabel === 'שיעור' ? 'שיעורים' : 'הרצאות'}</span>}
                        {hw > 0 && <span className="chip">{hw} תרגול ושיעורי בית</span>}
                      </>
                    );
                  })()}
                  <div className="spacer" />
                  <motion.span whileHover={{ x: -4 }} style={{ display: 'grid', color: 'var(--c)' }}><ArrowLeft size={18} /></motion.span>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      <div className="two-col home-bottom" style={{ marginTop: 34 }}>
        <div className="stack">
          {last && (
            <Link to={`/lecture/${last.id}?tab=slides&slide=${progress.last.slide || 1}`} className="card hover continue-card" data-color={lastCourse?.color}>
              <div className="continue-thumb">{last.slideCount > 0 && <img src={slideUrl(last.id, progress.last.slide || 1, true)} alt="" />}</div>
              <div className="grow">
                <div className="faint" style={{ fontSize: 12.5 }}>המשך מאיפה שעצרת · {lastCourse?.short}</div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{last.title}</div>
                <div className="muted" style={{ fontSize: 13.5 }}>שקף {progress.last.slide || 1} מתוך {last.slideCount}</div>
              </div>
              <PlayCircle size={28} color="var(--c)" />
            </Link>
          )}
          <UpcomingWidget />
          <Heatmap activity={progress.activity} dueCards={dueCards} />
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
