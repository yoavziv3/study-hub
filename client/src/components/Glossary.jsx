import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Search, Sparkles } from 'lucide-react';
import { useApp } from '../store.jsx';
import { Highlight, ltr } from './ui.jsx';

export default function Glossary({ terms, showSource = false }) {
  const { openChat } = useApp();
  const [q, setQ] = useState('');
  const sorted = useMemo(() => [...terms].sort((a, b) => a.term.localeCompare(b.term, 'he')), [terms]);
  const filtered = sorted.filter((t) => !q || (t.term + ' ' + t.definition).toLowerCase().includes(q.toLowerCase()));
  const letters = [...new Set(sorted.map((t) => t.term[0]))];

  return (
    <div>
      <div className="row" style={{ maxWidth: 460 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={16} style={{ position: 'absolute', top: 13, insetInlineStart: 14, color: 'var(--text-3)' }} />
          <input className="input" style={{ paddingInlineStart: 40 }} placeholder={`סינון ${terms.length} מושגים…`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="letter-index">
        {letters.map((l) => (
          <button key={l} onClick={() => document.getElementById(`term-${l}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{l}</button>
        ))}
      </div>
      <div className="glossary">
        {filtered.map((t, i) => {
          const first = i === 0 || filtered[i - 1].term[0] !== t.term[0];
          return (
            <motion.div key={t.term + i} id={first ? `term-${t.term[0]}` : undefined} className="card term" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 20) * 0.02 }}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <h4 className="grow"><Highlight text={ltr(t.term)} q={q} /></h4>
                <button className="local-only btn sm icon ghost" title="הסבר מורחב" onClick={() => openChat({ prompt: `הסבר לי לעומק את המושג "${t.term}" עם דוגמה מהחומר.`, autoSend: true })}>
                  <Sparkles size={14} />
                </button>
              </div>
              <p><Highlight text={ltr(t.definition)} q={q} /></p>
              {showSource && <Link to={`/lecture/${t.lectureId}?tab=glossary`} className="faint" style={{ fontSize: 12.5, display: 'block', marginTop: 8 }}>{t.lectureTitle}</Link>}
            </motion.div>
          );
        })}
      </div>
      {!filtered.length && <p className="muted">לא נמצאו מושגים.</p>}
    </div>
  );
}
