import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Building2, RefreshCw, Loader2, ShieldCheck, Unplug, BellRing } from 'lucide-react';
import { useApp } from '../store.jsx';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { NOTICE_KINDS } from '../../../shared/notices.js';

const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'עכשיו' : m < 60 ? `לפני ${m} דק׳` : m < 1440 ? `לפני ${Math.round(m / 60)} שע׳` : new Date(iso).toLocaleDateString('he-IL');
};

// The sign-in is sealed here, in the browser, with the public key of the Mac that reads the portal (the portal only
// answers from Israel). The cloud stores the sealed text but can't open it.
async function seal(publicJwk, creds) {
  const text = new TextEncoder().encode(JSON.stringify(creds));
  if (text.length > 190) throw new Error('שם המשתמש או הסיסמה ארוכים מדי');
  const key = await crypto.subtle.importKey('jwk', publicJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, text));
  return btoa(String.fromCharCode(...sealed));
}

/** Cloud: connect the BGU portal so groups, rooms and cancellations come from the student's own portal schedule. */
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
    if (!status?.key) throw new Error('החיבור לפורטל עוד לא הוגדר באתר');
    const sealed = await seal(JSON.parse(status.key), { username: form.username.trim(), password: form.password, id: form.id.replace(/\D/g, '') });
    const r = await api.post('/api/portal/connect', { username: form.username.trim(), sealed });
    setForm((f) => ({ ...f, password: '', id: '' }));
    setOpen(false);
    onChange(r);
    toast('מתחבר לפורטל – זה לוקח עד דקה או שתיים');
  });
  const sync = run(async () => {
    onChange(await api.post('/api/portal/sync', {}));
    toast('הפורטל ייקרא שוב בדקה הקרובה');
  });

  // While the Mac hasn't read it yet (new link, or "refresh"), check back every few seconds.
  const waiting = status?.pending;
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => api.get('/api/portal').then(onChange).catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps
  const disconnect = run(async () => {
    if (!confirm('לנתק את הפורטל? פרטי ההתחברות יימחקו מהאתר.')) return;
    onChange(await api.del('/api/portal'));
    toast('הפורטל נותק ופרטי ההתחברות נמחקו');
  });

  const connected = status?.connected;
  const notices = (status?.lessons || []).flatMap((l) => (l.notifications || []).map((n) => ({ ...n, lesson: l.name })));
  return (
    <div className="card pad portal-card" style={!connected ? { borderColor: 'var(--c)', background: 'var(--c-soft)' } : undefined}>
      <div className="row wrap" style={{ gap: 10 }}>
        <Building2 size={18} />
        <b className="grow">הפורטל הבן־גוריוני</b>
        {connected ? (
          <>
            <span className={`chip ${status.ok && !status.pending ? 'good' : 'warn'}`}>
              {!status.ok ? 'צריך להתחבר שוב' : status.pending ? <><Loader2 size={12} className="spin" /> מתחבר…</> : `מחובר · עודכן ${ago(status.syncedAt)}`}
            </span>
            {status.ok && <button className="btn sm" onClick={sync} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''} /> רענון</button>}
            {!status.ok && <button className="btn sm accent" onClick={() => setOpen(true)}>התחברות מחדש</button>}
            <button className="btn sm ghost" onClick={disconnect} disabled={busy}><Unplug size={14} /> ניתוק</button>
          </>
        ) : (
          !open && <button className="btn sm accent" onClick={() => setOpen(true)}>חיבור הפורטל – והקבוצות ייקבעו לבד</button>
        )}
      </div>
      <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>
        {connected
          ? status.error || (status.pending
            ? 'המחשב שקורא את הפורטל מתחבר אליו עכשיו – בדרך כלל תוך דקה.'
            : 'הקבוצות, החדרים, הביטולים וההודעות על השיעורים נלקחים מהמערכת שלך בפורטל – וההתראות לטלפון רק לפיהם.')
          : 'אין צורך לבחור קבוצות ידנית: הקבוצות שלך, שינויי חדרים וביטולים מופיעים בפורטל לפני קובץ הקורסים. חברו אותו, והמערכת וההתראות יהיו רק לשיעורים ולתרגולים שלך.'}
      </div>
      <Link to="/guide#portal" className="linklike" style={{ fontSize: 13, display: 'inline-block', marginTop: 6 }}>איך זה עובד ומה נשמר?</Link>
      {connected && !status.relayOnline && <div className="chip warn" style={{ marginTop: 8 }}>המחשב שקורא את הפורטל לא מחובר כרגע – העדכון יחכה עד שיחזור</div>}

      <AnimatePresence>
        {open && (
          <motion.form className="portal-form" onSubmit={connect} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="callout row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <ShieldCheck size={16} style={{ flex: 'none', marginTop: 3 }} />
              <span style={{ fontSize: 13.5 }}>
                לפורטל אין מפתח גישה כמו למודל, אז האתר שומר את פרטי ההתחברות כדי להתחבר שוב כשהחיבור פג. הם <b>מוצפנים כבר כאן בדפדפן</b> במפתח
                שרק המחשב של מנהל האתר יכול לפתוח – הפורטל חוסם שרתים מחוץ לישראל, ולכן הקריאה ממנו נעשית משם. בשרת הענן אי אפשר לקרוא אותם.
                התחברות שנכשלת לא מנוסה שוב אוטומטית. ניתוק (או מחיקת החשבון) מוחק אותם לגמרי.
                הודעות על שיעורים שנקראות מהפורטל שלך (בלי שם ובלי פרטים אישיים) עשויות להופיע גם למנהל האתר, כדי שיוכל לעדכן את כולם מהר.
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
              <div className="row wrap" style={{ gap: '2px 8px' }}><b>{n.lesson}</b>{n.date && <span className="faint" style={{ fontSize: 12.5 }}>{new Date(n.date).toLocaleDateString('he-IL')}</span>}</div>
              {n.analysis?.headline && <div style={{ fontWeight: 600 }}>{(NOTICE_KINDS[n.analysis.kind] || NOTICE_KINDS.general).icon} {n.analysis.headline}</div>}
              {n.title && n.title !== n.analysis?.headline && <div>{n.title}</div>}
              {n.content && <div className="faint">{n.content}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
