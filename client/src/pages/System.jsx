import { useEffect } from 'react';
import { motion } from 'motion/react';
import { Activity, Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, MinusCircle } from 'lucide-react';
import { useApp } from '../store.jsx';
import { useFetch } from '../api.js';
import { Page, fadeUp } from '../components/ui.jsx';

const STATE = {
  ok: { icon: CheckCircle2, chip: 'good', label: 'תקין' },
  warn: { icon: AlertTriangle, chip: 'warn', label: 'שווה לבדוק' },
  bad: { icon: XCircle, chip: 'bad', label: 'תקלה' },
  off: { icon: MinusCircle, chip: '', label: 'לא פעיל' },
};
const SUMMARY = {
  ok: 'הכל עובד',
  off: 'הכל עובד (חלק מהרכיבים כבויים כרגע)',
  warn: 'יש דברים ששווה לבדוק',
  bad: 'יש תקלה',
};

/** The owner's view of the moving parts: notifications, Moodle watcher, portal readers, the Mac, publishing. */
export default function System() {
  const { setContext } = useApp();
  const { data, error, loading, reload } = useFetch('/api/system', { poll: () => true, interval: 60000 });
  useEffect(() => { setContext({}); }, [setContext]);

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon"><Activity size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>מצב המערכת</h1>
            <div className="muted" style={{ fontSize: 14 }}>
              {data ? `${SUMMARY[data.state] || ''} · נבדק ב ${new Date(data.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : 'מה רץ, מתי בפעם האחרונה, ומה מחכה.'}
              {' '}כשמשהו נתקע, מגיעה אליך התראה לטלפון (פעם ביום לכל בעיה, בין 8:00 ל 23:00).
            </div>
          </div>
          <button className="btn sm" onClick={reload}><RefreshCw size={14} /> רענון</button>
        </div>
      </motion.div>
      {data?.error && <div className="callout" style={{ marginTop: 14, background: 'var(--warn-bg)' }}>{data.error}</div>}
      {error && !data && <div className="callout" style={{ marginTop: 14 }}>{error}</div>}
      {loading && !data && <div style={{ padding: 40, textAlign: 'center' }}><Loader2 className="spin" /></div>}
      <div className="stack" style={{ marginTop: 16 }}>
        {data?.checks.map((c, i) => {
          const s = STATE[c.state] || STATE.off;
          const Icon = s.icon;
          return (
            <motion.div key={c.id} className="card pad" variants={fadeUp} initial="hidden" animate="show" custom={i}>
              <div className="row wrap" style={{ gap: 10 }}>
                <Icon size={20} color={c.state === 'ok' ? 'var(--good)' : c.state === 'bad' ? 'var(--bad)' : c.state === 'warn' ? 'var(--warn)' : 'var(--text-3)'} />
                <div style={{ fontWeight: 700, fontSize: 16 }}>{c.title}</div>
                <span className={`chip ${s.chip}`}>{s.label}</span>
              </div>
              <div style={{ marginTop: 6 }}>{c.text}</div>
              {c.detail?.length > 0 && (
                <ul className="muted" style={{ margin: '8px 0 0', paddingInlineStart: 20, fontSize: 14, lineHeight: 1.7 }}>
                  {c.detail.map((d) => <li key={d}>{d}</li>)}
                </ul>
              )}
            </motion.div>
          );
        })}
      </div>
    </Page>
  );
}
