import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, Hash, BookMarked, Presentation, CornerDownLeft } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Highlight, ltr } from './ui.jsx';

const TYPE = {
  lecture: { icon: Presentation, label: 'הרצאה' },
  topic: { icon: Hash, label: 'נושא' },
  term: { icon: BookMarked, label: 'מושג' },
  slide: { icon: FileText, label: 'שקף' },
};

export default function SearchPalette() {
  const { setSearchOpen } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef();

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) return setResults([]);
      api.get(`/api/search?q=${encodeURIComponent(q.trim())}`).then((r) => { setResults(r); setSel(0); });
    }, 160);
    return () => clearTimeout(t);
  }, [q]);

  const go = (r) => {
    setSearchOpen(false);
    const tab = r.type === 'term' ? 'glossary' : r.type === 'topic' ? 'topics' : 'slides';
    navigate(`/lecture/${r.lectureId}?tab=${tab}${r.slide ? `&slide=${r.slide}` : ''}`);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') setSearchOpen(false);
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && results[sel]) go(results[sel]);
  };

  return (
    <motion.div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setSearchOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="palette" initial={{ opacity: 0, y: -16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, scale: 0.98 }} transition={{ type: 'spring', stiffness: 450, damping: 36 }}>
        <div className="palette-input">
          <Search size={20} color="var(--text-3)" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="חפשו מושג, נושא או מילה מתוך השקפים…" />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-results">
          {q.trim().length >= 2 && results.length === 0 && <div className="faint" style={{ padding: 24, textAlign: 'center' }}>לא נמצאו תוצאות ל״{q}״</div>}
          {q.trim().length < 2 && <div className="faint" style={{ padding: 24, textAlign: 'center' }}>החיפוש עובר על כותרות, נושאים, מילון המושגים והטקסט של כל השקפים</div>}
          {results.map((r, i) => {
            const T = TYPE[r.type];
            return (
              <button key={i} className={`result ${i === sel ? 'sel' : ''}`} data-color={r.color} onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                <span className="result-icon"><T.icon size={16} /></span>
                <span className="grow">
                  <b><Highlight text={r.title} q={q} /></b>
                  <small>{T.label} · {r.courseShort} · {r.lectureTitle}</small>
                  {r.snippet && <p><Highlight text={ltr(r.snippet)} q={q} /></p>}
                </span>
                {i === sel && <CornerDownLeft size={15} color="var(--text-3)" />}
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
