import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { CalendarCheck, TriangleAlert, MapPin, Clock, ChevronDown, Users, ArrowLeft } from 'lucide-react';
import { useApp } from '../store.jsx';
import { STATIC, useFetch } from '../api.js';
import { Page, fadeUp } from '../components/ui.jsx';
import { daysText } from '../lib/exam.js';
import { myExams, markNear, overview, gapText, dayDiff, todayIL } from '../lib/examSchedule.js';

const parse = (d) => new Date(`${d}T12:00:00`);
const monthOf = (d) => parse(d).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
const shortDate = (d) => parse(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
// "יום שישי" (the locale already says "יום" for the weekday names).
const weekdayOf = (d) => parse(d).toLocaleDateString('he-IL', { weekday: 'long' }).replace(/^יום\s*/, 'יום ');
const longDate = (d) => parse(d).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

function Place({ place }) {
  if (!place?.length) return <span className="faint">המקום יפורסם</span>;
  return (
    <span className="ex-place">
      <MapPin size={13} /> {place.slice(0, 2).join(' · ')}{place.length > 2 ? ` · ועוד ${place.length - 2}` : ''}
    </span>
  );
}

function Sitting({ e }) {
  const level = e.days < 0 ? 'past' : e.days <= 3 ? 'bad' : e.days <= 10 ? 'warn' : 'c';
  return (
    <motion.div className={`card ex-item ${e.days < 0 ? 'past' : ''}`} data-color={e.course.color} variants={fadeUp} initial="hidden" animate="show">
      <div className="ex-date">
        <b>{parse(e.date).getDate()}</b>
        <span>{parse(e.date).toLocaleDateString('he-IL', { month: 'short' })}</span>
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <b style={{ fontSize: 16 }}>{e.course.short}</b>
          <span className="chip">{e.quiz ? '📝' : '🎯'} {e.label}</span>
          {e.days >= 0 && <span className={`chip ${level}`}>{daysText(e.days)}</span>}
          {!e.official && <span className="chip warn">תאריך שהזנת</span>}
        </div>
        <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
          {weekdayOf(e.date)}{e.time ? <> · <Clock size={12} style={{ verticalAlign: '-1px' }} /> <bdi dir="ltr">{e.time}</bdi></> : ''}
        </div>
        <div style={{ fontSize: 13, marginTop: 2 }}><Place place={e.place} /></div>
        {e.differ && <div className="faint" style={{ fontSize: 12.5, marginTop: 2 }}>לפי קבוצה {e.group} · <Link to={`/course/${e.course.id}/prep`} className="linklike">לשנות</Link></div>}
        {e.near.map((n, i) => (
          <div key={i} className={`ex-near ${n.gap === 0 ? 'bad' : 'warn'}`}>
            <TriangleAlert size={13} /> {gapText(n.gap)} מ{n.with.course.short} · {n.with.label}
          </div>
        ))}
      </div>
      <Link to={`/course/${e.course.id}/prep`} className="btn sm ghost ex-go" aria-label={`הכנה למבחן ב${e.course.short}`}><ArrowLeft size={15} /></Link>
    </motion.div>
  );
}

const groupsLabel = (d, total) => (d.groups.length >= total ? 'כל הקבוצות' : `${d.groups.length > 1 ? 'קבוצות' : 'קבוצה'} ${d.groups.join(', ')}`);

/** The degree committee's overview (owner only): every course's dates, all exam groups, and the gaps between them. */
function Committee({ courses }) {
  const o = useMemo(() => overview(courses), [courses]);
  const Gaps = ({ title, gaps }) => (
    <div className="card pad">
      <h3 style={{ fontSize: 16, marginBottom: 8 }}>{title}</h3>
      <div className="stack" style={{ gap: 6 }}>
        {gaps.map((g, i) => (
          <div key={i} className="row wrap" style={{ gap: 8, fontSize: 13.5 }}>
            <span className={`chip ${g.gap <= 1 ? 'bad' : g.gap <= 3 ? 'warn' : 'good'}`} style={{ minWidth: 76, justifyContent: 'center' }}>{g.gap === 0 ? 'אותו יום' : `${g.gap} ימים`}</span>
            <span className="grow" style={{ minWidth: 180 }}><b>{g.from.course.short}</b> {shortDate(g.from.date)} ← <b>{g.to.course.short}</b> {shortDate(g.to.date)}</span>
          </div>
        ))}
        {!gaps.length && <span className="faint">אין מספיק תאריכים.</span>}
      </div>
    </div>
  );
  return (
    <>
      <div className="section-title"><h2>תצוגת ועד · כל הקורסים</h2><div className="line" /></div>
      <p className="faint" style={{ fontSize: 13, margin: '0 0 10px' }}>רק את/ה רואה את זה. התאריכים לפי לוח הבחינות של האוניברסיטה, בכל הקבוצות. אדום: עד יום הפרש בין שני קורסים, כתום: עד 3 ימים.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {o.rows.map((r) => (
          <div key={r.course.id} className="card pad" data-color={r.course.color} style={{ padding: 14 }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}><span className="nav-dot" style={{ background: 'var(--c)' }} /><b className="grow">{r.course.name || r.course.short}</b></div>
            <div className="stack" style={{ gap: 6 }}>
              {r.kinds.map((k) => (
                <div key={k.key} style={{ fontSize: 13.5 }}>
                  <span className="faint">{k.label}: </span>
                  {k.dates.map((d, i) => (
                    <span key={i} style={{ marginInlineEnd: 8 }}>
                      <b>{shortDate(d.date)}</b> <span className="faint">{weekdayOf(d.date)}{d.time ? ` ${d.time}` : ''}{k.dates.length > 1 ? ` · ${groupsLabel(d, r.groupCount)}` : ''}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, marginTop: 10 }}>
        <Gaps title="מרווחים בין מועדי א׳" gaps={o.a} />
        <Gaps title="מרווחים בין מועדי ב׳" gaps={o.b} />
      </div>
    </>
  );
}

/** Every exam and quiz of the student's courses on one timeline (and, for the owner, an overview of all courses). */
export default function Exams() {
  const { courses, progress, setContext, me } = useApp();
  const [showPast, setShowPast] = useState(false);
  useEffect(() => { setContext({}); }, [setContext]);
  const today = todayIL();
  const list = useMemo(() => markNear(myExams(courses, progress, today)), [courses, progress, today]);
  const upcoming = list.filter((e) => e.days >= 0);
  const past = list.filter((e) => e.days < 0);
  const next = upcoming[0];
  const clashes = upcoming.filter((e) => e.near.some((n) => n.gap <= 1));
  const months = [];
  for (const e of upcoming) {
    const m = monthOf(e.date);
    if (!months.length || months[months.length - 1][0] !== m) months.push([m, []]);
    months[months.length - 1][1].push(e);
  }
  const owner = !STATIC || me?.owner;
  // The committee also sees courses the site doesn't carry (linear algebra), whose dates come with committee.json.
  const { data: committee } = useFetch(owner ? '/api/committee' : null);
  const everyCourse = useMemo(() => [
    ...courses,
    ...(committee?.extra || []).filter((c) => c.exams && !courses.some((x) => x.id === c.id)).map((c) => ({ ...c, exams: { groups: c.exams } })),
  ], [courses, committee]);

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon"><CalendarCheck size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>לוח מבחנים</h1>
            <div className="muted" style={{ fontSize: 14 }}>מועד א׳, מועד ב׳ ובחנים בכל הקורסים שלך, לפי הקבוצה שלך, עם השעה והמקום.</div>
          </div>
        </div>
        {next && (
          <div className="callout row wrap" style={{ gap: 8, marginTop: 14, background: 'var(--c-soft)' }} data-color={next.course.color}>
            <CalendarCheck size={16} />
            <span><b>הבא:</b> {next.course.short} · {next.label} · {longDate(next.date)} · {daysText(next.days)}</span>
          </div>
        )}
        {clashes.length > 0 && (
          <div className="callout row wrap" style={{ gap: 8, marginTop: 10, background: 'var(--warn-bg)' }}>
            <TriangleAlert size={16} color="var(--warn)" />
            <span>{clashes.length === 1 ? 'מבחן אחד' : `${clashes.length} מבחנים`} צמודים למבחן בקורס אחר (עד יום הפרש). כדאי לתכנן הכנה מראש, והתאריכים מסומנים למטה.</span>
          </div>
        )}
        <div className="faint" style={{ fontSize: 12.5, marginTop: 12 }}>{STATIC ? 'המבחנים נכנסים גם ליומן שלך (בעמוד העדכונים, "ההגשות ביומן שלך").' : 'התאריכים מתעדכנים לבד מקובץ הקורסים של האוניברסיטה.'}</div>
      </motion.div>

      {!list.length ? (
        <div className="empty" style={{ marginTop: 16 }}>
          <div className="empty-icon"><CalendarCheck size={28} /></div>
          <h2>עוד אין תאריכי מבחנים</h2>
          <p>הם נקלטים אוטומטית כשהאוניברסיטה מפרסמת אותם בקובץ הקורסים.</p>
        </div>
      ) : (
        <>
          {months.map(([m, items]) => (
            <div key={m}>
              <div className="section-title"><h2>{m}</h2><div className="line" /></div>
              <div className="stack" style={{ gap: 10 }}>{items.map((e) => <Sitting key={`${e.course.id}-${e.key}`} e={e} />)}</div>
            </div>
          ))}
          {past.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <button className="btn sm ghost" onClick={() => setShowPast((s) => !s)} aria-expanded={showPast}>
                {showPast ? 'הסתרת' : 'הצגת'} {past.length === 1 ? 'מבחן שעבר' : `${past.length} מבחנים שעברו`} <ChevronDown size={14} style={{ transform: showPast ? 'rotate(180deg)' : 'none' }} />
              </button>
              {showPast && <div className="stack" style={{ gap: 10, marginTop: 10 }}>{past.map((e) => <Sitting key={`${e.course.id}-${e.key}`} e={e} />)}</div>}
            </div>
          )}
        </>
      )}

      {owner && <Committee courses={everyCourse} />}
    </Page>
  );
}
