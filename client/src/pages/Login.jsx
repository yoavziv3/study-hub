import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Lock, KeyRound, ShieldCheck, Loader2, ChevronDown, LogIn } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../store.jsx';

/** Cloud sign-in: the student signs in with their Moodle (BGU) account; the site only keeps Moodle's access key. */
export default function Login() {
  const { refreshMe } = useApp();
  const [mode, setMode] = useState('password');
  const [form, setForm] = useState({ username: '', password: '', token: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [why, setWhy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'password') await api.post('/api/auth/login', { username: form.username, password: form.password });
      else await api.post('/api/auth/token', { token: form.token });
      setForm({ username: '', password: '', token: '' });
      await refreshMe();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <motion.div className="card login-card" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
        <div className="row" style={{ gap: 12, marginBottom: 6 }}>
          <div className="brand-mark" />
          <div>
            <div className="brand-name">מחברת</div>
            <div className="brand-sub">עזר ללימודים · הנדסת תעשייה וניהול</div>
          </div>
        </div>
        <h1 className="login-title">כניסה עם חשבון המודל</h1>
        <p className="muted" style={{ margin: '0 0 18px', fontSize: 14.5 }}>
          אחרי הכניסה יופיעו רק הקורסים שאתם רשומים אליהם במודל, עם ההגשות, ההודעות והחומרים שלהם.
        </p>

        <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
          {mode === 'password' ? (
            <>
              <label className="field">שם משתמש (כמו במודל)
                <input className="input" autoComplete="username" required dir="ltr" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </label>
              <label className="field">סיסמה
                <input className="input" type="password" autoComplete="current-password" required dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </label>
            </>
          ) : (
            <label className="field">מפתח גישה של המודל (32 תווים)
              <input className="input" required dir="ltr" spellCheck={false} value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="a1b2c3…" />
              <span className="faint" style={{ fontSize: 12.5 }}>במודל: העדפות ← מפתחות אבטחה ← המפתח של "Moodle mobile web service".</span>
            </label>
          )}
          <AnimatePresence>
            {error && (
              <motion.div className="login-error" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>{error}</motion.div>
            )}
          </AnimatePresence>
          <button className="btn accent" style={{ height: 46 }} disabled={busy}>
            {busy ? <Loader2 size={17} className="spin" /> : <LogIn size={17} />} {busy ? 'מתחבר למודל…' : 'כניסה'}
          </button>
        </form>

        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => { setMode(mode === 'password' ? 'token' : 'password'); setError(''); }}>
          {mode === 'password' ? <><KeyRound size={14} /> כניסה עם מפתח גישה במקום סיסמה</> : <><Lock size={14} /> כניסה עם שם משתמש וסיסמה</>}
        </button>

        <div className="login-privacy">
          <button className="row" style={{ gap: 8, width: '100%', fontWeight: 700 }} onClick={() => setWhy((x) => !x)}>
            <ShieldCheck size={17} color="var(--good)" />
            <span className="grow" style={{ textAlign: 'start' }}>מה קורה עם הפרטים שלי?</span>
            <ChevronDown size={16} style={{ transform: why ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          </button>
          <AnimatePresence initial={false}>
            {why && (
              <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <li><b>הסיסמה לא נשמרת.</b> היא נשלחת פעם אחת למודל של האוניברסיטה כדי לקבל מפתח גישה – אותו מפתח שאפליקציית המודל בטלפון מקבלת – ונמחקת מיד.</li>
                <li>נשמר רק <b>מפתח הגישה, מוצפן</b>, כדי להביא מהמודל את הקורסים, ההגשות והציונים שלכם.</li>
                <li>ההתקדמות שלכם באתר (מה למדתם, הערות, תרגול) נשמרת בחשבון כדי שתראו אותה בכל מכשיר.</li>
                <li>אף סטודנט אחר לא רואה את המידע שלכם. החומר של כל קורס פתוח רק למי שרשום אליו.</li>
                <li>בכל רגע אפשר ללחוץ "מחיקת החשבון" בתפריט, וכל המידע נמחק. אפשר גם לבטל את המפתח במודל (העדפות ← מפתחות אבטחה ← איפוס).</li>
                <li>זה כלי של סטודנטים, לא אתר רשמי של האוניברסיטה. <a href="/privacy" style={{ color: 'var(--c-strong)', fontWeight: 600 }}>לפרטים המלאים</a></li>
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
