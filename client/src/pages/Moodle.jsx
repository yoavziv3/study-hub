import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { RefreshCw, Link2, LogOut, ChevronDown, Check, X, Download, EyeOff, Loader2, ShieldCheck, KeyRound, AlertTriangle, GraduationCap } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, useFetch } from '../api.js';
import { Page, fadeUp } from '../components/ui.jsx';

const ago = (iso) => {
  if (!iso) return 'עוד לא';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'הרגע';
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.round(m / 60);
  return h < 24 ? `לפני ${h} שע׳` : new Date(iso).toLocaleDateString('he-IL');
};

const STATUS = {
  imported: { label: 'באתר', cls: 'good' },
  'not-lecture': { label: 'לא מיובא אוטומטית', cls: '' },
  ignored: { label: 'הוסתר', cls: '' },
};

function ConnectForm({ onConnected }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', token: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = mode === 'login' ? { username: form.username, password: form.password } : { token: form.token };
      onConnected(await api.post('/api/moodle/connect', body));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setForm((f) => ({ ...f, password: '' }));
    }
  };
  return (
    <motion.form className="card pad" style={{ maxWidth: 560, padding: 28 }} onSubmit={submit} variants={fadeUp} initial="hidden" animate="show">
      <div className="row" style={{ marginBottom: 6 }}>
        <div className="course-icon" style={{ background: 'linear-gradient(135deg,#f98012,#ffb547)' }}><GraduationCap size={22} /></div>
        <div>
          <h2 style={{ fontSize: 22 }}>חיבור למודל של בן-גוריון</h2>
          <div className="faint" style={{ fontSize: 13 }}>moodle.bgu.ac.il</div>
        </div>
      </div>
      <p className="muted">אחרי החיבור האתר ייכנס למודל באופן קבוע, ימצא מצגות הרצאה חדשות בקורסים שלך ויוסיף אותן לאתר עם סיכום, נושאים ושאלות.</p>

      <div className="tabs" style={{ margin: '6px 0 16px' }}>
        {[['login', 'שם משתמש וסיסמה'], ['token', 'מפתח גישה']].map(([id, label]) => (
          <button type="button" key={id} className={`tab ${mode === id ? 'active' : ''}`} onClick={() => setMode(id)}>
            {mode === id && <motion.span layoutId="moodle-mode" className="tab-bg" />}
            {label}
          </button>
        ))}
      </div>

      {mode === 'login' ? (
        <div className="stack">
          <label className="field">שם משתמש BGU<input className="input" autoComplete="username" dir="ltr" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label className="field">סיסמה<input className="input" type="password" autoComplete="current-password" dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        </div>
      ) : (
        <div className="stack">
          <label className="field">מפתח (Moodle mobile web service)<input className="input num" dir="ltr" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} /></label>
          <div className="faint" style={{ fontSize: 13 }}>במודל: תמונת הפרופיל ← העדפות ← מפתחות אבטחה, והעתקת המפתח של "Moodle mobile web service".</div>
        </div>
      )}

      <div className="callout row" style={{ marginTop: 16, alignItems: 'flex-start', fontSize: 13.5 }}>
        <ShieldCheck size={18} style={{ flex: 'none', marginTop: 2 }} />
        <span>הסיסמה נשלחת פעם אחת ישירות למודל כדי לקבל מפתח גישה (כמו באפליקציית מודל בטלפון), ולא נשמרת בשום מקום. נשמר רק המפתח, במחשב שלך בלבד.</span>
      </div>
      {error && <div className="chip bad" style={{ height: 'auto', padding: '8px 12px', marginTop: 12, whiteSpace: 'normal' }}><AlertTriangle size={14} /> {error}</div>}
      <button className="btn accent" style={{ marginTop: 18, width: '100%', height: 46 }} disabled={busy || (mode === 'login' ? !form.username || !form.password : !form.token)}>
        {busy ? <Loader2 size={17} className="spin" /> : <Link2 size={17} />} {busy ? 'מתחבר…' : 'התחברות'}
      </button>
    </motion.form>
  );
}

function CourseFiles({ moodleId, onChanged }) {
  const { toast } = useApp();
  const { data: files, reload, error } = useFetch(`/api/moodle/courses/${moodleId}/files`);
  const [busy, setBusy] = useState(null);
  const act = async (f, action) => {
    setBusy(f.key);
    try {
      if (action === 'import') {
        await api.post('/api/moodle/import', { moodleId, key: f.key });
        toast(`${f.filename} נוסף לאתר`);
      } else await api.post('/api/moodle/ignore', { key: f.key });
      await reload();
      onChanged();
    } catch (e) {
      toast(e.message, 'info');
    } finally {
      setBusy(null);
    }
  };
  if (error) return <div className="chip bad" style={{ margin: 12 }}>{error}</div>;
  if (!files) return <div style={{ padding: 18, textAlign: 'center' }}><Loader2 className="spin" size={18} /></div>;
  if (!files.length) return <p className="muted" style={{ padding: '6px 16px' }}>אין בקורס הזה קבצי PDF או PowerPoint.</p>;
  return (
    <div className="stack" style={{ gap: 6, padding: '4px 14px 14px' }}>
      {files.map((f) => {
        const KIND_LABEL = { lecture: 'הרצאה', tutorial: 'תרגול', homework: 'שיעורי בית' };
        const st = f.record?.status === 'imported' ? STATUS.imported : f.record?.status === 'ignored' ? STATUS.ignored : f.kind ? { label: 'חדש – ייובא בסנכרון', cls: 'warn' } : { label: 'לא מיובא אוטומטית', cls: '' };
        const inSite = f.record?.status === 'imported';
        return (
          <div key={f.key} className="file-row" style={{ background: 'var(--surface-2)' }}>
            <div className="file-ext" style={{ background: /\.pdf$/i.test(f.filename) ? '#e5484d' : '#d9711c' }}>{f.filename.split('.').pop().toUpperCase()}</div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</div>
              <div className="faint" style={{ fontSize: 12 }}>{[f.section, f.module].filter(Boolean).join(' · ')}</div>
            </div>
            <span className={`chip ${st.cls}`}>{st.label}</span>
            {inSite && f.record.lectureId && <Link className="btn sm" to={`/lecture/${f.record.lectureId}`}>פתיחה</Link>}
            {!inSite && (
              <button className="btn sm" disabled={busy === f.key} onClick={() => act(f, 'import')} title="הוספה לאתר">
                {busy === f.key ? <Loader2 size={14} className="spin" /> : <Download size={14} />} הוספה
              </button>
            )}
            {f.kind && <span className="chip c">{KIND_LABEL[f.kind]}</span>}
            {!inSite && f.record?.status !== 'ignored' && f.kind && (
              <button className="btn sm icon ghost" title="לא לייבא את הקובץ הזה" onClick={() => act(f, 'ignore')}><EyeOff size={14} /></button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Weekly backup of student accounts from the cloud (kept on this Mac). */
function BackupRow() {
  const { toast } = useApp();
  const { data, reload } = useFetch('/api/backup');
  const [busy, setBusy] = useState(false);
  if (!data?.enabled) return null;
  const now = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/backup');
      toast(`גובו ${r.users} חשבונות`);
      reload();
    } catch (e) {
      toast(e.message, 'info');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card pad row wrap" style={{ marginTop: 14, gap: 10, padding: '14px 18px' }}>
      <span className="grow muted" style={{ fontSize: 14 }}>
        גיבוי חשבונות הסטודנטים: {data.last ? `אחרון ${ago(data.last)}` : 'עוד לא בוצע'} · נשמר במחשב הזה, אוטומטית פעם בשבוע
      </span>
      <button className="btn sm" onClick={now} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} גיבוי עכשיו</button>
    </div>
  );
}

export default function Moodle() {
  const { courses: siteCourses, toast, refreshCourses, setContext } = useApp();
  const { data: status, setData, reload } = useFetch('/api/moodle', { poll: (d) => d.syncing });
  const [open, setOpen] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { setContext({}); }, [setContext]);

  if (!status) return <Page><div style={{ padding: 60, textAlign: 'center' }}><Loader2 className="spin" /></div></Page>;
  if (!status.connected) {
    return (
      <Page>
        <div style={{ marginTop: 16 }}>
          <ConnectForm onConnected={(s) => { setData(s); refreshCourses(); toast('מחובר למודל – הסנכרון הראשון התחיל'); }} />
        </div>
      </Page>
    );
  }

  const syncNow = async () => {
    setData({ ...status, syncing: true });
    try {
      const { result } = await api.post('/api/moodle/sync');
      toast(result.imported.length ? `נוספו ${result.imported.length} הרצאות חדשות` : 'אין הרצאות חדשות במודל');
    } catch (e) {
      toast(e.message, 'info');
    }
    reload();
    refreshCourses();
  };
  const map = async (moodleId, siteCourseId) => {
    setData(await api.put('/api/moodle/map', { moodleId, siteCourseId: siteCourseId || null }));
    refreshCourses();
  };
  const options = async (patch) => setData(await api.put('/api/moodle/options', patch));
  const disconnect = async () => {
    if (!confirm('לנתק את החיבור למודל? ההרצאות שכבר נוספו יישארו באתר.')) return;
    setData(await api.post('/api/moodle/disconnect'));
  };

  const r = status.lastResult;
  const courses = showAll ? status.courses : status.courses.filter((c) => c.current || c.siteCourse);

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon" style={{ background: 'linear-gradient(135deg,#f98012,#ffb547)' }}><GraduationCap size={22} /></div>
          <div className="grow">
            <h2 style={{ fontSize: 22 }}>מחובר למודל</h2>
            <div className="muted" style={{ fontSize: 14 }}>{status.user?.fullname} · סנכרון אחרון: {ago(status.lastSync)}</div>
          </div>
          <label className="row" style={{ fontSize: 14, fontWeight: 600, gap: 8 }}>
            <input type="checkbox" checked={status.autoSync} onChange={(e) => options({ autoSync: e.target.checked })} />
            סנכרון אוטומטי כל
            <select className="input" style={{ width: 'auto', height: 34 }} value={status.intervalMin} onChange={(e) => options({ intervalMin: Number(e.target.value) })}>
              {[15, 30, 60, 180, 720].map((m) => <option key={m} value={m}>{m < 60 ? `${m} דק׳` : `${m / 60} שע׳`}</option>)}
            </select>
          </label>
          <button className="btn accent" onClick={syncNow} disabled={status.syncing}>
            <RefreshCw size={16} className={status.syncing ? 'spin' : ''} /> {status.syncing ? 'מסנכרן…' : 'סנכרון עכשיו'}
          </button>
          <button className="btn icon ghost" title="ניתוק" onClick={disconnect}><LogOut size={17} /></button>
        </div>
        {r && (r.imported.length > 0 || r.updated.length > 0 || r.errors.length > 0) && (
          <div className="stack" style={{ gap: 6, marginTop: 14 }}>
            {r.imported.map((x) => <div key={x} className="chip good" style={{ height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}><Check size={13} /> נוסף: {x}</div>)}
            {r.updated.map((x) => <div key={x} className="chip c" style={{ height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}><RefreshCw size={13} /> עודכן: {x}</div>)}
            {r.errors.map((x) => <div key={x} className="chip bad" style={{ height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}><X size={13} /> {x}</div>)}
          </div>
        )}
      </motion.div>

      {status.health?.problems?.length > 0 && (
        <div className="card pad health-box">
          <div className="row" style={{ gap: 8, marginBottom: 8 }}><AlertTriangle size={18} /> <b>צריך תשומת לב</b></div>
          <ul>{status.health.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          {status.health.problems.some((p) => p.includes('סיכום AI')) && (
            <button className="btn sm accent" onClick={async () => {
              try {
                const r = await api.post('/api/maintenance/retry-ai');
                toast(r.queued ? `${r.queued} פריטים נכנסו שוב לתור הסיכומים` : 'אין מה לנסות שוב');
                reload();
              } catch (e) { toast(e.message, 'info'); }
            }}><RefreshCw size={14} /> לנסות שוב ליצור את הסיכומים</button>
          )}
        </div>
      )}

      <BackupRow />

      <div className="section-title">
        <h2>הקורסים שלך במודל</h2>
        <div className="line" />
        <button className="btn sm ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? 'רק הסמסטר הנוכחי' : 'הצגת כל הקורסים'}</button>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>לכל קורס במודל בחרו לאיזה קורס באתר הוא שייך. רק קורסים משויכים מסונכרנים. הרצאות, תרגולים ושיעורי בית / תרגילים (כולל פתרונות) נוספים אוטומטית, כל אחד לסקשן שלו. סילבוס ומבחנים לא נוספים אוטומטית, אבל אפשר להוסיף כל קובץ ידנית.</p>

      <div className="stack" style={{ gap: 10 }}>
        {courses.map((c, i) => {
          const site = siteCourses.find((s) => s.id === c.siteCourse);
          return (
            <motion.div key={c.id} className="card" data-color={site?.color} variants={fadeUp} initial="hidden" animate="show" custom={i}>
              <div className="row wrap" style={{ padding: '14px 16px' }}>
                <div className="grow" style={{ minWidth: 200 }}>
                  <div style={{ fontWeight: 700 }}>{c.fullname}</div>
                  <div className="faint num" style={{ fontSize: 12, textAlign: 'start' }}>{c.shortname}</div>
                </div>
                {!c.current && <span className="chip">סמסטר קודם</span>}
                <select className="input" style={{ width: 220, height: 38, borderColor: site ? 'var(--c)' : undefined }} value={c.siteCourse || ''} onChange={(e) => map(c.id, e.target.value)}>
                  <option value="">— לא לסנכרן —</option>
                  {siteCourses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {c.siteCourse && (
                  <button className="btn sm" onClick={() => setOpen(open === c.id ? null : c.id)}>
                    קבצים <motion.span animate={{ rotate: open === c.id ? 180 : 0 }} style={{ display: 'grid' }}><ChevronDown size={15} /></motion.span>
                  </button>
                )}
              </div>
              <AnimatePresence>
                {open === c.id && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                    <CourseFiles moodleId={c.id} onChanged={() => { reload(); refreshCourses(); }} />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
        {!courses.length && <div className="empty"><h3>לא נמצאו קורסים</h3></div>}
      </div>
      <div className="faint row" style={{ fontSize: 12.5, marginTop: 18, gap: 6 }}><KeyRound size={14} /> הסנכרון רץ כל עוד האתר פועל במחשב.</div>
    </Page>
  );
}
