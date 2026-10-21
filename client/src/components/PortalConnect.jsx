import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Building2, RefreshCw, Loader2, ShieldCheck, Unplug, BellRing } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';

const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'עכשיו' : m < 60 ? `לפני ${m} דק׳` : m < 1440 ? `לפני ${Math.round(m / 60)} שע׳` : new Date(iso).toLocaleDateString('he-IL');
};

/**
 * Cloud: connect the BGU portal so room changes and cancellations come from the student's own portal schedule.
 * The sign-in is sent once to the site's server, checked with the portal, and kept there encrypted.
 */
export default function PortalConnect({ status, onChange }) {
  const { me, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: me?.user?.username || '', password: '', id: '' });

  const run = (fn) => async (e) => {
    e?.preventDefault?.();
    setBusy(true);
    try { await fn(); } catch (err) { toast(err.message, 'info'); } finally { setBusy(false); }
  };
  const connect = run(async () => {
    const r = await api.post('/api/portal/connect', form);
    setForm((f) => ({ ...f, password: '', id: '' }));
    setOpen(false);
    onChange(r);
    toast(r.error ? `מחובר לפורטל, אבל: ${r.error}` : 'הפורטל מחובר – מערכת השעות מתעדכנת ממנו');
  });
  const sync = run(async () => onChange(await api.post('/api/portal/sync', {})));
  const disconnect = run(async () => {
    if (!confirm('לנתק את הפורטל? פרטי ההתחברות יימחקו מהאתר.')) return;
    onChange(await api.del('/api/portal'));
    toast('הפורטל נותק ופרטי ההתחברות נמחקו');
  });

  const connected = status?.connected;
  const notices = (status?.lessons || []).flatMap((l) => (l.notifications || []).map((n) => ({ ...n, lesson: l.name })));
  return (
    <div className="card pad portal-card">
      <div className="row wrap" style={{ gap: 10 }}>
        <Building2 size={18} />
        <b className="grow">הפורטל הבן־גוריוני</b>
        {connected ? (
          <>
            <span className={`chip ${status.ok ? 'good' : 'warn'}`}>{status.ok ? `מחובר · עודכן ${status.syncedAt ? ago(status.syncedAt) : '—'}` : 'צריך להתחבר שוב'}</span>
            {status.ok && <button className="btn sm" onClick={sync} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''} /> רענון</button>}
            {!status.ok && <button className="btn sm accent" onClick={() => setOpen(true)}>התחברות מחדש</button>}
            <button className="btn sm ghost" onClick={disconnect} disabled={busy}><Unplug size={14} /> ניתוק</button>
          </>
        ) : (
          !open && <button className="btn sm accent" onClick={() => setOpen(true)}>חיבור הפורטל</button>
        )}
      </div>
      <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>
        {connected
          ? status.error || 'החדרים, הביטולים וההודעות על השיעורים נלקחים מהמערכת שלך בפורטל, וההתראות לטלפון לפיה.'
          : 'שינויי חדרים וביטולים מתפרסמים בפורטל לפני שהם מגיעים לקובץ הקורסים. חברו אותו, והמערכת וההתראות יתעדכנו ממנו.'}
      </div>

      <AnimatePresence>
        {open && (
          <motion.form className="portal-form" onSubmit={connect} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="callout row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <ShieldCheck size={16} style={{ flex: 'none', marginTop: 3 }} />
              <span style={{ fontSize: 13.5 }}>
                לפורטל אין מפתח גישה כמו למודל, אז כדי לבדוק שינויים לבד האתר שומר את פרטי ההתחברות – <b>מוצפנים</b>, רק בשרת, ורק כדי להתחבר שוב לפורטל כשהחיבור פג.
                התחברות שנכשלת לא מנוסה שוב אוטומטית. ניתוק (או מחיקת החשבון) מוחק אותם לגמרי.
              </span>
            </div>
            <div className="portal-fields">
              <label><span>שם משתמש</span><input className="input" dir="ltr" autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
              <label><span>סיסמה</span><input className="input" dir="ltr" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
              <label><span>תעודת זהות</span><input className="input" dir="ltr" inputMode="numeric" autoComplete="off" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} required /></label>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn accent sm" type="submit" disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : null} התחברות</button>
              <button className="btn ghost sm" type="button" onClick={() => setOpen(false)}>ביטול</button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {connected && notices.length > 0 && (
        <div className="portal-notices">
          <div className="row" style={{ gap: 6, fontWeight: 700, fontSize: 14 }}><BellRing size={14} /> הודעות על השיעורים שלך</div>
          {notices.map((n, i) => (
            <div key={i} className="portal-notice">
              <div><b>{n.lesson}</b>{n.date && <span className="faint"> · {new Date(n.date).toLocaleDateString('he-IL')}</span>}</div>
              {n.title && <div>{n.title}</div>}
              {n.content && <div className="faint">{n.content}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
