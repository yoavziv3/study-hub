import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Flag, Check, Loader2, Cloud, Laptop, MessageSquare } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, useFetch } from '../api.js';
import { Page, fadeUp, ltr } from '../components/ui.jsx';

/** Mistakes reported on summaries – by students on the cloud site and on this Mac. */
export default function Reports() {
  const { setContext, toast } = useApp();
  const { data, reload, loading } = useFetch('/api/reports');
  useEffect(() => { setContext({}); }, [setContext]);

  const resolve = async (r) => {
    try {
      await api.post(`/api/reports/${r.source}/${r.id}/resolve`);
      toast('סומן כטופל');
      reload();
    } catch (e) {
      toast(e.message, 'info');
    }
  };

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon"><Flag size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>דיווחים ומשוב</h1>
            <div className="muted" style={{ fontSize: 14 }}>טעויות שסטודנטים סימנו בסיכומים ומשוב כללי על האתר. אפשר לתקן (או ליצור סיכום מחדש) ולסמן כטופל.</div>
          </div>
        </div>
      </motion.div>
      {data?.cloudError && <div className="callout" style={{ marginTop: 14 }}>לא הצלחתי לקרוא את הדיווחים מהענן: {data.cloudError}</div>}
      {loading && <div style={{ padding: 40, textAlign: 'center' }}><Loader2 className="spin" /></div>}
      {data && !data.reports.length && (
        <div className="empty"><div className="empty-icon"><Check size={28} /></div><h2>אין דיווחים פתוחים</h2><p>כשמישהו ידווח על טעות בסיכום, זה יופיע כאן.</p></div>
      )}
      <div className="stack" style={{ marginTop: 16 }}>
        {data?.reports.map((r, i) => (
          <motion.div key={`${r.source}-${r.id}`} className="card pad" variants={fadeUp} initial="hidden" animate="show" custom={i % 10}>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="chip">{r.source === 'cloud' ? <><Cloud size={12} /> מהאתר בענן</> : <><Laptop size={12} /> מהמחשב</>}</span>
              {r.courseShort && <span className="chip c">{r.courseShort}</span>}
              <span className="faint" style={{ fontSize: 12.5, marginInlineStart: 'auto' }}>{new Date(r.created_at).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div style={{ fontWeight: 700, marginTop: 8 }}>{r.feedback ? <><MessageSquare size={15} /> משוב כללי</> : r.lectureTitle}{r.section ? ` · ${r.section}` : ''}</div>
            <div style={{ marginTop: 6, whiteSpace: 'pre-line', lineHeight: 1.7 }}>{ltr(r.text)}</div>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              {!r.feedback && <Link className="btn sm" to={`/lecture/${r.lecture_id}?tab=summary`}>לסיכום</Link>}
              <button className="btn sm accent" onClick={() => resolve(r)}><Check size={14} /> טופל</button>
            </div>
          </motion.div>
        ))}
      </div>
    </Page>
  );
}
