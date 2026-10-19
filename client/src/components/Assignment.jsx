import { useState } from 'react';
import { ClipboardList, ExternalLink, ChevronDown, CalendarClock } from 'lucide-react';
import { ltr } from './ui.jsx';

const ALEPH_BET = 'אבגדהוזחטיכלמנסעפצקרשת';

/**
 * The lecturer's Moodle instructions as a list of required exercises, when they are written as one
 * ("תרגילים לעשות מתוך התרגיל: 1, 2א,ב,ג, 4, 5 א,ב, 6"). Returns null when the text is anything else –
 * then the instructions are shown as written.
 */
export function parseRequired(text = '') {
  // A list line holds only exercise numbers, single Hebrew letters (sub-questions) and separators.
  const isList = (l) => /\d/.test(l) && /^[\d\s,.;:\-–א-ת()]+$/.test(l) && !/[א-ת]{2,}/.test(l);
  // "יש לפתור את שאלות 1, 3, 5": words and the list on one line are split into intro + list.
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).flatMap((l) => {
    const i = l.search(/\d/);
    return !isList(l) && i > 0 && isList(l.slice(i)) ? [l.slice(0, i).trim(), l.slice(i)] : [l];
  });
  const first = lines.findIndex(isList);
  if (first < 0 || lines.slice(first).some((l) => !isList(l))) return null;
  const items = [];
  for (const m of lines.slice(first).join(' , ').matchAll(/(\d{1,2})\s*((?:[א-ת]\s*[,\-–]?\s*)*)/g)) {
    let parts = m[2].match(/[א-ת]/g) || [];
    // "א-ג" is a range of sub-questions.
    if (/[א-ת]\s*[-–]\s*[א-ת]/.test(m[2]) && parts.length === 2) {
      const [a, b] = parts.map((x) => ALEPH_BET.indexOf(x));
      if (a >= 0 && b > a) parts = [...ALEPH_BET.slice(a, b + 1)];
    }
    items.push({ n: Number(m[1]), parts });
  }
  if (!items.length) return null;
  return { intro: lines.slice(0, first).join(' ').replace(/[:：]\s*$/, ''), items };
}

/** "א–ג" for a run of consecutive letters, otherwise "א, ג". */
export function partsLabel(parts) {
  if (!parts.length) return '';
  const idx = parts.map((p) => ALEPH_BET.indexOf(p));
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  return consecutive && parts.length >= 3 ? `${parts[0]}–${parts.at(-1)}` : parts.join(', ');
}

const itemLabel = (it) => (it.parts.length ? `${it.n} (${partsLabel(it.parts)})` : String(it.n));

/** Exercise number → required sub-questions ([] = the whole exercise); null when nothing is specified. */
export function requiredMap(assignment) {
  const parsed = assignment?.instructions ? parseRequired(assignment.instructions) : null;
  return parsed ? new Map(parsed.items.map((it) => [it.n, it.parts])) : null;
}

const fmtDue = (iso) => new Date(iso).toLocaleString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** One line for a homework card: the required exercises and the due date. */
export function AssignmentLine({ assignment }) {
  if (!assignment) return null;
  const parsed = parseRequired(assignment.instructions);
  if (!parsed && !assignment.dueAt) return null;
  return (
    <div className="assign-line">
      <ClipboardList size={14} />
      {parsed ? <span>להגשה: {parsed.items.map(itemLabel).join(' · ')}</span> : <span>להגשה במודל</span>}
      {assignment.dueAt && <span className="faint">· עד {fmtDue(assignment.dueAt)}</span>}
    </div>
  );
}

/** Full box on the homework page: what to hand in, by when, the lecturer's own words, and a link to Moodle. */
export function AssignmentBox({ assignment }) {
  const [raw, setRaw] = useState(false);
  if (!assignment) return null;
  const parsed = parseRequired(assignment.instructions);
  const past = assignment.dueAt && new Date(assignment.dueAt) < new Date();
  return (
    <div className="assign-box">
      <div className="row wrap" style={{ gap: 10 }}>
        <ClipboardList size={18} />
        <b className="grow">מה צריך להגיש{assignment.name ? ` – ${assignment.name}` : ''}</b>
        {assignment.dueAt && (
          <span className={`chip ${past ? '' : 'warn'}`}><CalendarClock size={13} /> {past ? 'ההגשה נסגרה' : `עד ${fmtDue(assignment.dueAt)}`}</span>
        )}
      </div>
      {parsed ? (
        <>
          {parsed.intro && <div className="muted" style={{ fontSize: 14, marginTop: 8 }}>{parsed.intro}</div>}
          <div className="assign-items">
            {parsed.items.map((it) => (
              <span key={it.n} className="assign-item">
                <b>תרגיל {it.n}</b>
                {it.parts.length > 0 && <span>סעיפים {partsLabel(it.parts)}</span>}
              </span>
            ))}
          </div>
        </>
      ) : (
        assignment.instructions && <div className="assign-text">{ltr(assignment.instructions)}</div>
      )}
      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        {assignment.url && <a className="btn sm" href={assignment.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> לעמוד ההגשה במודל</a>}
        {parsed && assignment.instructions && (
          <button className="btn sm ghost" onClick={() => setRaw((x) => !x)}>
            ההנחיה המקורית <ChevronDown size={14} style={{ transform: raw ? 'rotate(180deg)' : 'none' }} />
          </button>
        )}
      </div>
      {raw && <div className="assign-text">{ltr(assignment.instructions)}</div>}
    </div>
  );
}
