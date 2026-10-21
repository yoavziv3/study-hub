import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { CalendarRange, MapPin, ChevronDown, Info, Clock, Search, Share2, Check, Users, Ban, RefreshCcw } from 'lucide-react';
import { useApp } from '../store.jsx';
import { CourseIcon, Page, fadeUp } from '../components/ui.jsx';
import { api, STATIC } from '../api.js';
import PortalConnect from '../components/PortalConnect.jsx';
import {
  DAY_NAMES, typeLabel, minutes, classTypes, groupsOf, chosen, missingGroups, mySlots, upcoming, whenLabel,
  groupRooms, matchRoom, soleMatch, shareableGroups, validShared, withPortal,
} from '../lib/schedule.js';

const HOUR_PX = 58;
const dayShort = (d) => `יום ${'אבגדהוש'[d]}׳`;
const slotText = (g) => g.slots.map((s) => `${dayShort(s.day)} ${s.start}–${s.end}`).join(', ');
const groupOption = (g) => `${g.group} · ${g.lecturer || ''} · ${slotText(g)}${groupRooms(g) ? ` · ${groupRooms(g)}` : ''}`;

/** One course's groups: a room search, then a dropdown per type (lecture, tutorial…). */
function CourseGroups({ c }) {
  const { progress, setClassGroup, setClassGroups } = useApp();
  const [q, setQ] = useState('');
  const types = classTypes(c);
  const pick = chosen(c, progress);

  // Picking a lecture also picks its only matching tutorial/lab, so most courses need one choice.
  const choose = (type, group) => {
    setClassGroup(c.id, type, group);
    if (type === 'שעור' && group) {
      const extra = {};
      for (const t of types) { if (t === 'שעור') continue; const only = soleMatch(c, t, group); if (only && !pick[t]) extra[t] = only; }
      if (Object.keys(extra).length) setClassGroups({ [c.id]: extra });
    }
  };
  // A room/building search that picks the matching group in every type it appears in.
  const hits = q ? types.flatMap((t) => matchRoom(c, t, q).map((g) => ({ t, g }))) : [];
  const applyHit = (t, group) => { choose(t, group); setQ(''); };

  return (
    <div className="group-course" data-color={c.color}>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <span className="nav-dot"><CourseIcon name={c.icon} size={14} /></span>
        <b className="grow">{c.short}</b>
      </div>
      {!types.length ? (
        <div className="faint" style={{ fontSize: 13 }}>אין לקורס הזה זמני לימוד בקובץ הקורסים.</div>
      ) : (
        <>
          <div className="group-search">
            <Search size={14} />
            <input className="input" placeholder="חיפוש לפי חדר או בניין…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {q && (
            <div className="group-hits">
              {hits.length ? hits.slice(0, 6).map(({ t, g }) => (
                <button key={`${t}-${g.group}`} className="group-hit" onClick={() => applyHit(t, g.group)}>
                  <b>{typeLabel(t)} {g.group}</b><span>{groupRooms(g)} · {slotText(g)}</span>
                </button>
              )) : <div className="faint" style={{ fontSize: 12.5, padding: '4px 2px' }}>אין קבוצה עם החדר הזה.</div>}
            </div>
          )}
          {types.map((t) => (
            <label key={t} className="field" style={{ marginBottom: 8 }}>
              {typeLabel(t)}
              <select className="input" value={pick[t] || ''} onChange={(e) => choose(t, e.target.value)}>
                <option value="">בחירת קבוצה…</option>
                {groupsOf(c, t, pick['שעור']).map((g) => <option key={g.group} value={g.group}>{groupOption(g)}</option>)}
              </select>
            </label>
          ))}
        </>
      )}
    </div>
  );
}

/** Copy a link that fills these same groups for a friend. */
function ShareButton({ courses }) {
  const { progress, toast } = useApp();
  const [copied, setCopied] = useState(false);
  const picks = shareableGroups(courses, progress);
  if (!Object.keys(picks).length) return null;
  const share = async () => {
    const url = `${location.origin}/schedule?groups=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(picks)))))}`;
    try {
      if (navigator.share) await navigator.share({ title: 'מערכת השעות שלי', url });
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    } catch { toast('לא הצלחתי ליצור קישור', 'info'); }
  };
  return (
    <button className="btn sm" onClick={share}>{copied ? <><Check size={14} /> הקישור הועתק</> : <><Share2 size={14} /> שיתוף הקבוצות</>}</button>
  );
}

/** Pick your lecture / tutorial group in each course (once per semester). */
function GroupPicker({ courses }) {
  const { progress } = useApp();
  const anyMissing = courses.some((c) => missingGroups(c, progress).length);
  const [open, setOpen] = useState(anyMissing);
  useEffect(() => { if (anyMissing) setOpen(true); }, [anyMissing]);
  return (
    <div className="card pad">
      <button className="row grow linkish" style={{ width: '100%', gap: 10 }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <h3 className="grow" style={{ fontSize: 17, textAlign: 'start' }}>הקבוצות שלי</h3>
        {anyMissing ? <span className="chip warn">חסר לבחור</span> : <span className="chip good">הכל נבחר</span>}
        <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>
      {open && (
        <>
          <div className="row wrap" style={{ gap: 8, margin: '6px 0 14px' }}>
            <p className="faint grow" style={{ fontSize: 13, margin: 0, minWidth: 180 }}>
              בוחרים פעם אחת בכל קורס את הקבוצה שלכם. אפשר לחפש לפי חדר, ובחירת שיעור בוחרת לבד את התרגול שמתאים לו. הימים, השעות והחדרים מתעדכנים מקובץ הקורסים.
            </p>
            <ShareButton courses={courses} />
          </div>
          <div className="group-picker">
            {courses.map((c) => <CourseGroups key={c.id} c={c} />)}
          </div>
        </>
      )}
    </div>
  );
}

/** When opened with ?groups=… (a friend's share link), offer to apply those groups. */
function SharedBanner({ courses }) {
  const { setClassGroups, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const shared = useMemo(() => {
    const raw = params.get('groups');
    if (!raw) return null;
    try { return validShared(courses, JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(raw)))))); } catch { return null; }
  }, [params, courses]);
  if (!shared || !Object.keys(shared).length) return null;
  const n = Object.keys(shared).length;
  const apply = () => {
    setClassGroups(shared);
    toast('הקבוצות שובצו במערכת השעות שלך');
    params.delete('groups');
    setParams(params, { replace: true });
  };
  return (
    <motion.div className="card pad row wrap" style={{ gap: 12, marginTop: 16, borderInlineStart: '4px solid var(--c)' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <Users size={20} />
      <div className="grow" style={{ minWidth: 200 }}>
        <b>חבר/ה שיתפו איתך מערכת שעות</b>
        <div className="faint" style={{ fontSize: 13 }}>אפשר לשבץ את הקבוצות שלהם ב־{n} קורסים. זה יחליף רק את הקבוצות, לא שום דבר אחר.</div>
      </div>
      <button className="btn accent" onClick={apply}><Check size={15} /> שיבוץ הקבוצות</button>
      <button className="btn ghost" onClick={() => { params.delete('groups'); setParams(params, { replace: true }); }}>לא עכשיו</button>
    </motion.div>
  );
}

function SlotBlock({ s, style, compact, narrow }) {
  return (
    <Link to={`/course/${s.course.id}`} className={`slot ${narrow ? 'narrow' : ''} ${s.canceled ? 'canceled' : ''}`} data-color={s.course.color} style={style} title={`${s.course.short} · ${typeLabel(s.type)} ${s.group} · ${s.lecturer}${s.moved ? ` · בקובץ הקורסים: ${s.catalogPlace}` : ''}`}>
      <b>{s.course.short}</b>
      <span>{s.canceled ? 'בוטל' : typeLabel(s.type)}</span>
      {!narrow && <span className="slot-time">{s.start}–{s.end}</span>}
      {!compact && (s.place || s.mode) && <span className={`slot-place ${s.moved ? 'moved' : ''}`}>{s.moved && <RefreshCcw size={10} />} {s.place || s.mode}</span>}
    </Link>
  );
}

/** Sunday–Friday columns, hours down the side; today highlighted with a line at the current time. */
function WeekGrid({ slots, now }) {
  const days = [0, 1, 2, 3, 4, 5, ...(slots.some((s) => s.day === 6) ? [6] : [])];
  const from = Math.min(8, ...slots.map((s) => Math.floor(minutes(s.start) / 60)));
  const to = Math.max(18, ...slots.map((s) => Math.ceil(minutes(s.end) / 60)));
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNow = nowMin >= from * 60 && nowMin <= to * 60;
  return (
    <div className="week" style={{ '--hours': hours.length, '--hour': `${HOUR_PX}px`, gridTemplateColumns: `48px repeat(${days.length}, minmax(0, 1fr))` }}>
      <div />
      {days.map((d) => <div key={d} className={`week-day ${d === now.getDay() ? 'today' : ''}`}>{DAY_NAMES[d]}</div>)}
      <div className="week-hours">{hours.map((h) => <div key={h}>{`${String(h).padStart(2, '0')}:00`}</div>)}</div>
      {days.map((d) => (
        <div key={d} className={`week-col ${d === now.getDay() ? 'today' : ''}`}>
          {slots.filter((s) => s.day === d).map((s) => {
            const top = ((minutes(s.start) - from * 60) / 60) * HOUR_PX;
            const height = ((minutes(s.end) - minutes(s.start)) / 60) * HOUR_PX - 4;
            // Overlapping meetings (two groups at the same time) share the column side by side.
            const clash = slots.filter((o) => o.day === d && minutes(o.start) < minutes(s.end) && minutes(s.start) < minutes(o.end));
            const i = clash.indexOf(s);
            return <SlotBlock key={s.key} s={s} compact={height < 70 || clash.length > 1} narrow={clash.length > 2} style={{ top, height, width: `calc(${100 / clash.length}% - 4px)`, insetInlineStart: `${(100 / clash.length) * i}%` }} />;
          })}
          {d === now.getDay() && showNow && <div className="week-now" style={{ top: ((nowMin - from * 60) / 60) * HOUR_PX }} />}
        </div>
      ))}
    </div>
  );
}

/** Phones: the week as a list, today first. */
function DayList({ slots, now }) {
  const order = [0, 1, 2, 3, 4, 5, 6].map((i) => (now.getDay() + i) % 7).filter((d) => slots.some((s) => s.day === d));
  return (
    <div className="stack" style={{ gap: 14 }}>
      {order.map((d) => (
        <div key={d}>
          <div className="day-title">{d === now.getDay() ? `היום · ${DAY_NAMES[d]}` : DAY_NAMES[d]}</div>
          <div className="stack" style={{ gap: 8 }}>
            {slots.filter((s) => s.day === d).map((s) => (
              <Link key={s.key} to={`/course/${s.course.id}`} className="agenda-row" data-color={s.course.color}>
                <div className="agenda-time"><b>{s.start}</b><span>{s.end}</span></div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{s.course.short} · {typeLabel(s.type)}{s.canceled && <span className="chip bad" style={{ marginInlineStart: 6 }}><Ban size={11} /> בוטל</span>}</div>
                  <div className={s.moved ? 'slot-moved' : 'faint'} style={{ fontSize: 13 }}>{s.moved && <RefreshCcw size={11} />} {s.place || s.mode}{s.lecturer ? ` · ${s.lecturer}` : ''}</div>
                  {s.moved && <div className="faint" style={{ fontSize: 12 }}>החדר עודכן בפורטל (בקובץ הקורסים: {s.catalogPlace})</div>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Schedule() {
  const { courses, progress, setContext } = useApp();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { setContext({}); }, [setContext]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  const withClasses = courses.filter((c) => c.classes?.length);
  // Cloud: with the portal connected, its rooms and cancellations are laid over the catalog's timetable.
  const [portal, setPortal] = useState(null);
  useEffect(() => { if (STATIC) api.get('/api/portal').then(setPortal).catch(() => {}); }, []);
  const slots = useMemo(() => withPortal(mySlots(courses, progress), portal?.ok ? portal.lessons : null), [courses, progress, portal]);
  const next = upcoming(slots, now, 1)[0];
  // Two chosen groups at the same time – usually a wrong pick.
  const clashes = slots.flatMap((a, i) => slots.slice(i + 1)
    .filter((b) => b.day === a.day && b.course.id !== a.course.id && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end))
    .map((b) => `${DAY_NAMES[a.day]} ${a.start}: ${a.course.short} ו${b.course.short}`));

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon"><CalendarRange size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>מערכת שעות</h1>
            <div className="muted" style={{ fontSize: 14 }}>{portal?.ok ? 'הימים והשעות מקובץ הקורסים, והחדרים והביטולים מהמערכת שלך בפורטל.' : 'הימים, השעות והחדרים מקובץ הקורסים של האוניברסיטה – מתעדכן אוטומטית אם משהו משתנה.'}</div>
          </div>
          {next && (
            <div className="next-class" data-color={next.course.color}>
              <Clock size={16} />
              <div>
                <div style={{ fontWeight: 700 }}>{next.live ? 'עכשיו' : 'הבא'}: {next.course.short} · {typeLabel(next.type)}</div>
                <div className="faint" style={{ fontSize: 13 }}>{whenLabel(next)}{next.place ? ` · ${next.place}` : ''}</div>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {STATIC && portal && <div style={{ marginTop: 16 }}><PortalConnect status={portal} onChange={setPortal} /></div>}
      <SharedBanner courses={withClasses} />
      <div style={{ marginTop: 16 }}><GroupPicker courses={withClasses} /></div>

      {clashes.length > 0 && (
        <div className="callout row" style={{ gap: 8, marginTop: 14, background: 'var(--warn-bg)' }}>
          <Info size={16} /> <span>יש התנגשות בין שיעורים ({clashes.join(' · ')}) – כדאי לבדוק שבחרתם את הקבוצות הנכונות.</span>
        </div>
      )}
      {slots.length > 0 ? (
        <div className="card pad" style={{ marginTop: 16 }}>
          <div className="week-wrap"><WeekGrid slots={slots} now={now} /></div>
          <div className="day-list-wrap"><DayList slots={slots} now={now} /></div>
        </div>
      ) : (
        <div className="empty" style={{ marginTop: 16 }}>
          <div className="empty-icon"><CalendarRange size={28} /></div>
          <h2>עוד לא נבחרו קבוצות</h2>
          <p>בוחרים למעלה את הקבוצה בכל קורס, והמערכת נבנית לבד.</p>
        </div>
      )}
      {slots.some((s) => !s.place && s.mode) && (
        <div className="callout row" style={{ gap: 8, marginTop: 14 }}><Info size={16} /> מפגשים בלי חדר הם מקוונים – הקישור לזום נמצא בלשונית "קישורים" של הקורס.</div>
      )}
      {slots.some((s) => s.place) && (
        <div className="faint row" style={{ gap: 6, fontSize: 12.5, marginTop: 10 }}><MapPin size={13} /> המספר בסוגריים הוא מספר הבניין במפת הקמפוס.</div>
      )}
    </Page>
  );
}
