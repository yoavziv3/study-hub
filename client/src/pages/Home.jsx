import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Upload, Presentation, Layers, Target, Brain, PlayCircle, Sparkles, Flame, GraduationCap, CalendarRange, MapPin, Timer } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, thumbUrl, useFetch, STATIC } from '../api.js';
import { CountUp, CourseIcon, Page, Ring, fadeUp } from '../components/ui.jsx';
import { UpcomingWidget } from './Updates.jsx';
import { nextEvent, daysText, fmtDay, masteryMap, readiness, STRONG } from '../lib/exam.js';
import { mySlots, upcoming, whenLabel, typeLabel, missingGroups, scheduleContext } from '../lib/schedule.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

/** Study activity of the last 12 weeks, the current streak, and today's flashcard review. */
function Heatmap({ activity, dueCards, focus }) {
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
        {focus?.[today.toISOString().slice(0, 10)] > 0 && <span className="chip c"><Timer size={13} /> {focus[today.toISOString().slice(0, 10)]} דק׳ ריכוז היום</span>}
        <span className="chip warn"><Flame size={13} /> {streak === 0 ? 'מתחילים רצף היום' : streak === 1 ? 'יום אחד ברצף' : `${streak} ימים ברצף`}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 1fr)', gridAutoFlow: 'column', gridAutoColumns: 'minmax(0, 1fr)', gap: 4, direction: 'ltr' }}>
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

/** The next classes this week (from the timetable), or a nudge to pick class groups. */
function ClassesWidget({ courses, progress }) {
  const { updates } = useApp();
  // Cloud: the portal's rooms and cancellations count here too, as on the timetable page.
  const [portal, setPortal] = useState(null);
  useEffect(() => { if (STATIC) api.get('/api/portal').then(setPortal).catch(() => {}); }, []);
  const slots = mySlots(courses, progress);
  if (!slots.length) {
    if (!courses.some((c) => c.classes?.length && missingGroups(c, progress).length)) return null;
    return (
      <Link to="/schedule" className="card hover pad row" style={{ gap: 12 }}>
        <div className="course-icon"><CalendarRange size={20} /></div>
        <div className="grow">
          <div style={{ fontWeight: 700 }}>מערכת שעות אוטומטית</div>
          <div className="faint" style={{ fontSize: 13 }}>בוחרים קבוצה בכל קורס, ומקבלים ימים, שעות וחדרים – מעודכנים מקובץ הקורסים.</div>
        </div>
        <ArrowLeft size={16} className="faint" />
      </Link>
    );
  }
  const now = new Date();
  const next = upcoming(slots, now, 3, scheduleContext({ items: updates.items, lessons: portal?.ok ? portal.lessons : null, now }));
  return (
    <div className="card pad">
      <div className="row" style={{ marginBottom: 10 }}>
        <h3 style={{ fontSize: 16 }} className="grow">השיעורים הבאים</h3>
        <Link to="/schedule" className="faint" style={{ fontSize: 13 }}>למערכת השעות</Link>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {next.map((s) => (
          <Link key={s.key} to={`/course/${s.course.id}`} className="row" data-color={s.course.color} style={{ padding: '8px 10px', borderRadius: 12, background: 'var(--surface-2)', gap: 10 }}>
            <MapPin size={16} color="var(--c)" />
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{s.course.short} · {typeLabel(s.type)}</div>
              <div className="faint" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.start}–{s.end}{s.place ? ` · ${s.place}` : s.mode ? ` · ${s.mode}` : ''}</div>
            </div>
            <span className={`chip ${s.live ? 'good' : s.days === 0 ? 'warn' : ''}`}>{whenLabel(s)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Upcoming exams with a countdown and readiness – or, in exam season, a nudge to set the dates. */
function ExamsWidget({ courses, list, progress }) {
  const exams = courses
    .map((c) => ({ c, next: nextEvent(c, progress) }))
    .filter((x) => x.next)
    .sort((a, b) => a.next.days - b.next.days)
    .slice(0, 4);
  if (!exams.length) {
    const month = new Date().getMonth(); // exam periods: Dec–Feb, Jun–Aug
    if (!courses.length || ![11, 0, 1, 5, 6, 7].includes(month)) return null;
    return (
      <Link to={`/course/${courses[0].id}/prep`} className="card hover pad row" style={{ gap: 12 }}>
        <div className="course-icon"><GraduationCap size={20} /></div>
        <div className="grow">
          <div style={{ fontWeight: 700 }}>תקופת מבחנים מתקרבת?</div>
          <div className="faint" style={{ fontSize: 13 }}>מזינים תאריך מבחן בלשונית "הכנה למבחן" של כל קורס, ומקבלים תוכנית יומית עד המבחן.</div>
        </div>
        <ArrowLeft size={16} className="faint" />
      </Link>
    );
  }
  return (
    <div className="card pad">
      <div className="row" style={{ marginBottom: 10 }}>
        <h3 style={{ fontSize: 16 }} className="grow">מבחנים ובחנים קרובים</h3>
      </div>
      <div className="home-exams">
        {exams.map(({ c, next }) => {
          const ready = readiness(masteryMap({ lectures: list.filter((l) => l.courseId === c.id) }, progress));
          return (
            <Link key={c.id} to={`/course/${c.id}/prep`} className="home-exam" data-color={c.color}>
              <Ring value={ready} size={42} stroke={5} color={ready >= STRONG ? 'var(--good)' : ready >= 0.45 ? 'var(--warn)' : 'var(--bad)'} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{c.short} · {next.label}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>{fmtDay(next.date)}{next.time ? ` · ${next.time}` : ''}<span className="hide-phone"> · מוכנות {Math.round(ready * 100)}%</span></div>
                {/* On a phone the countdown sits under the date, so the course and the date keep the width. */}
                <span className={`chip show-phone ${next.days <= 3 ? 'bad' : next.days <= 10 ? 'warn' : 'c'}`} style={{ marginTop: 4 }}>{daysText(next.days)}</span>
              </div>
              <span className={`chip hide-phone ${next.days <= 3 ? 'bad' : next.days <= 10 ? 'warn' : 'c'}`}>{daysText(next.days)}</span>
            </Link>
          );
        })}
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
                <Link to={`/lecture/${last.id}?tab=slides&slide=${progress.last.slide || 1}`} className="btn btn-fit"><PlayCircle size={17} /> <span className="ellipsis">המשך: {last.title}</span></Link>
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
                {(() => {
                  const ex = nextEvent(c, progress);
                  return ex && <span className={`chip ${ex.days <= 3 ? 'bad' : 'warn'}`} style={{ width: 'fit-content' }}>🎯 {ex.label} {daysText(ex.days)}</span>;
                })()}
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
              <div className="continue-thumb">{last.slideCount > 0 && thumbUrl(last, progress.last.slide || 1) && <img src={thumbUrl(last, progress.last.slide || 1)} alt="" />}</div>
              <div className="grow">
                <div className="faint" style={{ fontSize: 12.5 }}>המשך מאיפה שעצרת · {lastCourse?.short}</div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{last.title}</div>
                <div className="muted" style={{ fontSize: 13.5 }}>שקף {progress.last.slide || 1} מתוך {last.slideCount}</div>
              </div>
              <PlayCircle size={28} color="var(--c)" />
            </Link>
          )}
          <ClassesWidget courses={courses} progress={progress} />
          <ExamsWidget courses={courses} list={list} progress={progress} />
          <UpcomingWidget />
          <Heatmap activity={progress.activity} dueCards={dueCards} focus={progress.focus} />
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
                  <div className="continue-thumb" style={{ width: 92 }}>{l.slideCount > 0 && thumbUrl(l) && <img src={thumbUrl(l)} alt="" loading="lazy" />}</div>
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
