import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, ListChecks, Presentation, Clock, Printer, FileText } from 'lucide-react';
import { ltr } from './ui.jsx';
import { Block, markdownSections, useActiveSection } from './StudySummary.jsx';
import ReportButton from './ReportButton.jsx';

const words = (s) => (s ? String(s).split(/\s+/).length : 0);

/** The whole course in one document: every lecture's (and tutorial's) study summary in order, with a side
 *  navigation of lectures that expands to the sections of the lecture being read. */
export default function CourseSummaries({ course, bundle }) {
  const parts = useMemo(() => {
    const lectures = bundle.lectures.filter((l) => (l.kind || 'lecture') !== 'homework' && (l.content?.notes?.sections?.length || l.content?.summary));
    return lectures.map((l, li) => {
      const c = l.content;
      const sections = (c.notes?.sections?.length ? c.notes.sections : markdownSections(c.summary)).map((s, i) => ({ ...s, id: `l${li}-s${i + 1}` }));
      const takeaways = c.notes?.takeaways?.length ? c.notes.takeaways : c.keyPoints;
      if (takeaways?.length) sections.push({ title: 'מה לוקחים מהשיעור', special: 'takeaways', items: takeaways, id: `l${li}-take` });
      const kind = l.kind || 'lecture';
      return {
        id: `l${li}`,
        lecture: l,
        label: `${kind === 'tutorial' ? 'תרגול' : course.unitLabel || 'הרצאה'} ${l.unitNumber || l.lessonNumber || li + 1}`,
        subtitle: c.notes?.subtitle || c.overview,
        sections,
      };
    });
  }, [bundle, course.unitLabel]);

  const anchors = useMemo(() => parts.flatMap((p) => [{ id: p.id }, ...p.sections]), [parts]);
  const active = useActiveSection(anchors);
  const current = parts.find((p) => p.id === active || p.sections.some((s) => s.id === active)) || parts[0];
  const minutes = useMemo(
    () => Math.max(1, Math.round(parts.reduce((n, p) => n + p.sections.reduce((a, s) => a + (s.blocks || []).reduce((b, x) => b + words(x.body), 0) + (s.items || []).reduce((b, x) => b + words(x), 0), 0), 0) / 180)),
    [parts]
  );
  // Smooth scrolling across a very long document gets cut off midway: far jumps are instant.
  const go = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const far = Math.abs(el.getBoundingClientRect().top) > 3 * window.innerHeight;
    el.scrollIntoView({ behavior: far ? 'auto' : 'smooth', block: 'start' });
  };

  if (!parts.length) {
    return (
      <div className="empty">
        <div className="empty-icon"><FileText size={28} /></div>
        <h3>עוד אין סיכומים בקורס הזה</h3>
        <p>כשהמרצה יעלה מצגות למודל, הן ייכנסו לאתר ויסוכמו אוטומטית – וכל הסיכומים יתרכזו כאן.</p>
      </div>
    );
  }

  return (
    <div className="notes-layout">
      <article className="notes">
        <header className="notes-head">
          <div className="notes-eyebrow">
            סיכום הקורס · {parts.length} {parts.length === 1 ? 'שיעור' : 'שיעורים'} · <Clock size={13} /> {minutes} דקות קריאה
          </div>
          <p className="notes-lead">כל השיעורים של {course.short} במסמך אחד, לפי הסדר – ההגדרות, הדוגמאות, הכללים ומה שחשוב לזכור מכל שיעור.</p>
          <button className="btn sm ghost no-print" style={{ marginTop: 10 }} onClick={() => window.print()}><Printer size={15} /> הדפסה / שמירה כ-PDF</button>
        </header>

        <CourseMobileToc parts={parts} current={current} active={active} go={go} />

        {parts.map((p, pi) => (
          <section key={p.id} className="course-part">
            <div id={p.id} className="part-head">
              <span className="part-num">{pi + 1}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="part-label">{p.label}</div>
                <h2>{ltr(p.lecture.title)}</h2>
                {p.subtitle && <p>{ltr(p.subtitle)}</p>}
              </div>
              <Link className="btn sm no-print" to={`/lecture/${p.lecture.id}?tab=summary`}>לשיעור</Link>
            </div>
            {p.sections.map((s, i) => (
              <section key={s.id} id={s.id} className="note-section">
                <div className="note-section-head">
                  <h3 className="note-section-title"><span className="note-num">{i + 1}</span>{ltr(s.title)}</h3>
                  {!s.special && <ReportButton lectureId={p.lecture.id} section={s.title} />}
                  {s.slideStart > 0 && (
                    <Link className="chip slide-link no-print" to={`/lecture/${p.lecture.id}?tab=slides&slide=${s.slideStart}`} title="מעבר לשקפים">
                      <Presentation size={12} /> {s.slideEnd > s.slideStart ? `שקפים ${s.slideStart}–${s.slideEnd}` : `שקף ${s.slideStart}`}
                    </Link>
                  )}
                </div>
                {s.blocks?.map((b, j) => <Block key={j} block={b} />)}
                {s.special === 'takeaways' && (
                  <ol className="takeaways">
                    {s.items.map((t, j) => <li key={j}><span>{j + 1}</span><div>{ltr(t)}</div></li>)}
                  </ol>
                )}
              </section>
            ))}
          </section>
        ))}
      </article>

      <nav className="notes-toc course-toc" aria-label="ניווט בסיכום הקורס">
        <h4>סיכום הקורס</h4>
        {parts.map((p, pi) => (
          <div key={p.id}>
            <a href={`#${p.id}`} className={`toc-lecture ${current === p ? 'on' : ''}`} onClick={(e) => { e.preventDefault(); go(p.id); }}>
              <span className="toc-num">{pi + 1}</span>
              <span>{ltr(p.lecture.title)}</span>
            </a>
            <AnimatePresence initial={false}>
              {current === p && (
                <motion.div className="toc-sub" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
                  {p.sections.map((s) => (
                    <a key={s.id} href={`#${s.id}`} className={active === s.id ? 'on' : ''} onClick={(e) => { e.preventDefault(); go(s.id); }}>
                      {s.special === 'takeaways' && <ListChecks size={13} />}
                      {ltr(s.title)}
                    </a>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </nav>
    </div>
  );
}

// Narrow screens: a sticky dropdown with the lectures and the sections of the current one.
function CourseMobileToc({ parts, current, active, go }) {
  const [open, setOpen] = useState(false);
  const section = current?.sections.find((s) => s.id === active);
  const pick = (id) => { go(id); setOpen(false); };
  return (
    <div className="notes-toc-mobile">
      <button className="notes-toc-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="faint">{current?.label}:</span>
        <b className="grow">{ltr(section?.title || current?.lecture.title || '')}</b>
        <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: 'grid' }}><ChevronDown size={17} /></motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="notes-toc-menu" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {parts.map((p, pi) => (
              <div key={p.id}>
                <a href={`#${p.id}`} className={`toc-lecture ${current === p ? 'on' : ''}`} onClick={(e) => { e.preventDefault(); pick(p.id); }}>
                  <span className="toc-num">{pi + 1}</span>{ltr(p.lecture.title)}
                </a>
                {current === p && p.sections.map((s) => (
                  <a key={s.id} href={`#${s.id}`} className={`toc-sub-item ${active === s.id ? 'on' : ''}`} onClick={(e) => { e.preventDefault(); pick(s.id); }}>{ltr(s.title)}</a>
                ))}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
