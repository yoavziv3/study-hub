import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ListChecks, Loader2, Download, ChevronDown } from 'lucide-react';
import { useApp } from '../store.jsx';
import { useFetch } from '../api.js';
import { Page, fadeUp } from '../components/ui.jsx';

const STATUS = {
  ok: { label: 'תקין', chip: 'good' },
  checked: { label: 'תוקן בבדיקות', chip: 'warn' },
  rejected: { label: 'נדחה בבדיקות', chip: 'bad' },
  error: { label: 'נכשל', chip: 'bad' },
};
const TRIGGER = { schedule: 'תזמון', moodle: 'קובץ ממודל', upload: 'העלאה', inbox: 'תיקיית קליטה', import: 'ייבוא', retry: 'ניסיון חוזר', manual: 'ידני', 'after-lecture': 'אחרי עיבוד', 'after-change': 'אחרי שינוי' };
const when = (iso) => new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const secs = (ms) => (ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} ש׳` : `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')} דק׳`);
const brief = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : v}`).join(' · ');

/** CSV of the shown runs, for the project's "documented runs" appendix (opens in Excel with Hebrew intact). */
function toCsv(runs, processes) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['מזהה', 'תהליך', 'טריגר', 'התחלה', 'סיום', 'משך (ms)', 'סטטוס', 'קלט', 'פלט', 'בדיקות', 'שגיאה']];
  for (const r of runs) {
    rows.push([r.id, processes[r.process] || r.process, TRIGGER[r.trigger] || r.trigger, r.startedAt, r.finishedAt, r.durationMs, STATUS[r.status]?.label || r.status, brief(r.input), brief(r.output), (r.checks || []).map((c) => `[${c.level}] ${c.detail}`).join(' | '), r.error || '']);
  }
  return `﻿${rows.map((r) => r.map(esc).join(',')).join('\n')}`;
}

/** Every process run on this Mac (server/lib/runlog.js), with what its fixed checks found. */
export default function Runs() {
  const { setContext } = useApp();
  const [process, setProcess] = useState('');
  const { data, loading } = useFetch(`/api/runs${process ? `?process=${process}` : ''}`, { poll: () => true, interval: 30000 });
  const [open, setOpen] = useState(null);
  useEffect(() => { setContext({}); }, [setContext]);
  const runs = data?.runs || [];
  const processes = data?.processes || {};

  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCsv(runs, processes)], { type: 'text/csv;charset=utf-8' }));
    a.download = `runs-${process || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon"><ListChecks size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>יומן הרצות</h1>
            <div className="muted" style={{ fontSize: 14 }}>כל הרצה של כל תהליך: מתי, מה הפעיל אותה, מה נכנס, מה יצא, ומה מצאו הבדיקות הקבועות אחרי שלב ה AI.</div>
          </div>
          <select className="input" style={{ width: 'auto' }} value={process} onChange={(e) => setProcess(e.target.value)} aria-label="תהליך">
            <option value="">כל התהליכים</option>
            {Object.entries(processes).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button className="btn sm" onClick={download} disabled={!runs.length}><Download size={14} /> ייצוא ל CSV</button>
        </div>
      </motion.div>
      {loading && !data && <div style={{ padding: 40, textAlign: 'center' }}><Loader2 className="spin" /></div>}
      {data && !runs.length && <div className="empty"><div className="empty-icon"><ListChecks size={28} /></div><h2>עוד אין הרצות</h2><p>ההרצה הבאה של כל תהליך תירשם כאן.</p></div>}
      <div className="stack" style={{ gap: 8, marginTop: 16 }}>
        {runs.map((r) => {
          const s = STATUS[r.status] || STATUS.error;
          const isOpen = open === r.id;
          return (
            <div key={r.id} className="card pad" style={{ padding: '12px 16px' }}>
              <button className="row wrap" style={{ gap: 8, width: '100%', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'start' }} onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                <span style={{ fontWeight: 700 }}>{processes[r.process] || r.process}</span>
                <span className={`chip ${s.chip}`}>{s.label}</span>
                <span className="chip">{TRIGGER[r.trigger] || r.trigger}</span>
                {r.checks?.length > 0 && <span className="chip">{r.checks.length} ממצאים</span>}
                <span className="faint grow" style={{ fontSize: 13 }}>{r.input?.course ? `${r.input.course} · ` : ''}{r.input?.file || r.input?.title || r.input?.week || ''}</span>
                <span className="faint" style={{ fontSize: 13 }}>{when(r.startedAt)} · {secs(r.durationMs)}</span>
                <ChevronDown size={15} style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
              </button>
              {isOpen && (
                <div className="stack" style={{ gap: 6, marginTop: 10, fontSize: 13.5 }}>
                  <div><b>קלט:</b> <span dir="auto">{brief(r.input)}</span></div>
                  {r.output && <div><b>פלט:</b> <span dir="auto">{brief(r.output)}</span></div>}
                  {r.error && <div style={{ color: 'var(--bad-text)' }}><b>שגיאה:</b> <span dir="auto">{r.error}</span></div>}
                  {r.checks?.length > 0 && (
                    <div>
                      <b>בדיקות:</b>
                      <ul style={{ margin: '4px 0 0', paddingInlineStart: 20 }}>
                        {r.checks.map((c, i) => <li key={i}><span className={`chip ${c.level === 'reject' ? 'bad' : c.level === 'warn' ? 'warn' : ''}`}>{c.level === 'reject' ? 'נדחה' : c.level === 'warn' ? 'אזהרה' : 'תוקן'}</span> {c.detail}</li>)}
                      </ul>
                    </div>
                  )}
                  <div className="faint">מזהה {r.id} · {r.startedAt} → {r.finishedAt}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Page>
  );
}
