import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Presentation, FileText, ListTree, Target, Layers, BookMarked, NotebookPen, Check, Sparkles, MoreHorizontal,
  RefreshCw, Trash2, Pencil, Loader2, AlertTriangle, ChevronLeft, Wand2, Eye, Download,
} from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, useFetch, originalUrl, STAGE_LABELS, STAGE_ORDER } from '../api.js';
import { Page, Tabs, fadeUp } from '../components/ui.jsx';
import { Markdown } from '../components/markdown.jsx';
import SlideViewer from '../components/SlideViewer.jsx';
import Quiz from '../components/Quiz.jsx';
import StudySummary from '../components/StudySummary.jsx';
import { AssignmentBox } from '../components/Assignment.jsx';
import Flashcards from '../components/Flashcards.jsx';
import Glossary from '../components/Glossary.jsx';

function Processing({ lecture }) {
  const idx = STAGE_ORDER.indexOf(lecture.stage);
  return (
    <div className="card processing">
      {lecture.status === 'error' ? (
        <>
          <AlertTriangle size={36} color="var(--bad)" />
          <h3 style={{ marginTop: 10 }}>העיבוד נכשל</h3>
          <p className="muted">{lecture.error}</p>
        </>
      ) : (
        <>
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }} style={{ display: 'inline-grid' }}>
            <Sparkles size={34} color="var(--c)" />
          </motion.div>
          <h3 style={{ marginTop: 10, fontSize: 22 }}>מכין את ההרצאה…</h3>
          <p className="muted">{STAGE_LABELS[lecture.stage]} – ניתוח AI מלא לוקח בדרך כלל 2–5 דקות.</p>
          <div className="stepper">
            {STAGE_ORDER.map((s, i) => (
              <div key={s} className={`step ${i < idx ? 'done' : i === idx ? 'active' : ''}`}>
                <div className="dot">{i < idx ? <Check size={15} /> : i === idx ? <Loader2 size={15} className="spin" /> : i + 1}</div>
                {STAGE_LABELS[s]}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NoContent({ lecture, onRegenerate }) {
  const { status } = useApp();
  return (
    <div className="empty">
      <div className="empty-icon"><Wand2 size={28} /></div>
      <h2>עוד אין תוכן AI להרצאה הזו</h2>
      {lecture.aiError && <p className="chip warn" style={{ height: 'auto', padding: '6px 12px', whiteSpace: 'normal' }}>{lecture.aiError}</p>}
      <p>{status?.ai?.ready ? 'השקפים כבר זמינים. אפשר ליצור עכשיו סיכום, חלוקה לנושאים, שאלות וכרטיסיות.' : 'חברו AI (Claude Code או מפתח API) כדי ליצור סיכום ושאלות.'}</p>
      {status?.ai?.ready && <button className="local-only btn accent" onClick={onRegenerate}><Sparkles size={16} /> יצירת חומרי לימוד</button>}
    </div>
  );
}

function TopicsTab({ content, goSlide }) {
  const { openChat } = useApp();
  return (
    <div className="topics-grid">
      {content.topics.map((t, i) => (
        <motion.div key={i} className="card topic-card" variants={fadeUp} initial="hidden" animate="show" custom={i}>
          <div className="topic-index">{i + 1}</div>
          <div>
            <div className="row wrap">
              <h3 className="grow">{t.title}</h3>
              <button className="chip c" onClick={() => goSlide(t.slideStart)}><Presentation size={13} /> שקפים {t.slideStart}–{t.slideEnd}</button>
            </div>
            <Markdown className="muted">{t.summary}</Markdown>
            <div className="row wrap" style={{ marginTop: 8 }}>
              <div className="terms grow" style={{ marginTop: 0 }}>
                {t.keyTerms.map((k) => (
                  <button key={k} className="chip" onClick={() => openChat({ prompt: `הסבר לי את המושג "${k}" בהקשר של "${t.title}".`, autoSend: true })}>{k}</button>
                ))}
              </div>
              <button className="local-only btn sm" onClick={() => openChat({ prompt: `בחן אותי על הנושא "${t.title}" – שאלה אחת בכל פעם, ותן משוב על כל תשובה.`, autoSend: true })}>
                <Target size={14} /> בחן אותי על הנושא
              </button>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function PracticeTab({ lecture, goSlide, reload }) {
  const { toast, progress } = useApp();
  const [diff, setDiff] = useState('all');
  const [gen, setGen] = useState(false);
  const [run, setRun] = useState(0);
  const [open, setOpen] = useState({});
  const all = [...(lecture.content.quiz || []), ...(lecture.content.extraQuiz || [])];
  const qs = diff === 'all' ? all : all.filter((q) => q.difficulty === diff);
  const stats = progress.quiz[lecture.id];

  const generate = async () => {
    setGen(true);
    try {
      const r = await api.post('/api/practice', { lectureId: lecture.id, count: 6 });
      toast(`נוספו ${r.quiz.length} שאלות חדשות`);
      await reload();
      setRun((x) => x + 1);
    } catch (e) {
      toast(e.message, 'info');
    } finally {
      setGen(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 26 }}>
      <div className="row wrap" style={{ justifyContent: 'center' }}>
        <div className="tabs">
          {[['all', `הכל (${all.length})`], ['easy', 'קל'], ['medium', 'בינוני'], ['hard', 'קשה']].map(([id, label]) => (
            <button key={id} className={`tab ${diff === id ? 'active' : ''}`} onClick={() => { setDiff(id); setRun((x) => x + 1); }}>
              {diff === id && <motion.span layoutId="diff" className="tab-bg" />}
              {label}
            </button>
          ))}
        </div>
        <button className="local-only btn sm" onClick={generate} disabled={gen}>{gen ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} {gen ? 'יוצר שאלות…' : 'צור 6 שאלות חדשות'}</button>
        {stats && <span className="chip good">דיוק מצטבר: {Math.round((stats.correct / stats.answered) * 100)}% ({stats.answered})</span>}
      </div>
      <Quiz key={run + diff} questions={qs} lectureId={lecture.id} onSlide={goSlide} />

      {lecture.content.openQuestions?.length > 0 && (
        <div style={{ maxWidth: 820, margin: '10px auto 0', width: '100%' }}>
          <div className="section-title" style={{ marginTop: 10 }}><h2>שאלות פתוחות ותרגילים</h2><div className="line" /></div>
          <div className="stack">
            {lecture.content.openQuestions.map((q, i) => (
              <div key={i} className="card pad">
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <span className="topic-index" style={{ width: 34, height: 34, fontSize: 15 }}>{i + 1}</span>
                  <Markdown className="grow">{q.question}</Markdown>
                </div>
                <AnimatePresence initial={false}>
                  {open[i] ? (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                      <div className="explain"><Markdown>{q.answer}</Markdown></div>
                    </motion.div>
                  ) : (
                    <motion.div exit={{ opacity: 0 }} style={{ marginTop: 12 }}>
                      <button className="btn sm" onClick={() => setOpen((o) => ({ ...o, [i]: true }))}><Eye size={14} /> הצגת פתרון</button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotesTab({ lecture }) {
  const { progress, setNote } = useApp();
  const [text, setText] = useState(progress.notes[lecture.id] || '');
  const [saved, setSaved] = useState(true);
  const t = useRef();
  return (
    <div className="card pad" style={{ maxWidth: 900 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <h3 className="grow" style={{ fontSize: 17 }}>ההערות שלי</h3>
        <span className="faint" style={{ fontSize: 12.5 }}>{saved ? 'נשמר ✓' : 'שומר…'}</span>
      </div>
      <textarea
        className="input"
        rows={16}
        value={text}
        placeholder="מה המרצה הדגיש בכיתה? מה לא הבנתי? מה לשאול בתרגול?…"
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
          clearTimeout(t.current);
          t.current = setTimeout(() => { setNote(lecture.id, e.target.value); setSaved(true); }, 700);
        }}
      />
      {text && (
        <>
          <h4 style={{ margin: '20px 0 8px', color: 'var(--text-3)', fontSize: 13 }}>תצוגה</h4>
          <Markdown>{text}</Markdown>
        </>
      )}
    </div>
  );
}

function EditDialog({ lecture, onClose, onSaved }) {
  const { courses } = useApp();
  const [form, setForm] = useState({ title: lecture.title, lessonNumber: lecture.lessonNumber || '', unitNumber: lecture.unitNumber || '', courseId: lecture.courseId, kind: lecture.kind || 'lecture' });
  const save = async () => {
    await api.patch(`/api/lectures/${lecture.id}`, { ...form, lessonNumber: Number(form.lessonNumber) || null, unitNumber: Number(form.unitNumber) || null });
    onSaved();
    onClose();
  };
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="modal" role="dialog" aria-modal="true" aria-label="עריכת פרטים" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <h2>עריכת פרטי ההרצאה</h2>
        <div className="stack" style={{ marginTop: 18 }}>
          <label className="field">כותרת<input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <div className="row">
            <label className="field grow">קורס
              <select className="input" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })}>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="field" style={{ width: 120 }}>מס׳ שיעור<input className="input" type="number" value={form.lessonNumber} onChange={(e) => setForm({ ...form, lessonNumber: e.target.value })} /></label>
            <label className="field" style={{ width: 120 }}>מס׳ יחידה<input className="input" type="number" value={form.unitNumber} onChange={(e) => setForm({ ...form, unitNumber: e.target.value })} /></label>
          </div>
          <div className="row">
            <label className="field grow">סוג
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="lecture">הרצאה</option>
                <option value="tutorial">תרגול</option>
                <option value="homework">שיעורי בית / תרגילים</option>
              </select>
            </label>
          </div>
        </div>
        <div className="row" style={{ marginTop: 22, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn accent" onClick={save}>שמירה</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Lecture() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { setContext, progress, toggleStudied, visit, openChat, toast, refreshCourses } = useApp();
  const { data: lecture, reload, error } = useFetch(`/api/lectures/${id}`, { poll: (d) => d.status === 'processing' || !!d.notesStatus });
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState(false);
  const tab = params.get('tab') || 'slides';
  const slide = Number(params.get('slide')) || progress.slidePos[id] || 1;

  const setTab = (t) => setParams((p) => { p.set('tab', t); return p; }, { replace: true });
  const setSlide = (n) => setParams((p) => { p.set('slide', n); return p; }, { replace: true });
  const goSlide = (n) => setParams((p) => { p.set('tab', 'slides'); p.set('slide', n); return p; });

  useEffect(() => {
    if (lecture?.course) setContext({ courseId: lecture.courseId, lectureId: lecture.id, slide: tab === 'slides' ? slide : null, color: lecture.course.color, label: lecture.title });
  }, [lecture?.id, lecture?.title, slide, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (lecture?.status === 'ready' && tab === 'slides') {
      const t = setTimeout(() => visit(lecture.id, slide), 800);
      return () => clearTimeout(t);
    }
  }, [lecture?.id, lecture?.status, slide, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Page><div className="empty"><h2>{error}</h2><Link className="btn" to="/">לדף הבית</Link></div></Page>;
  if (!lecture) return <Page><div style={{ padding: 60, textAlign: 'center' }}><Loader2 className="spin" /></div></Page>;

  const { course, content } = lecture;
  const studied = !!progress.studied[lecture.id];
  const regenerate = async () => {
    setMenu(false);
    try {
      await api.post(`/api/lectures/${lecture.id}/regenerate`);
      toast('יצירת חומרי הלימוד התחילה');
      reload();
    } catch (e) { toast(e.message, 'info'); }
  };
  const remove = async () => {
    setMenu(false);
    if (!confirm(`למחוק את "${lecture.title}" מהאתר? הפעולה לא הפיכה.`)) return;
    await api.del(`/api/lectures/${lecture.id}`);
    refreshCourses();
    toast('ההרצאה נמחקה');
    navigate(`/course/${lecture.courseId}`);
  };

  const ready = lecture.status === 'ready' || (lecture.slides.length > 0 && lecture.stage === 'analyzing');
  // Courses built for other students have the deck and personal notes only (no AI material);
  // a link to an AI tab of such a course falls back to the slides.
  const noAi = course?.ai === false || lecture.kind === 'exam';
  const view = noAi && tab !== 'slides' && tab !== 'notes' ? 'slides' : tab;
  const tabs = noAi ? [
    { id: 'slides', label: 'מצגת', icon: <Presentation size={16} /> },
    { id: 'notes', label: 'הערות', icon: <NotebookPen size={16} /> },
  ] : [
    { id: 'slides', label: 'מצגת', icon: <Presentation size={16} /> },
    { id: 'summary', label: 'סיכום', icon: <FileText size={16} /> },
    { id: 'topics', label: 'נושאים', icon: <ListTree size={16} />, count: content?.topics?.length },
    { id: 'practice', label: 'תרגול', icon: <Target size={16} />, count: content ? (content.quiz?.length || 0) + (content.extraQuiz?.length || 0) : null },
    { id: 'flashcards', label: 'כרטיסיות', icon: <Layers size={16} />, count: content?.flashcards?.length },
    { id: 'glossary', label: 'מושגים', icon: <BookMarked size={16} />, count: content?.glossary?.length },
    { id: 'notes', label: 'הערות', icon: <NotebookPen size={16} /> },
  ];
  const unitNo = lecture.unitNumber || lecture.lessonNumber;

  return (
    <Page>
      <div data-color={course?.color}>
        <div className="crumbs">
          <Link to="/">לוח בקרה</Link><ChevronLeft size={14} />
          <Link to={`/course/${course?.id}`}>{course?.short}</Link><ChevronLeft size={14} />
          <span>{{ lecture: 'שיעור', tutorial: 'תרגול', homework: 'שיעורי בית', exam: 'מבחן קודם' }[lecture.kind || 'lecture']} {lecture.lessonNumber || '?'}</span>
        </div>
        <div className="lecture-head">
          <motion.div className="unit-badge" initial={{ scale: 0.6, rotate: -15 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}>{unitNo || '•'}</motion.div>
          <div className="grow">
            <div className="faint" style={{ fontSize: 13.5 }}>{course?.name} · {{ lecture: course?.unitLabel, tutorial: 'תרגול', homework: 'שיעורי בית ותרגילים', exam: 'מבחן קודם' }[lecture.kind || 'lecture']} {unitNo}</div>
            <h1>{lecture.title}</h1>
            <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
              <span className="chip">{lecture.slideCount} שקפים</span>
              <span className="chip">{lecture.originalName}</span>
              {content?.generator && <span className="chip c"><Sparkles size={12} /> סוכם ב-AI</span>}
            </div>
          </div>
          <div className="row">
            <motion.button className={`btn ${studied ? 'accent' : ''}`} whileTap={{ scale: 0.94 }} onClick={() => { toggleStudied(lecture.id); if (!studied) toast('סומן כנלמד – כל הכבוד!'); }}>
              <motion.span key={String(studied)} initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ display: 'grid' }}><Check size={17} /></motion.span>
              {studied ? 'נלמד' : 'סימון כנלמד'}
            </motion.button>
            <button className="local-only btn" onClick={() => openChat()}><Sparkles size={16} /> שאלה על ההרצאה</button>
            <div style={{ position: 'relative' }}>
              <button className="btn icon" onClick={() => setMenu((m) => !m)} aria-label="אפשרויות נוספות" aria-expanded={menu} aria-haspopup="menu"><MoreHorizontal size={18} /></button>
              <AnimatePresence>
                {menu && (
                  <motion.div className="card" style={{ position: 'absolute', top: 46, insetInlineEnd: 0, zIndex: 30, padding: 6, width: 220, boxShadow: 'var(--shadow-lg)' }} initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.96 }}>
                    <button className="local-only btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { setMenu(false); setEdit(true); }}><Pencil size={15} /> עריכת פרטים</button>
                    <a className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} href={originalUrl(lecture)} download={lecture.originalName}><Download size={15} /> הורדת המצגת</a>
                    <button className="local-only btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={regenerate}><RefreshCw size={15} /> יצירת סיכום מחדש (AI)</button>
                    <button className="local-only btn ghost sm danger" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={remove}><Trash2 size={15} /> מחיקה</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {lecture.source?.assignment && <div style={{ marginBottom: 18 }}><AssignmentBox assignment={lecture.source.assignment} /></div>}
        {!ready ? (
          <Processing lecture={lecture} />
        ) : (
          <>
            <div style={{ marginBottom: 20 }}><Tabs tabs={tabs} value={view} onChange={setTab} layoutId="lecture-tab" /></div>
            {lecture.status === 'processing' && <div className="callout row" style={{ marginBottom: 16 }}><Loader2 size={16} className="spin" /> הסיכום והשאלות בהכנה – השקפים כבר זמינים.</div>}
            <AnimatePresence mode="wait">
              <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }}>
                {view === 'slides' && <SlideViewer lecture={lecture} slide={Math.min(slide, lecture.slideCount || 1)} setSlide={setSlide} />}
                {view !== 'slides' && view !== 'notes' && !content && !noAi && <NoContent lecture={lecture} onRegenerate={regenerate} />}
                {view === 'summary' && content && <StudySummary lecture={lecture} content={content} goSlide={goSlide} reload={reload} />}
                {view === 'topics' && content && <TopicsTab content={content} goSlide={goSlide} />}
                {view === 'practice' && content && <PracticeTab lecture={lecture} goSlide={goSlide} reload={reload} />}
                {view === 'flashcards' && content && <Flashcards cards={content.flashcards.map((c) => ({ ...c, lectureId: lecture.id }))} />}
                {view === 'glossary' && content && <Glossary terms={content.glossary} />}
                {view === 'notes' && <NotesTab lecture={lecture} />}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>
      <AnimatePresence>{edit && <EditDialog lecture={lecture} onClose={() => setEdit(false)} onSaved={() => { reload(); refreshCourses(); }} />}</AnimatePresence>
    </Page>
  );
}
