import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { FolderUp, UploadCloud, X, Trash2, Check, Loader2, ShieldCheck, Pencil, Eye, ArrowRightLeft, Users } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, STATIC, useFetch } from '../api.js';
import { CourseIcon, Page, Tabs, fadeUp } from '../components/ui.jsx';
import { ACCEPT, KIND_LABEL, KINDS, extOf, formatSize, isAllowed, uploadPersonalFile, forgetPersonalFile } from '../lib/personalFiles.js';

const EXT_COLORS = { pdf: '#e5484d', pptx: '#d9711c', ppt: '#d9711c', docx: '#2f6fdb', doc: '#2f6fdb' };
const baseName = (n) => n.replace(/\.[^.]+$/, '');

/** Add your own lectures and tutorials: pick a course, then lectures or tutorials. They stay private and get no AI. */
export default function Files() {
  const { setContext, toast } = useApp();
  const [search, setSearch] = useSearchParams();
  const { data, reload } = useFetch(STATIC ? '/api/me/files' : null);
  const { data: courseData } = useFetch(STATIC ? '/api/me/files/courses' : null);
  useEffect(() => { setContext({}); }, [setContext]);

  const courses = courseData?.courses || [];
  const mine = courses.filter((c) => c.enrolled);
  const others = courses.filter((c) => !c.enrolled);
  const courseId = search.get('course') || mine[0]?.id || '';
  const kind = KINDS.includes(search.get('kind')) ? search.get('kind') : 'lecture';
  const course = courses.find((c) => c.id === courseId);
  const files = data?.files || [];
  const here = files.filter((f) => f.courseId === courseId);
  const shown = here.filter((f) => f.kind === kind);
  const set = (patch) => setSearch({ course: courseId, kind, ...patch }, { replace: true });

  const [queue, setQueue] = useState([]); // { key, file, title, progress, error }
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef();

  if (!STATIC) {
    return (
      <Page>
        <div className="empty"><div className="empty-icon"><FolderUp size={28} /></div><h2>העלאה אישית זמינה באתר שבענן</h2><p>בגרסה שרצה על המחשב מעלים הרצאות דרך כפתור "העלאה" בעמוד הקורס.</p></div>
      </Page>
    );
  }

  const add = (list) => {
    const picked = [...list];
    const bad = picked.filter((f) => !isAllowed(f.name));
    if (bad.length) toast('אפשר להעלות רק PDF, PowerPoint או Word', 'info');
    setQueue((q) => [...q, ...picked.filter((f) => isAllowed(f.name)).map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, title: baseName(file.name), progress: 0 }))]);
  };
  const patchItem = (key, patch) => setQueue((q) => q.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function uploadAll() {
    setBusy(true);
    let done = 0;
    for (const item of queue) {
      if (item.done) continue;
      patchItem(item.key, { error: null });
      try {
        await uploadPersonalFile(item.file, { courseId, kind, title: item.title }, (p) => patchItem(item.key, { progress: p }));
        patchItem(item.key, { progress: 1, done: true });
        done++;
      } catch (e) {
        patchItem(item.key, { error: e.message });
      }
    }
    setBusy(false);
    await reload();
    if (done) toast(done === 1 ? 'הקובץ נוסף' : `${done} קבצים נוספו`);
    setQueue((q) => q.filter((i) => !i.done));
  }

  const remove = async (f) => {
    if (!confirm(`למחוק את "${f.title}"?`)) return;
    try {
      await api.del(`/api/me/files/${f.id}`);
      forgetPersonalFile(f.id);
      await reload();
      toast('הקובץ נמחק');
    } catch (e) { toast(e.message, 'info'); }
  };
  const patch = async (f, body) => {
    try {
      await api.patch(`/api/me/files/${f.id}`, body);
      await reload();
    } catch (e) { toast(e.message, 'info'); }
  };

  const quota = data?.quota;
  const usedPct = quota ? Math.min(100, Math.round((quota.used / quota.max) * 100)) : 0;
  const tabs = KINDS.map((k) => ({ id: k, label: KIND_LABEL[k], count: here.filter((f) => f.kind === k).length || null }));

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon"><FolderUp size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>הקבצים שלי</h1>
            <div className="muted" style={{ fontSize: 14 }}>הרצאות ותרגולים שיש לכם ולא עלו למודל, או מקורסים שאתם לא רשומים אליהם. בוחרים קורס, ואז אם זו הרצאה או תרגול.</div>
          </div>
        </div>
        <div className="callout row" style={{ marginTop: 14, gap: 10 }}>
          <ShieldCheck size={17} />
          <span>הקבצים פרטיים: רק אתם רואים אותם, והם לא מוצגים לאף סטודנט אחר. אין עליהם סיכומים, שאלות או כרטיסיות – את אלה האתר בונה רק לחומר שעולה מהמודל.</span>
        </div>
      </motion.div>

      {!courses.length ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Loader2 className="spin" /></div>
      ) : (
        <>
          <div className="label-sm" style={{ margin: '22px 0 8px', fontWeight: 700 }}>1. בחירת קורס</div>
          <div className="files-courses">
            {mine.map((c) => <CourseButton key={c.id} c={c} on={c.id === courseId} count={files.filter((f) => f.courseId === c.id).length} onClick={() => set({ course: c.id })} />)}
          </div>
          {others.length > 0 && (
            <details className="files-others" open={others.some((c) => c.id === courseId)}>
              <summary><Users size={14} /> קורסים אחרים באתר ({others.length})</summary>
              <div className="files-courses" style={{ marginTop: 8 }}>
                {others.map((c) => <CourseButton key={c.id} c={c} on={c.id === courseId} count={files.filter((f) => f.courseId === c.id).length} onClick={() => set({ course: c.id })} />)}
              </div>
            </details>
          )}

          {course && (
            <div data-color={course.color}>
              <div className="label-sm" style={{ margin: '22px 0 8px', fontWeight: 700 }}>2. מה מעלים ל{course.short || course.name}</div>
              <Tabs tabs={tabs} value={kind} onChange={(k) => set({ kind: k })} layoutId="files-kind" />

              <div
                className={`dropzone ${over ? 'over' : ''}`}
                onClick={() => input.current.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
              >
                <UploadCloud size={36} color="var(--c)" />
                <div style={{ fontWeight: 700, marginTop: 6 }}>גררו לכאן קבצים או לחצו לבחירה – יישמרו כ{kind === 'lecture' ? 'הרצאות' : 'תרגולים'}</div>
                <div className="faint" style={{ fontSize: 13.5 }}>PDF, PowerPoint או Word · עד {formatSize(quota?.maxFile || 0)} לקובץ</div>
                <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
              </div>

              <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                <AnimatePresence initial={false}>
                  {queue.map((i) => (
                    <motion.div key={i.key} className="file-row" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      <div className="file-ext" style={{ background: EXT_COLORS[extOf(i.file.name)] || '#666' }}>{extOf(i.file.name).toUpperCase()}</div>
                      <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
                        <input className="input" style={{ height: 34 }} value={i.title} maxLength={120} disabled={busy} aria-label="שם הקובץ" onChange={(e) => patchItem(i.key, { title: e.target.value })} />
                        {i.error && <span style={{ fontSize: 12.5, color: 'var(--bad)' }}>{i.error}</span>}
                        {busy && !i.error && <div className="bar" style={{ height: 4 }}><span style={{ width: `${Math.round(i.progress * 100)}%` }} /></div>}
                      </div>
                      <span className="faint num" style={{ fontSize: 12 }}>{formatSize(i.file.size)}</span>
                      <button className="btn sm icon ghost" aria-label="הסרה מהרשימה" disabled={busy} onClick={() => setQueue((q) => q.filter((x) => x.key !== i.key))}><X size={15} /></button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              {queue.length > 0 && (
                <div className="row" style={{ marginTop: 12 }}>
                  <div className="spacer" />
                  <button className="btn accent" disabled={busy || queue.some((i) => !i.title.trim())} onClick={uploadAll}>
                    {busy ? <><Loader2 size={15} className="spin" /> מעלה…</> : `העלאה (${queue.length})`}
                  </button>
                </div>
              )}

              <h3 style={{ margin: '26px 0 10px' }}>{KIND_LABEL[kind]} שלי ב{course.short || course.name}</h3>
              {!shown.length ? (
                <div className="faint" style={{ fontSize: 14 }}>עוד לא העליתם {KIND_LABEL[kind]} לקורס הזה.</div>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  {shown.map((f) => <FileRow key={f.id} f={f} onRemove={() => remove(f)} onPatch={(b) => patch(f, b)} />)}
                </div>
              )}
            </div>
          )}

          {quota && (
            <div className="faint" style={{ marginTop: 26, fontSize: 12.5 }}>
              <div className="bar" style={{ height: 5, maxWidth: 260 }}><span style={{ width: `${usedPct}%` }} /></div>
              <div style={{ marginTop: 4 }}>מקום פנוי: {formatSize(quota.max - quota.used)} מתוך {formatSize(quota.max)}</div>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function CourseButton({ c, on, count, onClick }) {
  return (
    <button className={`files-course ${on ? 'on' : ''}`} data-color={c.color} onClick={onClick} aria-pressed={on}>
      <span className="course-icon" style={{ width: 34, height: 34, borderRadius: 10 }}><CourseIcon name={c.icon} size={17} /></span>
      <span className="grow" style={{ textAlign: 'start' }}>{c.short || c.name}</span>
      {count > 0 && <span className="chip">{count}</span>}
    </button>
  );
}

function FileRow({ f, onRemove, onPatch }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(f.title);
  const other = f.kind === 'lecture' ? 'tutorial' : 'lecture';
  const save = () => {
    setEditing(false);
    if (title.trim() && title.trim() !== f.title) onPatch({ title: title.trim() });
    else setTitle(f.title);
  };
  return (
    <div className="file-row">
      <div className="file-ext" style={{ background: EXT_COLORS[extOf(f.name)] || '#666' }}>{extOf(f.name).toUpperCase()}</div>
      <div className="grow" style={{ minWidth: 0 }}>
        {editing ? (
          <input className="input" style={{ height: 34 }} value={title} autoFocus maxLength={120} onChange={(e) => setTitle(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} aria-label="שם הקובץ" />
        ) : (
          <Link to={`/file/${f.id}`} style={{ fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</Link>
        )}
        <div className="faint" style={{ fontSize: 12 }}>{formatSize(f.size)} · {new Date(f.createdAt).toLocaleDateString('he-IL')}</div>
      </div>
      <Link className="btn sm icon ghost" to={`/file/${f.id}`} aria-label="פתיחה" title="פתיחה"><Eye size={15} /></Link>
      <button className="btn sm icon ghost" onClick={() => setEditing(true)} aria-label="שינוי שם" title="שינוי שם"><Pencil size={15} /></button>
      <button className="btn sm icon ghost" onClick={() => onPatch({ kind: other })} aria-label={`העברה ל${KIND_LABEL[other]}`} title={`העברה ל${KIND_LABEL[other]}`}><ArrowRightLeft size={15} /></button>
      <button className="btn sm icon ghost danger" onClick={onRemove} aria-label="מחיקה" title="מחיקה"><Trash2 size={15} /></button>
    </div>
  );
}
