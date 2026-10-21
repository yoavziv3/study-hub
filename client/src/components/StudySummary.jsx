import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookMarked, PencilLine, Sigma, Lightbulb, AlertTriangle, ListChecks, ChevronDown, Presentation, Loader2, Sparkles, Clock } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Markdown, Tex, RichText } from './markdown.jsx';
import { requiredMap, partsLabel } from './Assignment.jsx';
import ReportButton from './ReportButton.jsx';
import ReadAloud from './ReadAloud.jsx';

// "תרגיל 3 – …", "שאלה 3", "3. …" → 3
const exerciseNo = (title = '') => Number((title.match(/(?:תרגיל|שאלה)\s*(\d{1,2})/) || title.match(/^(\d{1,2})[.)\s]/) || [])[1]) || null;

const BLOCK = {
  definition: { label: 'הגדרה', icon: BookMarked },
  example: { label: 'דוגמה', icon: PencilLine },
  rule: { label: 'כלל', icon: Sigma },
  important: { label: 'חשוב לזכור', icon: Lightbulb },
  mistake: { label: 'טעות נפוצה', icon: AlertTriangle },
};
export const KIND_LABEL = { lecture: 'הרצאה', tutorial: 'תרגול', homework: 'שיעורי בית', prep: 'הכנה למבחן · שיעור' };

// Older content (and homework) has a single markdown summary: split it on "## " into sections.
export function markdownSections(md = '') {
  const parts = md.split(/^## +/m);
  const intro = parts.shift().trim();
  const sections = parts.map((p) => {
    const nl = p.indexOf('\n');
    const title = (nl < 0 ? p : p.slice(0, nl)).replace(/[*_`]/g, '').trim();
    return { title, blocks: [{ type: 'text', body: nl < 0 ? '' : p.slice(nl + 1).trim() }] };
  });
  if (intro) sections.unshift({ title: 'פתיחה', blocks: [{ type: 'text', body: intro }] });
  return sections;
}

const words = (s) => (s ? String(s).split(/\s+/).length : 0);

export default function StudySummary({ lecture, content, goSlide, reload }) {
  const { status, toast } = useApp();
  const notes = content.notes;
  const kind = lecture.kind || 'lecture';
  const required = requiredMap(lecture.source?.assignment);

  const sections = useMemo(() => {
    const list = notes?.sections?.length ? notes.sections.map((s) => ({ ...s })) : markdownSections(content.summary);
    const takeaways = notes?.takeaways?.length ? notes.takeaways : content.keyPoints;
    if (takeaways?.length) list.push({ title: 'מה לוקחים מהשיעור', special: 'takeaways', items: takeaways });
    if (content.formulas?.length) list.push({ title: 'נוסחאות וכללים', special: 'formulas', items: content.formulas });
    if (content.examTips?.length) list.push({ title: 'טיפים למבחן', special: 'tips', items: content.examTips });
    return list.map((s, i) => ({ ...s, id: `sec-${i + 1}` }));
  }, [notes, content]);

  const minutes = useMemo(() => {
    const n = sections.reduce((sum, s) => sum + (s.blocks || []).reduce((a, b) => a + words(b.body) + words(b.title), 0) + (s.items || []).reduce((a, x) => a + words(typeof x === 'string' ? x : x.explanation), 0), 0);
    return Math.max(1, Math.round(n / 180));
  }, [sections]);

  const active = useActiveSection(sections);
  const go = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // The section being read aloud is highlighted and scrolled to as the voice reaches it.
  const [speaking, setSpeaking] = useState(null);
  const onSpeakSection = (id) => {
    setSpeaking((prev) => {
      if (id && id !== prev) go(id);
      return id;
    });
  };

  const writing = lecture.notesStatus === 'writing' || lecture.notesStatus === 'queued';
  const canGenerate = !notes && kind !== 'homework' && status?.ai?.ready && !writing;
  const generate = async () => {
    try {
      await api.post(`/api/lectures/${lecture.id}/notes`);
      toast('כתיבת הסיכום התחילה – זה לוקח כמה דקות');
      reload();
    } catch (e) { toast(e.message, 'info'); }
  };

  return (
    <div className="notes-layout">
      <article className="notes">
        <header className="notes-head">
          <div className="notes-eyebrow">
            {KIND_LABEL[kind]} {lecture.lessonNumber || ''} · <Clock size={13} /> {minutes} דקות קריאה
          </div>
          <p className="notes-lead"><RichText>{notes?.subtitle || content.overview}</RichText></p>
          <ReadAloud intro={[notes?.subtitle, content.overview].filter(Boolean).join('. ')} sections={sections} onSection={onSpeakSection} />
          {notes?.subtitle && content.overview && <p className="notes-overview"><RichText>{content.overview}</RichText></p>}
          {writing && <div className="callout row" style={{ marginTop: 14 }}><Loader2 size={16} className="spin" /> כותב סיכום מובנה עם הגדרות ודוגמאות – זה לוקח כמה דקות.</div>}
          {lecture.notesError && !writing && <div className="chip warn" style={{ marginTop: 14, height: 'auto', padding: '6px 12px', whiteSpace: 'normal' }}>{lecture.notesError}</div>}
          {canGenerate && (
            <div className="callout row local-only" style={{ marginTop: 14, justifyContent: 'space-between' }}>
              <span>אפשר ליצור לשיעור הזה סיכום מובנה עם הגדרות, דוגמאות וכללים.</span>
              <button className="btn accent sm" onClick={generate}><Sparkles size={15} /> יצירת סיכום מובנה</button>
            </div>
          )}
        </header>

        <MobileToc sections={sections} active={active} go={go} />

        {sections.map((s, i) => (
          <motion.section key={s.id} id={s.id} className={`note-section ${speaking === s.id ? 'speaking' : ''}`} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
            <div className="note-section-head">
              <h2><span className="note-num">{i + 1}</span><RichText>{s.title}</RichText></h2>
              {required && exerciseNo(s.title) && (required.has(exerciseNo(s.title)) ? (
                <span className="chip req-chip">להגשה{required.get(exerciseNo(s.title)).length ? ` · סעיפים ${partsLabel(required.get(exerciseNo(s.title)))}` : ''}</span>
              ) : (
                <span className="chip">לא במטלה</span>
              ))}
              {!s.special && <ReportButton lectureId={lecture.id} section={s.title} />}
              {s.slideStart > 0 && goSlide && (
                <button className="chip slide-link" onClick={() => goSlide(s.slideStart)} title="מעבר לשקפים">
                  <Presentation size={12} /> {s.slideEnd > s.slideStart ? `שקפים ${s.slideStart}–${s.slideEnd}` : `שקף ${s.slideStart}`}
                </button>
              )}
            </div>
            {s.blocks?.map((b, j) => <Block key={j} block={b} />)}
            {s.special === 'takeaways' && (
              <ol className="takeaways">
                {s.items.map((t, j) => <li key={j}><span>{j + 1}</span><div><RichText>{t}</RichText></div></li>)}
              </ol>
            )}
            {s.special === 'formulas' && (
              <div className="glossary">
                {s.items.map((f, j) => (
                  <div key={j} className="formula" style={{ padding: 0 }}>
                    <b>{f.name}</b>
                    <div className="tex"><Tex>{f.latex}</Tex></div>
                    <div className="muted" style={{ fontSize: 14 }}><RichText>{f.explanation}</RichText></div>
                  </div>
                ))}
              </div>
            )}
            {s.special === 'tips' && (
              <div className="note-block nb-important">
                <ul style={{ margin: 0, paddingInlineStart: 20 }}>{s.items.map((t, j) => <li key={j} style={{ margin: '6px 0' }}><RichText>{t}</RichText></li>)}</ul>
              </div>
            )}
          </motion.section>
        ))}
      </article>

      <nav className="notes-toc" aria-label="ניווט בסיכום">
        <h4>בסיכום הזה</h4>
        <TocLinks sections={sections} active={active} go={go} />
      </nav>
    </div>
  );
}

export function Block({ block }) {
  if (block.type === 'text' || !BLOCK[block.type]) {
    return (
      <div className="note-text">
        {block.title && <h3><RichText>{block.title}</RichText></h3>}
        <Markdown>{block.body}</Markdown>
      </div>
    );
  }
  const { label, icon: Icon } = BLOCK[block.type];
  return (
    <div className={`note-block nb-${block.type}`}>
      <div className="nb-head">
        <span className="nb-tag"><Icon size={13} /> {label}</span>
        {block.title && <b><RichText>{block.title}</RichText></b>}
      </div>
      <Markdown>{block.body}</Markdown>
    </div>
  );
}

function TocLinks({ sections, active, go, onPick }) {
  return sections.map((s) => (
    <a key={s.id} href={`#${s.id}`} className={active === s.id ? 'on' : ''} onClick={(e) => { e.preventDefault(); go(s.id); onPick?.(); }}>
      {s.special === 'takeaways' && <ListChecks size={14} />}
      <RichText>{s.title}</RichText>
    </a>
  ));
}

// Narrow screens: the side navigation becomes a sticky dropdown above the summary.
function MobileToc({ sections, active, go }) {
  const [open, setOpen] = useState(false);
  const current = sections.find((s) => s.id === active) || sections[0];
  return (
    <div className="notes-toc-mobile">
      <button className="notes-toc-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="faint">בסיכום הזה:</span>
        <b className="grow">{current ? <RichText>{current.title}</RichText> : ''}</b>
        <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: 'grid' }}><ChevronDown size={17} /></motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="notes-toc-menu" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            <TocLinks sections={sections} active={active} go={go} onPick={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The section whose top has passed just below the sticky top bar. */
export function useActiveSection(sections) {
  const [active, setActive] = useState(sections[0]?.id);
  const frame = useRef(0);
  useEffect(() => {
    const update = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        let current = sections[0]?.id;
        for (const s of sections) {
          const el = document.getElementById(s.id);
          if (el && el.getBoundingClientRect().top <= 140) current = s.id;
        }
        // At the very bottom the last sections may never reach the top: highlight the last one.
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = sections.at(-1)?.id;
        setActive(current);
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      cancelAnimationFrame(frame.current);
    };
  }, [sections]);
  return active;
}
