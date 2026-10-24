import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Table2, RefreshCw, Eye, CalendarClock } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, useFetch, STATIC } from '../api.js';
import { Page, fadeUp } from '../components/ui.jsx';
import { DAY_NAMES, typeLabel } from '../lib/schedule.js';
import { committeeCourses, gridRows, occupancy, freeWindows, meetings, hhmm, DAYS, CELL } from '../lib/committee.js';

const THRESHOLDS = [[1, 'פנוי לכולם'], [0.9, '90% פנויים'], [0.8, '80% פנויים'], [0.7, '70% פנויים']];

const pct = (x) => `${Math.round(x * 100)}%`;
const lineTitle = (line, course) => `${course.short}: ${line.groups.map((g, i) => `${i === 0 && line.groups.length > 1 ? 'שיעור' : line.groups.length === 1 ? 'שיעור' : 'תרגול'} ${g}`).join(' + ')}\n${line.slots.map((s) => `יום ${DAY_NAMES[s.day]} ${s.start}–${s.end}${s.place ? ` · ${s.place}` : ''}`).join('\n')}${line.lecturer ? `\n${line.lecturer}` : ''}`;

/** Which registration lines count, per course: chips to switch each line of a course on or off. */
function LinePicker({ course, onChange }) {
  const set = (id, on) => onChange(course.id, course.lines.filter((l) => (l.id === id ? on : l.on)).map((l) => l.id));
  const on = course.lines.filter((l) => l.on).length;
  return (
    <div className="card pad" data-color={course.color} style={{ padding: 14 }}>
      <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
        <span className="nav-dot" style={{ background: 'var(--c)' }} />
        <b className="grow">{course.name || course.short}</b>
        <span className="faint" style={{ fontSize: 12.5 }}>{on} מתוך {course.lines.length} מסלולים</span>
        <button className="btn sm ghost" onClick={() => onChange(course.id, [])}>ניקוי</button>
      </div>
      {course.lines.length ? (
        <div className="row wrap" style={{ gap: 6 }}>
          {course.lines.map((l) => (
            <button key={l.id} className={`chip ${l.on ? 'c' : ''}`} title={lineTitle(l, course)} onClick={() => set(l.id, !l.on)} style={{ cursor: 'pointer' }}>
              {l.groups.length > 1 ? `שיעור ${l.groups[0]} · תרגול ${l.groups[1]}` : `שיעור ${l.groups[0]}`}
            </button>
          ))}
        </div>
      ) : <div className="faint" style={{ fontSize: 13 }}>אין קבוצות בקובץ הקורסים.</div>}
    </div>
  );
}

const CELL_PX = 24;
const groupsText = (m) => (m.groups.length > 3 ? `${m.groups[0]}–${m.groups[m.groups.length - 1]}` : m.groups.join(', '));

function Grid({ rows, grid, days, minFree, blocks }) {
  const top = (m) => ((m - rows[0].from) / CELL) * CELL_PX;
  return (
    <div className="cm-grid" style={{ gridTemplateColumns: `54px repeat(${days.length}, minmax(0, 1fr))` }}>
      <div />
      {days.map((d) => <div key={d} className="cm-day">{DAY_NAMES[d]}</div>)}
      <div className="cm-times" style={{ height: rows.length * CELL_PX }}>
        {rows.filter((r) => r.from % 60 === 0).map((r) => <span key={r.from} style={{ top: top(r.from) }}>{hhmm(r.from)}</span>)}
      </div>
      {days.map((d, i) => (
        <div key={d} className="cm-col" style={{ height: rows.length * CELL_PX }}>
          {rows.map((row, r) => {
            const cell = grid[i][r];
            const free = 1 - cell.share >= minFree - 1e-9;
            return <div key={row.from} className={`cm-cell ${free ? 'free' : ''} ${row.from % 60 === 0 ? 'hour' : ''}`} style={{ height: CELL_PX }} title={`יום ${DAY_NAMES[d]} ${hhmm(row.from)}–${hhmm(row.to)}${cell.by.length ? ` · תפוסים ${pct(cell.share)}` : ' · אף אחד לא בשיעור'}`} />;
          })}
          {blocks.filter((m) => m.day === d).map((m) => (
            <div
              key={`${m.course.id}-${m.type}-${m.from}`}
              className="cm-block"
              data-color={m.course.color}
              style={{ top: top(m.from) + 1, height: ((m.to - m.from) / CELL) * CELL_PX - 2, width: `calc(${100 / m.lanes}% - 3px)`, insetInlineStart: `${(100 / m.lanes) * m.lane}%`, '--share': 0.28 + 0.62 * m.share }}
              title={`${m.course.name || m.course.short} · ${typeLabel(m.type)} ${m.groups.join(', ')}\n${hhmm(m.from)}–${hhmm(m.to)}${m.places.length ? `\n${m.places.join(' · ')}` : ''}${m.lecturers.length ? `\n${m.lecturers.join(' · ')}` : ''}\n${m.share < 1 ? `${pct(m.share)} מהסטודנטים בקורס` : 'כל הסטודנטים בקורס'}`}
            >
              <b>{m.course.short}</b>
              <span>{typeLabel(m.type)} {groupsText(m)}</span>
              {m.share < 1 && m.lanes < 3 && <span className="cm-share">{pct(m.share)}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Every meeting as a list, by day: what is on, when, with whom and where. */
function MeetingList({ blocks, days }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {days.map((d) => {
        const list = blocks.filter((m) => m.day === d).sort((a, b) => a.from - b.from || a.course.short.localeCompare(b.course.short));
        if (!list.length) return null;
        return (
          <div key={d}>
            <div className="day-title">יום {DAY_NAMES[d]}</div>
            <div className="stack" style={{ gap: 6 }}>
              {list.map((m) => (
                <div key={`${m.course.id}-${m.type}-${m.from}`} className="row wrap" data-color={m.course.color} style={{ gap: 10, padding: '6px 10px', borderRadius: 10, background: 'var(--c-soft)', borderInlineStart: '3px solid var(--c)', fontSize: 13.5 }}>
                  <b dir="ltr" style={{ minWidth: 92 }}>{hhmm(m.from)}–{hhmm(m.to)}</b>
                  <b style={{ color: 'var(--c-strong)' }}>{m.course.short}</b>
                  <span>{typeLabel(m.type)} {m.groups.join(', ')}</span>
                  <span className="faint grow">{[m.lecturers.join(' · '), m.places.join(' · ')].filter(Boolean).join(' · ')}</span>
                  {m.share < 1 && <span className="chip">{pct(m.share)} מהקורס</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The degree committee's overlay (owner only): every course's weekly meetings on one grid, with the free windows. */
export default function Committee() {
  const { courses, progress, setContext, setCommitteeLines, toast } = useApp();
  const { data, error, reload } = useFetch('/api/committee');
  const [minFree, setMinFree] = useState(1);
  const [minHours, setMinHours] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { setContext({}); }, [setContext]);

  const cc = useMemo(() => (data ? committeeCourses(courses, data, progress.committee?.lines) : []), [courses, data, progress.committee]);
  const rows = useMemo(() => gridRows(cc), [cc]);
  const grid5 = useMemo(() => occupancy(cc, rows, DAYS), [cc, rows]);
  // Friday only when someone has class then.
  const days = DAYS.filter((d) => d < 5 || grid5[d].some((c) => c.by.length));
  const grid = days.map((d) => grid5[d]);
  const blocks = useMemo(() => meetings(cc, DAYS), [cc]);
  const windows = useMemo(() => freeWindows(grid, rows, days, minFree, minHours * 60), [grid5, rows, minFree, minHours]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = cc.filter((c) => c.lines.some((l) => l.on));

  const refresh = async () => {
    setRefreshing(true);
    try { await api.post('/api/committee/refresh'); await reload(); toast('עודכן מקובץ הקורסים'); } catch (e) { toast(e.message, 'info'); } finally { setRefreshing(false); }
  };

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon"><Table2 size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>מערכת הועד</h1>
            <div className="muted" style={{ fontSize: 14 }}>כל הקורסים זה על גבי זה בשבוע אחד, כדי לראות מתי אף סטודנט לא בשיעור ואפשר להכניס השלמות, תרגולים ושעות קבלה. רק את/ה רואה את זה.</div>
          </div>
          {!STATIC && <button className="btn" onClick={refresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /> עדכון מקובץ הקורסים</button>}
        </div>
      </motion.div>

      {error && <div className="callout" style={{ marginTop: 16 }}>{error}</div>}

      <div className="section-title"><h2>המסלולים של הסטודנטים</h2><div className="line" /></div>
      <p className="faint" style={{ fontSize: 13, margin: '0 0 10px' }}>
        מסלול הוא שיעור עם התרגול שלו. המסלולים המסומנים הם אלה שהפקולטה פתחה למחזור (לפי הרשימה שנתת), ואפשר להדליק ולכבות כל אחד. ההנחה: הסטודנטים מתחלקים שווה בין המסלולים של כל קורס.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {cc.map((c) => <LinePicker key={c.id} course={c} onChange={setCommitteeLines} />)}
      </div>

      <div className="section-title"><h2>חלונות פנויים</h2><div className="line" /></div>
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <div className="tabs">
          {THRESHOLDS.map(([v, label]) => (
            <button key={v} className={`tab ${minFree === v ? 'active' : ''}`} onClick={() => setMinFree(v)}>{minFree === v && <motion.span layoutId="cm-th" className="tab-bg" />}{label}</button>
          ))}
        </div>
        <label className="row" style={{ gap: 6, fontSize: 13.5 }}>
          לפחות
          <select className="input" style={{ width: 'auto' }} value={minHours} onChange={(e) => setMinHours(Number(e.target.value))}>
            <option value={0.5}>חצי שעה</option><option value={1}>שעה</option><option value={1.5}>שעה וחצי</option><option value={2}>שעתיים</option>
          </select>
        </label>
      </div>
      <div className="card pad">
        {!active.length ? <div className="muted">אין מסלולים מסומנים.</div> : windows.length ? (
          <div className="row wrap" style={{ gap: 8 }}>
            {windows.map((w) => (
              <span key={`${w.day}-${w.from}`} className="chip good" title={w.busy ? `עד ${pct(w.busy)} מהסטודנטים בשיעור` : 'אף אחד לא בשיעור'}>
                <CalendarClock size={12} /> יום {DAY_NAMES[w.day]} <bdi dir="ltr">{hhmm(w.from)}–{hhmm(w.to)}</bdi>
              </span>
            ))}
          </div>
        ) : <div className="muted">אין חלון כזה. אפשר להקטין את הדרישה (למשל 80% פנויים).</div>}
      </div>

      <div className="section-title"><h2>השבוע על גבי השבוע</h2><div className="line" /></div>
      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        {active.map((c) => <span key={c.id} className="chip c" data-color={c.color}>{c.short}</span>)}
        <span className="chip good"><Eye size={12} /> ירוק: פנוי ({THRESHOLDS.find(([v]) => v === minFree)[1]})</span>
        <span className="faint" style={{ fontSize: 12.5 }}>כל בלוק הוא שיעור או תרגול, עם מספרי הקבוצות. צבע עמוק יותר = יותר מהסטודנטים בקורס. מעבר עכבר על בלוק מראה מרצה וחדר.</span>
      </div>
      <div className="card pad" style={{ overflowX: 'auto' }}>
        <Grid rows={rows} grid={grid} days={days} minFree={minFree} blocks={blocks} />
      </div>

      <div className="section-title"><h2>כל המפגשים לפי יום</h2><div className="line" /></div>
      <div className="card pad"><MeetingList blocks={blocks} days={days} /></div>
    </Page>
  );
}
