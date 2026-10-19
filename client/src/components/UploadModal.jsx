import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, X, Check, Loader2, AlertTriangle, FolderInput } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, STAGE_LABELS, STAGE_ORDER } from '../api.js';

const EXT_COLORS = { pdf: '#e5484d', pptx: '#d9711c', ppt: '#d9711c' };

export default function UploadModal() {
  const { uploadOpen, closeUpload, courses, refreshCourses, toast } = useApp();
  const [files, setFiles] = useState(() => window.__droppedFiles || []);
  const [courseId, setCourseId] = useState(uploadOpen?.courseId || 'auto');
  const [lesson, setLesson] = useState('');
  const [kind, setKind] = useState('auto');
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState('pick'); // pick | uploading | tracking
  const [items, setItems] = useState([]);
  const inputRef = useRef();
  const navigate = useNavigate();

  useEffect(() => { window.__droppedFiles = null; }, []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closeUpload();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeUpload]);

  // Poll the created lectures until processing finishes.
  useEffect(() => {
    if (phase !== 'tracking') return;
    const t = setInterval(async () => {
      const next = await Promise.all(items.map((it) => api.get(`/api/lectures/${it.id}`).catch(() => it)));
      setItems(next);
      if (next.every((n) => n.status !== 'processing')) {
        clearInterval(t);
        refreshCourses();
        toast('ההרצאות נוספו לאתר');
      }
    }, 1500);
    return () => clearInterval(t);
  }, [phase, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (list) => setFiles((f) => [...f, ...[...list].filter((x) => /\.(pdf|pptx?|PDF|PPTX?)$/.test(x.name))]);

  async function submit() {
    setPhase('uploading');
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('courseId', courseId);
    if (lesson) fd.append('lessonNumber', lesson);
    if (kind !== 'auto') fd.append('kind', kind);
    try {
      const res = await api.post('/api/upload', fd);
      res.errors.forEach((e) => toast(`${e.name}: ${e.error}`, 'info'));
      setItems(res.created);
      setPhase('tracking');
      refreshCourses();
    } catch (e) {
      toast(e.message, 'info');
      setPhase('pick');
    }
  }

  return (
    <motion.div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && closeUpload()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="modal" role="dialog" aria-modal="true" aria-label="העלאת הרצאה" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
        <div className="row">
          <h2 className="grow">העלאת הרצאות</h2>
          <button className="btn sm icon ghost" onClick={closeUpload} aria-label="סגירה"><X size={18} /></button>
        </div>

        {phase === 'pick' && (
          <>
            <div
              className={`dropzone ${over ? 'over' : ''}`}
              onClick={() => inputRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); addFiles(e.dataTransfer.files); }}
            >
              <motion.div animate={over ? { y: -6, scale: 1.1 } : { y: 0, scale: 1 }} style={{ display: 'inline-grid' }}>
                <UploadCloud size={40} color="var(--c)" />
              </motion.div>
              <div style={{ fontWeight: 700, marginTop: 8 }}>גררו לכאן מצגות או לחצו לבחירה</div>
              <div className="faint" style={{ fontSize: 13.5 }}>PDF או PowerPoint · אפשר כמה קבצים יחד</div>
              <input ref={inputRef} type="file" multiple accept=".pdf,.pptx,.ppt" hidden onChange={(e) => addFiles(e.target.files)} />
            </div>

            <div className="stack" style={{ marginTop: 14, gap: 8 }}>
              <AnimatePresence initial={false}>
                {files.map((f, i) => {
                  const ext = f.name.split('.').pop().toLowerCase();
                  return (
                    <motion.div key={f.name + i} className="file-row" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      <div className="file-ext" style={{ background: EXT_COLORS[ext] || '#666' }}>{ext.toUpperCase()}</div>
                      <div className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                      <span className="faint num" style={{ fontSize: 12 }}>{(f.size / 1048576).toFixed(1)}MB</span>
                      <button className="btn sm icon ghost" aria-label="הסרת הקובץ" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={15} /></button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            <div className="row" style={{ marginTop: 16, alignItems: 'flex-end' }}>
              <label className="field grow">
                קורס
                <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                  <option value="auto">✨ זיהוי אוטומטי לפי התוכן</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="field" style={{ width: 170 }}>
                סוג
                <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="auto">✨ לפי שם הקובץ</option>
                  <option value="lecture">הרצאה</option>
                  <option value="tutorial">תרגול</option>
                  <option value="homework">שיעורי בית / תרגילים</option>
                  <option value="exam">מבחן קודם</option>
                </select>
              </label>
              <label className="field" style={{ width: 110 }}>
                מספר
                <input className="input" type="number" min="1" placeholder="אוטומטי" value={lesson} onChange={(e) => setLesson(e.target.value)} />
              </label>
            </div>

            <div className="row" style={{ marginTop: 20 }}>
              <div className="faint row" style={{ fontSize: 12.5, gap: 6 }}>
                <FolderInput size={15} /> אפשר גם פשוט לשמור קבצים בתיקייה <code className="num">inbox/</code> בפרויקט
              </div>
              <div className="spacer" />
              <button className="btn" onClick={closeUpload}>ביטול</button>
              <button className="btn accent" disabled={!files.length} onClick={submit}>העלאה ועיבוד</button>
            </div>
          </>
        )}

        {phase === 'uploading' && (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <Loader2 size={34} className="spin" color="var(--c)" />
            <p className="muted">מעלה {files.length} קבצים…</p>
          </div>
        )}

        {phase === 'tracking' && (
          <div className="stack" style={{ marginTop: 18 }}>
            <p className="muted" style={{ margin: 0 }}>
              הקבצים בעיבוד: המרה לשקפים, חילוץ טקסט וכתיבת סיכום, נושאים ושאלות תרגול. ניתוח AI לוקח בדרך כלל 2–5 דקות להרצאה – אפשר לסגור את החלון, זה ממשיך ברקע.
            </p>
            {items.map((it) => {
              const idx = STAGE_ORDER.indexOf(it.stage);
              const course = courses.find((c) => c.id === it.courseId);
              return (
                <div key={it.id} className="card pad" style={{ padding: 16 }} data-color={course?.color}>
                  <div className="row">
                    <div className="grow" style={{ fontWeight: 700 }}>{it.title}</div>
                    {course && <span className="chip c">{course.short}</span>}
                  </div>
                  <div className="row" style={{ marginTop: 10, gap: 6 }}>
                    {STAGE_ORDER.slice(0, -1).map((s, i) => (
                      <div key={s} style={{ flex: 1 }}>
                        <div style={{ height: 5, borderRadius: 5, background: i < idx || it.status === 'ready' ? 'var(--c)' : i === idx ? 'color-mix(in srgb, var(--c) 45%, transparent)' : 'var(--surface-3)', transition: 'background .4s' }} />
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ marginTop: 8, fontSize: 13 }}>
                    {it.status === 'ready' ? <Check size={15} color="var(--good)" /> : it.status === 'error' ? <AlertTriangle size={15} color="var(--bad)" /> : <Loader2 size={15} className="spin" />}
                    <span className="muted grow">{it.status === 'error' ? it.error : STAGE_LABELS[it.stage]}</span>
                    {it.status === 'ready' && <button className="btn sm" onClick={() => { closeUpload(); navigate(`/lecture/${it.id}`); }}>פתיחה</button>}
                  </div>
                </div>
              );
            })}
            <div className="row">
              <div className="spacer" />
              <button className="btn" onClick={closeUpload}>סגירה</button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
