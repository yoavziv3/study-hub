import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell, BellRing, Megaphone, CalendarClock, AlarmClock, BookOpen, Presentation, PencilRuler, ExternalLink, Plus, Check, Trash2, RefreshCw, ChevronDown, Inbox, ScrollText,
} from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, useFetch, STATIC } from '../api.js';
import { Page, fadeUp, ltr, safeHref } from '../components/ui.jsx';
import { parseRequired, partsLabel } from '../components/Assignment.jsx';

// Moodle intros arrive as many short lines; show them as one compact line.
const oneLine = (t) => t.replace(/\r/g, '').split(/\n+/).map((x) => x.trim()).filter(Boolean).join(' · ');

const DAY = 86400000;

const TYPE = {
  material: { label: 'חומר חדש', icon: BookOpen },
  announcement: { label: 'הודעה מהקורס', icon: Megaphone },
  deadline: { label: 'הגשה חדשה', icon: CalendarClock },
  reminder: { label: 'תזכורת', icon: AlarmClock },
};
const MATERIAL_ICON = { lecture: BookOpen, tutorial: Presentation, homework: PencilRuler, exam: ScrollText };

const FILTERS = [
  ['all', 'הכל'],
  ['material', 'חומרים חדשים'],
  ['announcement', 'הודעות'],
  ['deadlines', 'הגשות ותזכורות'],
];

const fmtDue = (iso) =>
  new Date(iso).toLocaleString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

function countdown(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { text: 'מועד ההגשה עבר', level: 'past' };
  const h = ms / 3600000;
  if (h < 1) return { text: `בעוד ${Math.max(1, Math.round(ms / 60000))} דקות`, level: 'urgent' };
  if (h < 24) return { text: `בעוד ${Math.round(h)} שעות`, level: 'urgent' };
  const d = Math.floor(ms / DAY);
  return { text: d === 1 ? 'בעוד יום' : d === 2 ? 'בעוד יומיים' : `בעוד ${d} ימים`, level: d <= 3 ? 'soon' : 'ok' };
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / DAY);
  if (diff === 0) return 'היום';
  if (diff === 1) return 'אתמול';
  if (diff < 7) return d.toLocaleDateString('he-IL', { weekday: 'long' });
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

const timeOf = (iso) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

function DeadlineCard({ d, course, i }) {
  const { toast, deadlineActions } = useApp();
  const c = countdown(d.dueAt);
  const finished = d.submitted || d.done;
  const color = finished ? 'var(--good)' : c.level === 'urgent' || c.level === 'past' ? 'var(--bad)' : c.level === 'soon' ? 'var(--warn)' : 'var(--c)';
  // Same hue, a shade dark enough to read as text.
  const textColor = finished ? 'var(--good-text)' : c.level === 'urgent' || c.level === 'past' ? 'var(--bad-text)' : c.level === 'soon' ? 'var(--warn-text)' : 'var(--c-strong)';
  const act = async (fn) => {
    try {
      await fn();
    } catch (e) {
      toast(e.message, 'info');
    }
  };
  return (
    <motion.div className="card deadline" data-color={course?.color} variants={fadeUp} initial="hidden" animate="show" custom={i} style={{ '--dl': color, opacity: finished ? 0.65 : 1 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="deadline-icon">{finished ? <Check size={18} /> : <CalendarClock size={18} />}</div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            {course ? <span className="chip c">{course.short}</span> : d.courseName && <span className="chip">{d.courseName}</span>}
            {d.source === 'manual' && <span className="chip">הוספתי בעצמי</span>}
            {d.submitted && <span className="chip good">הוגש במודל</span>}
            {d.done && !d.submitted && <span className="chip good">סומן כבוצע</span>}
          </div>
          <div style={{ fontWeight: 700, fontSize: 16.5, marginTop: 6 }}>{d.title}</div>
          <div className="muted" style={{ fontSize: 13.5 }}>להגשה עד {fmtDue(d.dueAt)}</div>
          {(() => {
            const parsed = d.intro && parseRequired(d.intro);
            if (parsed) return <div className="assign-line" style={{ marginTop: 6 }}>להגשה: {parsed.items.map((it) => (it.parts.length ? `${it.n} (${partsLabel(it.parts)})` : it.n)).join(' · ')}</div>;
            return d.intro ? <div className="faint clamp-3" style={{ fontSize: 13, marginTop: 4 }} title={d.intro}>{ltr(oneLine(d.intro))}</div> : null;
          })()}
        </div>
        <div className="deadline-count" style={{ color: textColor }}>{finished ? '✓' : c.text}</div>
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
        {safeHref(d.url) && <a className="btn sm" href={safeHref(d.url)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> להגשה במודל</a>}
        {!d.submitted && (
          <button className="btn sm" onClick={() => act(() => deadlineActions.toggleDone(d))}>
            <Check size={14} /> {d.done ? 'ביטול סימון' : 'סימון כבוצע'}
          </button>
        )}
        {d.source === 'manual' && (
          <button className="btn sm icon ghost" title="מחיקה" onClick={() => act(() => deadlineActions.removeManual(d.id))}><Trash2 size={14} /></button>
        )}
      </div>
    </motion.div>
  );
}

function AddDeadline({ courses }) {
  const { toast, deadlineActions } = useApp();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', courseId: '', dueAt: '', note: '' });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await deadlineActions.addManual({ ...form, dueAt: new Date(form.dueAt).toISOString() });
      toast('הדדליין נוסף – תקבל תזכורות לפני');
      setForm({ title: '', courseId: '', dueAt: '', note: '' });
      setOpen(false);
    } catch (err) {
      toast(err.message, 'info');
    }
  };
  return (
    <div style={{ marginTop: 10 }}>
      {!open ? (
        <button className="btn sm" onClick={() => setOpen(true)}><Plus size={14} /> הוספת דדליין ידנית</button>
      ) : (
        <motion.form className="card pad stack" onSubmit={submit} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ gap: 10 }}>
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            <label className="field grow" style={{ minWidth: 200 }}>מה צריך להגיש / ללמוד?
              <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="למשל: הגשת תרגיל 2, בוחן אמצע…" />
            </label>
            <label className="field" style={{ width: 200 }}>קורס
              <select className="input" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })}>
                <option value="">כללי</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.short}</option>)}
              </select>
            </label>
            <label className="field" style={{ width: 220 }}>מועד
              <input className="input" type="datetime-local" required value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
            </label>
          </div>
          <label className="field">הערה (לא חובה)<input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>ביטול</button>
            <button className="btn accent">הוספה</button>
          </div>
        </motion.form>
      )}
    </div>
  );
}

function UpdateItem({ item, course, isNew, i }) {
  const [expanded, setExpanded] = useState(false);
  const T = TYPE[item.type] || TYPE.announcement;
  const Icon = item.type === 'material' ? MATERIAL_ICON[item.kind] || BookOpen : T.icon;
  const text = item.type === 'deadline' ? oneLine(item.body || '') : (item.body || '').replace(/\r/g, '').replace(/\n\s*\n+/g, '\n').trim();
  const long = text.length > 320;
  const body = long && !expanded ? text.slice(0, 300).trimEnd() + '…' : text;
  return (
    <motion.div className={`card update ${isNew ? 'unread' : ''}`} data-color={course?.color} variants={fadeUp} initial="hidden" animate="show" custom={i % 12}>
      <div className="update-icon"><Icon size={18} /></div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {isNew && <span className="chip bad" style={{ fontWeight: 700 }}>חדש</span>}
          <span className="chip">{item.type === 'material' ? { lecture: 'הרצאה', tutorial: 'תרגול', homework: 'שיעורי בית', exam: 'מבחן קודם' }[item.kind] || T.label : T.label}</span>
          {course && <span className="chip c">{course.short}</span>}
          <span className="faint" style={{ fontSize: 12.5, marginInlineStart: 'auto' }}>{timeOf(item.addedAt)}</span>
        </div>
        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 6 }}>{item.title}</div>
        {item.author && <div className="faint" style={{ fontSize: 12.5 }}>{item.author}</div>}
        {body && <div className="update-body">{ltr(body)}</div>}
        <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
          {long && <button className="btn sm ghost" onClick={() => setExpanded((x) => !x)}>{expanded ? 'פחות' : 'להודעה המלאה'} <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} /></button>}
          {item.lectureId && <Link className="btn sm" to={`/lecture/${item.lectureId}`}>פתיחה באתר</Link>}
          {safeHref(item.url) && <a className="btn sm" href={safeHref(item.url)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> במודל</a>}
        </div>
      </div>
    </motion.div>
  );
}

export default function Updates() {
  const { updates, refreshUpdates, seenAt, markUpdatesSeen, courses, setContext, toast, deadlineActions, me } = useApp();
  const [filter, setFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [showDone, setShowDone] = useState(false);
  // Snapshot of what was unread when the page opened, so highlights stay while the badge clears.
  const firstSeen = useRef(seenAt);

  useEffect(() => { setContext({}); }, [setContext]);
  useEffect(() => {
    refreshUpdates();
    const t = setTimeout(markUpdatesSeen, 1500);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const courseOf = (id) => courses.find((c) => c.id === id);
  // The lecturer's instructions live on the homework item imported from the assignment; link them by assignment id.
  const { data: lectureList } = useFetch('/api/lectures');
  const instructions = useMemo(
    () => Object.fromEntries((lectureList || []).filter((l) => l.source?.assignment?.instructions).map((l) => [`assign:${l.source.assignment.id}`, l.source.assignment.instructions])),
    [lectureList]
  );
  const withInstructions = (d) => (instructions[d.moodleKey] ? { ...d, intro: instructions[d.moodleKey] } : d);
  const items = updates.items.filter((i) =>
    filter === 'all' ? true : filter === 'deadlines' ? i.type === 'deadline' || i.type === 'reminder' : i.type === filter
  );
  const groups = useMemo(() => {
    const g = [];
    for (const it of items) {
      const label = dayLabel(it.addedAt);
      if (!g.length || g[g.length - 1][0] !== label) g.push([label, []]);
      g[g.length - 1][1].push(it);
    }
    return g;
  }, [items]);

  const upcoming = updates.deadlines.filter((d) => !d.submitted && !d.done && new Date(d.dueAt) > Date.now());
  const others = updates.deadlines.filter((d) => !upcoming.includes(d));
  const settings = updates.settings || {};

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { result } = await api.post('/api/moodle/sync');
      const n = (result.imported?.length || 0) + (result.announcements || 0);
      toast(n ? `נמצאו ${n} עדכונים חדשים` : 'אין עדכונים חדשים במודל');
      refreshUpdates();
    } catch (e) {
      toast(e.message, 'info');
    } finally {
      setSyncing(false);
    }
  };
  const setSetting = async (patch) => {
    try {
      if (patch.reminderDays) await deadlineActions.setReminderDays(patch.reminderDays);
      else {
        await api.put('/api/updates/settings', patch);
        refreshUpdates();
      }
    } catch (e) {
      toast(e.message, 'info');
    }
  };

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <motion.div className="course-icon" style={{ background: 'linear-gradient(135deg,#e5484d,#ff8a5c)' }} animate={{ rotate: [0, -12, 10, -6, 0] }} transition={{ duration: 0.9, delay: 0.3 }}>
            <Bell size={22} />
          </motion.div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>עדכונים</h1>
            <div className="muted" style={{ fontSize: 14 }}>חומרים חדשים, הודעות מהקורסים ודדליינים – הכל ממודל, במקום אחד.</div>
          </div>
          {!STATIC && (
            <button className="btn accent" onClick={syncNow} disabled={syncing}>
              <RefreshCw size={16} className={syncing ? 'spin' : ''} /> {syncing ? 'בודק במודל…' : 'בדיקה במודל עכשיו'}
            </button>
          )}
        </div>
        <div className="row wrap" style={{ gap: 12, marginTop: 16, fontSize: 14 }}>
            {!STATIC && (
              <>
                <label className="row" style={{ gap: 8, fontWeight: 600 }}>
                  <input type="checkbox" checked={!!settings.notify} onChange={(e) => setSetting({ notify: e.target.checked })} />
                  <BellRing size={15} /> התראות במחשב (macOS)
                </label>
                <button className="btn sm ghost" onClick={() => api.post('/api/updates/test-notification').then(() => toast('נשלחה התראת בדיקה'))}>בדיקת התראה</button>
                <span className="faint">·</span>
              </>
            )}
            <span style={{ fontWeight: 600 }}>תזכורות לפני הגשה:</span>
            {[7, 3, 2, 1].map((d) => {
              const on = (settings.reminderDays || []).includes(d);
              return (
                <button key={d} className={`chip ${on ? 'c' : ''}`} onClick={() => setSetting({ reminderDays: on ? settings.reminderDays.filter((x) => x !== d) : [...(settings.reminderDays || []), d] })}>
                  {on && <Check size={12} />} {d === 1 ? 'יום' : d === 2 ? 'יומיים' : `${d} ימים`}
                </button>
              );
            })}
        </div>
        {STATIC && me?.calendarPath && <CalendarCard path={me.calendarPath} />}
        {STATIC && me && me.moodleOk === false && (
          <div className="callout row" style={{ marginTop: 14, background: 'var(--warn-bg)' }}>
            <AlarmClock size={16} color="var(--warn)" /> החיבור למודל פג, אז ההגשות לא מתעדכנות. התנתקו והתחברו שוב כדי לחדש אותו.
          </div>
        )}
      </motion.div>

      <div className="section-title"><h2>הגשות קרובות</h2><div className="line" /></div>
      {upcoming.length === 0 ? (
        <div className="card pad muted" style={{ textAlign: 'center' }}>אין הגשות פתוחות כרגע 🎉</div>
      ) : (
        <div className="deadline-grid">
          {upcoming.map((d, i) => <DeadlineCard key={d.id} d={withInstructions(d)} course={courseOf(d.courseId)} i={i} />)}
        </div>
      )}
      {others.length > 0 && (
        <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setShowDone((x) => !x)}>
          {showDone ? 'הסתרת' : 'הצגת'} הגשות שהוגשו / עברו ({others.length})
        </button>
      )}
      <AnimatePresence>
        {showDone && (
          <motion.div className="deadline-grid" style={{ marginTop: 10 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {others.map((d, i) => <DeadlineCard key={d.id} d={withInstructions(d)} course={courseOf(d.courseId)} i={i} />)}
          </motion.div>
        )}
      </AnimatePresence>
      <AddDeadline courses={courses} />

      <div className="section-title">
        <h2>כל העדכונים</h2>
        <div className="line" />
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {FILTERS.map(([id, label]) => (
          <button key={id} className={`tab ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>
            {filter === id && <motion.span layoutId="upd-filter" className="tab-bg" />}
            {label}
          </button>
        ))}
      </div>
      {groups.length === 0 && (
        <div className="empty"><div className="empty-icon"><Inbox size={28} /></div><h3>אין עדכונים עדיין</h3><p>כשיעלה חומר חדש למודל, הודעה או הגשה – זה יופיע כאן.</p></div>
      )}
      {groups.map(([label, list]) => (
        <div key={label} style={{ marginBottom: 18 }}>
          <div className="day-label">{label}</div>
          <div className="stack" style={{ gap: 10 }}>
            {list.map((it, i) => <UpdateItem key={it.id} item={it} course={courseOf(it.courseId)} isNew={it.addedAt > firstSeen.current} i={i} />)}
          </div>
        </div>
      ))}
    </Page>
  );
}

/** Subscribe link for the student's personal calendar: deadlines with alarms N days before. */
function CalendarCard({ path }) {
  const { toast } = useApp();
  const https = `${location.origin}${path}`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(https);
      toast('הקישור הועתק');
    } catch {
      toast('לא הצלחתי להעתיק – אפשר לסמן ולהעתיק ידנית', 'info');
    }
  };
  return (
    <div className="callout" style={{ marginTop: 14 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <CalendarClock size={18} />
        <b className="grow">ההגשות ביומן שלך, עם תזכורות</b>
        <a className="btn sm" href={webcal}>אייפון / מק</a>
        <a className="btn sm" href={google} target="_blank" rel="noreferrer">יומן גוגל</a>
        <button className="btn sm ghost" onClick={copy}>העתקת קישור</button>
      </div>
      <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>
        היומן מתעדכן לבד מהמודל, והתראות מגיעות לטלפון לפי ימי התזכורת שבחרת. הקישור אישי – לא לשתף אותו.
      </div>
    </div>
  );
}

export function UpcomingWidget() {
  const { updates, courses } = useApp();
  const upcoming = updates.deadlines.filter((d) => !d.submitted && !d.done && new Date(d.dueAt) > Date.now()).slice(0, 3);
  if (!upcoming.length) return null;
  return (
    <div className="card pad">
      <div className="row" style={{ marginBottom: 10 }}>
        <h3 style={{ fontSize: 16 }} className="grow">הגשות קרובות</h3>
        <Link to="/updates" className="faint" style={{ fontSize: 13 }}>לכל העדכונים</Link>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {upcoming.map((d) => {
          const c = countdown(d.dueAt);
          const course = courses.find((x) => x.id === d.courseId);
          return (
            <Link key={d.id} to="/updates" className="row" data-color={course?.color} style={{ padding: '8px 10px', borderRadius: 12, background: 'var(--surface-2)' }}>
              <CalendarClock size={16} color="var(--c)" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>{course?.short} · {fmtDue(d.dueAt)}</div>
              </div>
              <span className={`chip ${c.level === 'urgent' ? 'bad' : c.level === 'soon' ? 'warn' : ''}`}>{c.text}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

