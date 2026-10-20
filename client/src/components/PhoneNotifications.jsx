import { useEffect, useState } from 'react';
import { BellRing, Check, Loader2, Smartphone, Share } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { pushSupported, needsInstall, currentSubscription, enablePush, disablePush } from '../lib/push.js';

const KINDS = [
  ['deadlines', 'הגשה מתקרבת'],
  ['exams', 'מבחן או בוחן מחר'],
  ['cards', 'כרטיסיות לחזרה'],
  ['classes', 'שיעור בעוד רבע שעה'],
  ['rooms', 'שינוי חדר או שעה בקבוצה שלי'],
];

/** Cloud site: turn phone notifications on for this device and choose which kinds arrive. */
export default function PhoneNotifications() {
  const { progress, setNotify, toast } = useApp();
  const [on, setOn] = useState(null); // null = checking
  const [busy, setBusy] = useState(false);
  const prefs = progress.notify || {};

  useEffect(() => {
    if (!pushSupported()) return setOn(false);
    currentSubscription().then((s) => setOn(!!s && Notification.permission === 'granted')).catch(() => setOn(false));
  }, []);

  const run = (fn) => async () => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(e.message, 'info'); } finally { setBusy(false); }
  };
  const turnOn = run(async () => {
    await enablePush();
    setOn(true);
    toast('ההתראות הופעלו במכשיר הזה');
  });
  const turnOff = run(async () => {
    await disablePush();
    setOn(false);
    toast('ההתראות כובו במכשיר הזה');
  });
  const test = run(async () => {
    await api.post('/api/push/test', {});
    toast('נשלחה התראת בדיקה');
  });

  return (
    <div className="callout phone-notify" style={{ marginTop: 14 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <Smartphone size={18} />
        <b className="grow">התראות לטלפון</b>
        {on === null ? <Loader2 size={16} className="spin" /> : on ? (
          <>
            <span className="chip good"><Check size={12} /> פעילות במכשיר הזה</span>
            <button className="btn sm" onClick={test} disabled={busy}>בדיקה</button>
            <button className="btn sm ghost" onClick={turnOff} disabled={busy}>כיבוי</button>
          </>
        ) : pushSupported() && !needsInstall() ? (
          <button className="btn sm accent" onClick={turnOn} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <BellRing size={14} />} הפעלת התראות</button>
        ) : null}
      </div>
      {on === false && pushSupported() && Notification.permission === 'denied' ? (
        <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>ההתראות חסומות לאתר הזה בדפדפן. אפשרו אותן בהגדרות האתר (ליד שורת הכתובת) ואז לחצו כאן על "הפעלת התראות".</div>
      ) : needsInstall() ? (
        <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>
          באייפון ההתראות מגיעות רק מהאתר שנוסף למסך הבית: לוחצים על <Share size={12} style={{ verticalAlign: -2 }} /> שיתוף ← "הוספה למסך הבית", פותחים משם ומפעילים כאן.
        </div>
      ) : !pushSupported() ? (
        <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>הדפדפן הזה לא תומך בהתראות. נסו בכרום, בספארי או בפיירפוקס.</div>
      ) : (
        <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>ההתראות מגיעות גם כשהאתר סגור. מה לשלוח:</div>
      )}
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        {KINDS.map(([id, label]) => {
          const yes = prefs[id] !== false;
          return (
            <button key={id} className={`chip ${yes ? 'c' : ''}`} aria-pressed={yes} onClick={() => setNotify({ [id]: !yes })}>
              {yes && <Check size={12} />} {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
