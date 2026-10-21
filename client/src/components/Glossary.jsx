import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Search, Sparkles, List, Puzzle } from 'lucide-react';
import { useApp } from '../store.jsx';
import { Highlight, ltr } from './ui.jsx';
import { RichText } from './markdown.jsx';
import { plainText } from '../lib/text.js';
import MatchGame from './MatchGame.jsx';

export default function Glossary({ terms, showSource = false }) {
  const [mode, setMode] = useState('list'); // list | match
  return (
    <div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {[['list', 'רשימת מושגים', List], ['match', 'משחק התאמה', Puzzle]].map(([id, label, Icon]) => (
          <button key={id} className={`tab ${mode === id ? 'active' : ''}`} onClick={() => setMode(id)}>
            {mode === id && <motion.span layoutId="gl-mode" className="tab-bg" />}
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {mode === 'match' ? <MatchGame terms={terms} /> : <TermList terms={terms} showSource={showSource} />}
    </div>
  );
}

function TermList({ terms, showSource }) {
  const { openChat } = useApp();
  const [q, setQ] = useState('');
  const sorted = useMemo(() => [...terms].sort((a, b) => a.term.localeCompare(b.term, 'he')), [terms]);
  const filtered = sorted.filter((t) => !q || plainText(`${t.term} ${t.definition}`).toLowerCase().includes(q.toLowerCase()));
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
                <h4 className="grow">{q ? <Highlight text={ltr(plainText(t.term))} q={q} /> : <RichText>{t.term}</RichText>}</h4>
                <button className="local-only btn sm icon ghost" title="הסבר מורחב" onClick={() => openChat({ prompt: `הסבר לי לעומק את המושג "${t.term}" עם דוגמה מהחומר.`, autoSend: true })}>
                  <Sparkles size={14} />
                </button>
              </div>
              <p>{q ? <Highlight text={ltr(plainText(t.definition))} q={q} /> : <RichText>{t.definition}</RichText>}</p>
              {showSource && <Link to={`/lecture/${t.lectureId}?tab=glossary`} className="faint" style={{ fontSize: 12.5, display: 'block', marginTop: 8 }}>{t.lectureTitle}</Link>}
            </motion.div>
          );
        })}
      </div>
      {!filtered.length && <p className="muted">לא נמצאו מושגים.</p>}
    </div>
  );
}
