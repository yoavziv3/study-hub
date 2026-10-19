import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { History, ChevronDown, ArrowLeft, BookOpen, Presentation, PencilRuler, Check, ScrollText } from 'lucide-react';
import { useApp } from '../store.jsx';
import { useFetch } from '../api.js';
import { CourseIcon, Page, fadeUp } from '../components/ui.jsx';
import { SEMESTER_LABEL, hebrewYear, studyYearLabel, termKey } from '../lib/terms.js';

const KIND = { lecture: ['שיעורים', BookOpen], tutorial: ['תרגולים', Presentation], homework: ['שיעורי בית ותרגילים', PencilRuler], exam: ['מבחנים קודמים', ScrollText] };

/** Past (and current) semesters: pick a year and a semester, see its courses and every lecture you had. */
export default function Archive() {
  const { allCourses, terms, term: current, progress, setContext } = useApp();
  const { data: lectures = [] } = useFetch('/api/lectures');
  useEffect(() => { setContext({}); }, [setContext]);

  const years = useMemo(() => [...new Set(terms.map((t) => t.year))], [terms]);
  const past = terms.filter((t) => !current || termKey(t) !== termKey(current));
  const [picked, setPicked] = useState(null);
  const selected = picked || past.at(-1) || current;
  const courses = allCourses.filter((c) => c.term && selected && termKey(c.term) === termKey(selected));

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon"><History size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>לימודי עבר</h1>
            <div className="muted" style={{ fontSize: 14 }}>כל סמסטר נשמר עם הקורסים, ההרצאות, הסיכומים וההתקדמות שלך – אפשר לחזור אליו בכל רגע.</div>
          </div>
        </div>
      </motion.div>

      {!terms.length ? (
        <div className="empty"><div className="empty-icon"><History size={28} /></div><h3>עוד אין סמסטרים קודמים</h3><p>כשסמסטר חדש יתחיל, הקורסים של הסמסטר הנוכחי יעברו לכאן עם כל החומר שלהם.</p></div>
      ) : (
        <>
          <div className="term-picker">
            {years.map((y) => (
              <div key={y} className="term-year">
                <div className="term-year-label">{studyYearLabel(terms.find((t) => t.year === y), terms)} <span className="faint">· {hebrewYear(y)}</span></div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {terms.filter((t) => t.year === y).map((t) => {
                    const on = selected && termKey(t) === termKey(selected);
                    const isNow = current && termKey(t) === termKey(current);
                    return (
                      <button key={termKey(t)} className={`tab ${on ? 'active' : ''}`} onClick={() => setPicked(t)}>
                        {on && <motion.span layoutId="term-tab" className="tab-bg" />}
                        {SEMESTER_LABEL[t.semester]}{isNow ? ' (עכשיו)' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {!past.length && <div className="callout" style={{ marginBottom: 14 }}>זה הסמסטר הראשון שלך באתר. כשיתחיל הסמסטר הבא, הסמסטר הזה יישמר כאן.</div>}
          <div className="stack">
            {courses.map((c, i) => <TermCourse key={c.id} course={c} lectures={(lectures || []).filter((l) => l.courseId === c.id)} studied={progress.studied} i={i} />)}
          </div>
        </>
      )}
    </Page>
  );
}

function TermCourse({ course, lectures, studied, i }) {
  const [open, setOpen] = useState(false);
  const done = lectures.filter((l) => studied[l.id]).length;
  return (
    <motion.div className="card term-course" data-color={course.color} variants={fadeUp} initial="hidden" animate="show" custom={i}>
      <button className="term-course-head" onClick={() => setOpen((o) => !o)}>
        <div className="course-icon" style={{ width: 40, height: 40, borderRadius: 12 }}><CourseIcon name={course.icon} size={19} /></div>
        <div className="grow" style={{ minWidth: 0, textAlign: 'start' }}>
          <div style={{ fontWeight: 700, fontSize: 16.5 }}>{course.name}</div>
          <div className="faint" style={{ fontSize: 13 }}>{course.code} · {lectures.length} פריטים{done ? ` · נלמדו ${done}` : ''}</div>
        </div>
        <Link to={`/course/${course.id}`} className="btn sm" onClick={(e) => e.stopPropagation()}>לקורס <ArrowLeft size={14} /></Link>
        <ChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <div className="term-lectures">
              {Object.entries(KIND).map(([kind, [label, Icon]]) => {
                const ls = lectures.filter((l) => (l.kind || 'lecture') === kind);
                if (!ls.length) return null;
                return (
                  <div key={kind}>
                    <div className="term-kind"><Icon size={14} /> {label}</div>
                    {ls.map((l) => (
                      <Link key={l.id} to={`/lecture/${l.id}`} className="term-lecture">
                        <span className="faint" style={{ minWidth: 26 }}>{l.unitNumber || l.lessonNumber || ''}</span>
                        <span className="grow">{l.title}</span>
                        {studied[l.id] && <Check size={15} color="var(--good)" />}
                      </Link>
                    ))}
                  </div>
                );
              })}
              {!lectures.length && <div className="muted" style={{ padding: 8 }}>לא נשמר חומר בקורס הזה.</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
